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

from SL_Weighbridge.sweep import run_sweep


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
        result = run_sweep(branch_id=options.get("branch"))
        self.stdout.write(
            self.style.SUCCESS(
                f"Sweep complete — {result['created']} new discrepancy(ies) raised, "
                f"{result['skipped']} event(s) still within grace window."
            )
        )
