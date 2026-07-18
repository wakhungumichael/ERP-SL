from django.utils import timezone

from Platform_Core.models import (
    LicenseKey,
    TenantModuleActivation,
    WorkspaceMenuSection,
)


ACTIVE_SUBSCRIPTION_STATUSES = {"trial", "active", "grace"}


def derive_module_status(subscription):
    if subscription.status == "trial":
        return "trial"
    if subscription.status in {"active", "grace"}:
        return "enabled"
    return "suspended"


def sync_subscription_modules(subscription):
    sync_status = derive_module_status(subscription)
    expires_at = None
    if subscription.end_date:
        expires_at = timezone.make_aware(
            timezone.datetime.combine(subscription.end_date, timezone.datetime.max.time())
        )

    created = 0
    updated = 0
    activated_modules = []
    plan_modules = subscription.plan.modules.select_related("module").filter(is_enabled=True)

    for plan_module in plan_modules:
        activation, was_created = TenantModuleActivation.objects.get_or_create(
            tenant=subscription.tenant,
            module=plan_module.module,
            defaults={
                "subscription": subscription,
                "status": sync_status,
                "expires_at": expires_at,
                "config": plan_module.config or {},
            },
        )

        changed_fields = []
        if activation.subscription_id != subscription.id:
            activation.subscription = subscription
            changed_fields.append("subscription")
        if activation.status != sync_status:
            activation.status = sync_status
            changed_fields.append("status")
        if activation.expires_at != expires_at:
            activation.expires_at = expires_at
            changed_fields.append("expires_at")
        if plan_module.config and activation.config != plan_module.config:
            activation.config = plan_module.config
            changed_fields.append("config")

        if changed_fields:
            activation.save(update_fields=changed_fields + ["updated_at"])

        activated_modules.append(activation)
        if was_created:
            created += 1
        elif changed_fields:
            updated += 1

    return {
        "created": created,
        "updated": updated,
        "status": sync_status,
        "modules": activated_modules,
    }


def activate_license(
    license_key,
    *,
    subscription=None,
    expiry_date=None,
    seats=None,
    device_limit=None,
    notes=None,
):
    changed_fields = []
    if subscription is not None and license_key.subscription_id != subscription.id:
        license_key.subscription = subscription
        changed_fields.append("subscription")
    if license_key.status != "active":
        license_key.status = "active"
        changed_fields.append("status")
    if license_key.activation_date is None:
        license_key.activation_date = timezone.now()
        changed_fields.append("activation_date")

    resolved_expiry = expiry_date
    if resolved_expiry is None and subscription and subscription.end_date:
        resolved_expiry = timezone.make_aware(
            timezone.datetime.combine(subscription.end_date, timezone.datetime.max.time())
        )
    if resolved_expiry != license_key.expiry_date:
        license_key.expiry_date = resolved_expiry
        changed_fields.append("expiry_date")

    if seats is not None and seats != license_key.seats:
        license_key.seats = seats
        changed_fields.append("seats")
    if device_limit is not None and device_limit != license_key.device_limit:
        license_key.device_limit = device_limit
        changed_fields.append("device_limit")
    if notes:
        license_key.notes = f"{license_key.notes}\n{notes}".strip() if license_key.notes else notes
        changed_fields.append("notes")

    license_key.last_validated_at = timezone.now()
    changed_fields.append("last_validated_at")
    license_key.save(update_fields=list(dict.fromkeys(changed_fields + ["updated_at"])))
    return license_key


def validate_license(license_key, *, mark_validated=True):
    now = timezone.now()
    reasons = []

    if license_key.status != "active":
        reasons.append(f"status:{license_key.status}")
    if license_key.expiry_date and license_key.expiry_date < now:
        reasons.append("expired")
    if license_key.subscription and license_key.subscription.status not in ACTIVE_SUBSCRIPTION_STATUSES:
        reasons.append(f"subscription:{license_key.subscription.status}")
    if not license_key.tenant.is_active or license_key.tenant.status not in {"active", "draft"}:
        reasons.append(f"tenant:{license_key.tenant.status}")

    is_valid = not reasons
    if mark_validated:
        license_key.last_validated_at = now
        license_key.save(update_fields=["last_validated_at", "updated_at"])

    return {
        "valid": is_valid,
        "reasons": reasons,
        "validated_at": now,
    }


