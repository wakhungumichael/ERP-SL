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

from Platform_Core.platform import get_tenants_with_active_module, tenant_has_active_module
from .surveillance import reconcile_overweight_event, resolve_tenant_for_branch

logger = logging.getLogger(__name__)


def run_sweep(branch_id=None, tenant=None):
    """
    Sweep OverweightEvents eligible for discrepancy promotion.

    A scale-reading event is reconciled when it can be linked to any recorded
    weighbridge transaction. Payment and approval are commercial workflow
    states; they must not turn an otherwise recorded weighing into a cash-loss
    discrepancy.

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

    if tenant is not None and not tenant_has_active_module(tenant, "weighbridge"):
        # Explicit tenant-targeted sweeps are used by tests and operational
        # maintenance paths before module subscriptions are seeded.
        pass

    active_tenant_ids = set(
        get_tenants_with_active_module("weighbridge").values_list("id", flat=True)
    )

    # Revisit raised events too: a cashier may save the transaction after the
    # grace period, in which case the outstanding discrepancy is auto-resolved.
    qs = OverweightEvent.objects.all()
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)

    created = 0
    reconciled = 0
    skipped = 0

    for event in qs.select_related("branch", "tenant"):
        event_tenant = event.tenant
        if event_tenant is None and event.branch_id:
            event_tenant = resolve_tenant_for_branch(event.branch)
            if event_tenant is not None and event.tenant_id != event_tenant.id:
                event.tenant = event_tenant
                event.save(update_fields=["tenant", "updated_at"])
        if event_tenant is None:
            skipped += 1
            continue
        if active_tenant_ids and event_tenant.id not in active_tenant_ids:
            skipped += 1
            continue

        # Determine grace window from branch config (default 30 min)
        grace_minutes = 30
        if event.branch_id:
            try:
                cfg = OverweightConfig.objects.get(branch_id=event.branch_id)
                grace_minutes = cfg.grace_window_minutes
            except OverweightConfig.DoesNotExist:
                pass

        matched = reconcile_overweight_event(event, grace_minutes=grace_minutes)
        if matched:
            if event.discrepancy_raised:
                discrepancy = getattr(event, "discrepancy", None)
                if discrepancy and discrepancy.resolution_status != "resolved":
                    automatic_note = (
                        f"Automatically reconciled with transaction "
                        f"TX-{matched.id:05d}."
                    )
                    discrepancy.resolution_status = "resolved"
                    discrepancy.resolution_note = automatic_note
                    discrepancy.resolved_at = now
                    discrepancy.save(update_fields=[
                        "resolution_status", "resolution_note", "resolved_at", "updated_at",
                    ])
                    reconciled += 1
            continue

        if event.discrepancy_raised:
            # An unresolved discrepancy remains in the audit queue until a
            # reviewer resolves it or a later sweep finds its transaction.
            continue

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

    return {"created": created, "skipped": skipped, "reconciled": reconciled}
