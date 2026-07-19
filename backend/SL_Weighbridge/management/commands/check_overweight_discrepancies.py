"""
Management command: check_overweight_discrepancies

Sweeps OverweightEvent records that are eligible to be promoted to discrepancies:

  Eligible  = discrepancy_raised=False
              AND the event is NOT accounted for by a Completed+Paid transaction
              (i.e. linked_transaction IS NULL, OR transaction.status != Completed,
               OR transaction.payment_status != Paid)

For each eligible event whose grace window has expired, creates a
WeighbridgeDiscrepancy (or updates an existing one) with status='unresolved'.

Safe to run repeatedly (idempotent). Intended for a cron / Celery beat job,
or triggered on-demand via POST /commercial-weighbridge/discrepancies/check/.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta

from SL_Weighbridge.models import (
    OverweightConfig,
    OverweightEvent,
    WeighbridgeDiscrepancy,
)


def _eligible_qs(branch_id=None):
    """
    Build the queryset of events eligible for discrepancy promotion.

    Excludes events where the linked transaction is both Completed and Paid —
    those are accounted for and should not generate discrepancies.
    """
    qs = OverweightEvent.objects.filter(
        discrepancy_raised=False,
    ).exclude(
        linked_transaction__status="Completed",
        linked_transaction__payment_status="Paid",
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    return qs


class Command(BaseCommand):
    help = "Promote unresolved OverweightEvents to discrepancies after their grace window."

    def add_arguments(self, parser):
        parser.add_argument(
            "--branch",
            type=int,
            default=None,
            help="Limit sweep to a specific branch ID.",
        )

    def handle(self, *args, **options):
        now       = timezone.now()
        branch_id = options.get("branch")
        qs        = _eligible_qs(branch_id=branch_id)

        created = 0
        skipped = 0

        for event in qs.select_related("branch", "tenant"):
            # Determine grace window from branch config (default 30 min)
            grace_minutes = 30
            if event.branch_id:
                try:
                    cfg = OverweightConfig.objects.get(branch_id=event.branch_id)
                    grace_minutes = cfg.grace_window_minutes
                except OverweightConfig.DoesNotExist:
                    pass

            cutoff = event.recorded_at + timedelta(minutes=grace_minutes)
            if now < cutoff:
                skipped += 1
                continue  # Still within grace window

            disc, new = WeighbridgeDiscrepancy.objects.get_or_create(
                overweight_event=event,
                defaults={
                    "tenant": event.tenant,
                    "branch": event.branch,
                    "resolution_status": "unresolved",
                },
            )
            event.discrepancy_raised = True
            event.save(update_fields=["discrepancy_raised", "updated_at"])
            if new:
                created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Sweep complete — {created} new discrepancy(ies) raised, "
                f"{skipped} event(s) still within grace window."
            )
        )