def get_tenant_module_access(tenant):
    activations = {
        activation.module_id: activation
        for activation in tenant.module_activations.select_related("module", "subscription").all()
    }
    subscriptions = tenant.subscriptions.select_related("plan").prefetch_related("plan__modules__module").all()
    licenses = tenant.licenses.select_related("subscription").all()

    rows = []
    for subscription in subscriptions:
        for plan_module in subscription.plan.modules.select_related("module").all():
            activation = activations.get(plan_module.module_id)
            rows.append(
                {
                    "module_id": plan_module.module_id,
                    "module_slug": plan_module.module.slug,
                    "module_name": plan_module.module.name,
                    "module_category": plan_module.module.category,
                    "plan_code": subscription.plan.code,
                    "plan_name": subscription.plan.name,
                    "subscription_id": subscription.id,
                    "subscription_status": subscription.status,
                    "plan_enabled": plan_module.is_enabled,
                    "usage_limit": plan_module.usage_limit,
                    "activation_status": getattr(activation, "status", "not_provisioned"),
                    "activation_expires_at": getattr(activation, "expires_at", None),
                    "config": activation.config if activation else (plan_module.config or {}),
                }
            )

    return {
        "tenant": tenant,
        "subscriptions": subscriptions,
        "licenses": licenses,
        "modules": rows,
    }


def get_active_tenant_module_slugs(tenant):
    if tenant is None:
        return set()
    return set(
        tenant.module_activations.filter(status__in={"enabled", "trial"})
        .select_related("module")
        .values_list("module__slug", flat=True)
    )


def build_workspace_navigation(*, user, tenant=None):
    active_module_slugs = get_active_tenant_module_slugs(tenant)
    user_group_ids = set(user.groups.values_list("id", flat=True)) if user.is_authenticated else set()

    sections = []
    queryset = (
        WorkspaceMenuSection.objects.filter(is_active=True)
        .select_related("module")
        .prefetch_related("items__required_module", "items__role_access__group")
    )

    for section in queryset:
        if section.module_id and active_module_slugs and section.module.slug not in active_module_slugs:
            continue

        items = []
        for item in section.items.filter(is_active=True):
            if item.required_module_id and active_module_slugs and item.required_module.slug not in active_module_slugs:
                continue
            if item.required_permission and not user.has_perm(item.required_permission):
                continue

            access_rows = [row for row in item.role_access.all() if row.can_view]
            if access_rows and not user.is_superuser:
                allowed_group_ids = {row.group_id for row in access_rows}
                if not user_group_ids.intersection(allowed_group_ids):
                    continue

            items.append(
                {
                    "id": item.id,
                    "key": item.key,
                    "title": item.title,
                    "icon": item.icon,
                    "description": item.description,
                    "route_path": item.route_path,
                    "api_path": item.api_path,
                    "badge_text": item.badge_text,
                    "required_permission": item.required_permission,
                    "required_module": getattr(item.required_module, "slug", None),
                    "is_external": item.is_external,
                    "sort_order": item.sort_order,
                    "metadata": item.metadata,
                }
            )

        if items:
            sections.append(
                {
                    "id": section.id,
                    "key": section.key,
                    "title": section.title,
                    "icon": section.icon,
                    "description": section.description,
                    "module": getattr(section.module, "slug", None),
                    "sort_order": section.sort_order,
                    "metadata": section.metadata,
                    "items": items,
                }
            )

    return {
        "tenant": tenant,
        "active_module_slugs": sorted(active_module_slugs),
        "sections": sections,
    }
