from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from .models import OverweightConfig, OverweightEvent, Transaction, VehiclePresence


def resolve_tenant_for_branch(branch):
    """
    Best-effort tenant lookup for an operational weighbridge branch.

    The preferred source of truth is the Platform tenant-branch mapping.
    We fall back to operational company metadata only when the branch mapping
    is missing or still being synchronized.
    """
    if branch is None or getattr(branch, "company", None) is None:
        return None

    from Platform_Core.models import Tenant, TenantBranch

    branch_name = (getattr(branch, "name", "") or "").strip()
    company_name = (getattr(branch.company, "name", "") or "").strip()
    company_email = (getattr(branch.company, "email", "") or "").strip()
    company_phone = (getattr(branch.company, "phone", "") or "").strip()

    tenant_branch_qs = TenantBranch.objects.select_related("tenant").filter(
        name__iexact=branch_name,
        is_active=True,
    )
    if company_name:
        tenant_branch_qs = tenant_branch_qs.filter(
            Q(tenant__name__iexact=company_name)
            | Q(tenant__legal_name__iexact=company_name)
            | Q(tenant__code__iexact=company_name)
            | Q(tenant__contact_email__iexact=company_email)
            | Q(tenant__contact_phone__iexact=company_phone)
        )

    tenant_ids = list(tenant_branch_qs.values_list("tenant_id", flat=True).distinct())
    if len(tenant_ids) == 1:
        return Tenant.objects.filter(pk=tenant_ids[0]).first()

    matches = Tenant.objects.filter(
        Q(name__iexact=company_name)
        | Q(legal_name__iexact=company_name)
        | Q(code__iexact=company_name)
        | Q(contact_email__iexact=company_email)
        | Q(contact_phone__iexact=company_phone)
    ).order_by("id")
    if matches.count() == 1:
        return matches.first()
    return None


def find_matching_transaction_for_event(event, grace_minutes=None):
    """
    Find the most likely transaction that explains a surveillance event.

    Vehicle-presence events are matched by branch, optional tenant, optional
    plate number, exact weight, and a configurable timestamp window.
    """
    if event is None or event.net_weight is None:
        return None

    if grace_minutes is None:
        grace_minutes = 30
        if event.branch_id:
            cfg = OverweightConfig.objects.filter(branch_id=event.branch_id).first()
            if cfg:
                grace_minutes = cfg.grace_window_minutes

    effective_window_minutes = max(grace_minutes or 0, 1)
    start = event.recorded_at - timedelta(minutes=effective_window_minutes)
    end = event.recorded_at + timedelta(minutes=effective_window_minutes)
    weight = int(event.net_weight)

    qs = Transaction.objects.all()
    if event.branch_id:
        qs = qs.filter(branch_id=event.branch_id)
    if event.tenant_id:
        qs = qs.filter(tenant_id=event.tenant_id)
    if event.vehicle_plate:
        qs = qs.filter(vehicle__number_plate__iexact=event.vehicle_plate)

    weight_match = (
        Q(gross_weight=weight, gross_weight_date__range=(start, end)) |
        Q(tare_weight=weight, tare_weight_date__range=(start, end)) |
        Q(gross_weight=weight, gross_weight_date__isnull=True, weight_date__range=(start, end)) |
        Q(tare_weight=weight, tare_weight_date__isnull=True, weight_date__range=(start, end))
    )

    return qs.filter(weight_match).order_by("-updated_at", "-id").first()


def maybe_record_overweight_event_from_presence(presence, camera_config=None):
    """
    Promote a raw VehiclePresence reading into the modern OverweightEvent flow.

    Returns the created/existing OverweightEvent or None when the reading does
    not qualify for surveillance.
    """
    if presence is None:
        return None

    if presence.overweight_event_id:
        return presence.overweight_event

    branch = presence.branch or getattr(camera_config, "branch", None)
    if branch is None:
        return None

    cfg = OverweightConfig.objects.filter(branch=branch).first()
    if cfg is None or not cfg.surveillance_enabled:
        return None

    try:
        detected_weight = int(round(float(presence.detected_weight or 0)))
    except (TypeError, ValueError):
        return None

    threshold = int(cfg.threshold_kg)
    if detected_weight < threshold:
        return None

    tenant = presence.tenant or resolve_tenant_for_branch(branch)
    update_fields = []
    if presence.branch_id != branch.id:
        presence.branch = branch
        update_fields.append("branch")
    if tenant is not None and presence.tenant_id != tenant.id:
        presence.tenant = tenant
        update_fields.append("tenant")

    event = OverweightEvent.objects.create(
        tenant=tenant,
        branch=branch,
        vehicle_plate=(presence.plate_number or "").strip(),
        net_weight=detected_weight,
        threshold_at_capture=threshold,
        capture_source="vehicle_presence",
        discrepancy_raised=False,
    )

    if presence.image:
        event.camera_image = presence.image
        event.save(update_fields=["camera_image", "updated_at"])

    presence.overweight_event = event
    presence.locked = True
    update_fields.extend(["overweight_event", "locked"])
    presence.save(update_fields=list(dict.fromkeys(update_fields)))
    return event


def reconcile_overweight_event(event, grace_minutes=None):
    """
    Attempt to link a surveillance event to a recorded transaction.
    """
    if event is None:
        return None

    matched = event.linked_transaction or find_matching_transaction_for_event(
        event,
        grace_minutes=grace_minutes,
    )
    if matched and event.linked_transaction_id != matched.id:
        event.linked_transaction = matched
        if event.tenant_id is None and matched.tenant_id is not None:
            event.tenant = matched.tenant
            event.save(update_fields=["linked_transaction", "tenant", "updated_at"])
        else:
            event.save(update_fields=["linked_transaction", "updated_at"])
    return matched
