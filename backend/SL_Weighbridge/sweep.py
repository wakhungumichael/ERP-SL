"""
SL_Weighbridge.sweep
--------------------
Shared sweep logic for promoting OverweightEvents into WeighbridgeDiscrepancies
once their grace window has expired.

This module is the single source of truth for the sweep algorithm so that the
management command, the Celery periodic task, the background-thread scheduler,
and the on-demand API view all execute identical logic.

Usage::

    from SL_Weighbridge.sweep import run_sweep

    result = run_sweep()
    # {'created': 3, 'skipped': 1}

    result = run_sweep(branch_id=5)   # scope to one branch
"""
import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)


def run_sweep(branch_id=None, tenant=None):
    """
    Sweep OverweightEvents eligible for discrepancy promotion.

    Eligible events:
      - discrepancy_raised=False
      - NOT linked to a transaction that is both Completed AND Paid

    For each eligible event whose grace window (from OverweightConfig, default
    30 minutes) has expired, get_or_create a WeighbridgeDiscrepancy and mark
    the event as discrepancy_raised=True.

    Args:
        branch_id: Optional int — limit sweep to a single branch.
        tenant: Optional Tenant object — limit sweep to a single tenant.
                Pass None (default) for a global sweep (used by the background
                scheduler and Celery beat task which run as system processes).

    Returns a dict: {'created': int, 'skipped': int}
    """
    # Import here to avoid circular imports at module load time
    from SL_Weighbridge.models import (
        OverweightConfig,
        OverweightEvent,
        WeighbridgeDiscrepancy,
    )

    now = timezone.now()

    qs = OverweightEvent.objects.filter(
        discrepancy_raised=False,
    ).exclude(
        linked_transaction__status="Completed",
        linked_transaction__payment_status="Paid",
    )
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)

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

        _disc, new = WeighbridgeDiscrepancy.objects.get_or_create(
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

    if created:
        logger.info(
            "Discrepancy sweep: %d new discrepancy(ies) raised, "
            "%d event(s) still within grace window.",
            created,
            skipped,
        )

    return {"created": created, "skipped": skipped}
