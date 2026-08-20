from __future__ import annotations

import json
from threading import local

from django.apps import apps
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.signals import m2m_changed, post_delete, post_save, pre_delete, pre_save
from django.db.utils import OperationalError, ProgrammingError
from django.http import HttpRequest


_state = local()
_registered = False
_auth_registered = False
_SKIPPED_MODEL_LABELS = {
    "Platform_Core.AuditEventLog",
    "Platform_Core.AuditAccessLog",
}
_TRACKED_EXTERNAL_MODEL_LABELS = {
    "auth.Group",
    "auth.User",
}


def set_audit_request(request: HttpRequest | None):
    _state.request = request
    _state.user = getattr(request, "user", None) if request else None
    _state.tenant = _resolve_request_tenant(request) if request else None


def clear_audit_request():
    _state.request = None
    _state.user = None
    _state.tenant = None


def get_current_request():
    return getattr(_state, "request", None)


def get_current_user():
    user = getattr(_state, "user", None)
    if getattr(user, "is_authenticated", False):
        return user
    return None


def get_current_tenant():
    tenant = getattr(_state, "tenant", None)
    if tenant is not None:
        return tenant
    user = get_current_user()
    if not user:
        return None
    profile = getattr(user, "tenant_profile", None)
    return getattr(profile, "tenant", None)


def _resolve_request_tenant(request):
    if request is None:
        return None
    user = getattr(request, "user", None)
    if getattr(user, "is_authenticated", False) and getattr(user, "is_superuser", False):
        tenant_id = request.GET.get("tenant_id") or request.POST.get("tenant_id")
        if tenant_id:
            Tenant = apps.get_model("Platform_Core", "Tenant")
            return Tenant.objects.filter(pk=tenant_id).first()
    if getattr(user, "is_authenticated", False):
        profile = getattr(user, "tenant_profile", None)
        return getattr(profile, "tenant", None)
    return None


def _should_track_model(model):
    opts = model._meta
    if opts.abstract or opts.proxy or opts.auto_created:
        return False
    if opts.label in _SKIPPED_MODEL_LABELS:
        return False
    return (
        opts.app_label.startswith("Platform_")
        or opts.app_label.startswith("SL_")
        or opts.label in _TRACKED_EXTERNAL_MODEL_LABELS
    )


def _instance_snapshot(instance):
    data = {}
    for field in instance._meta.concrete_fields:
        data[field.name] = field.value_from_object(instance)
    return data


def _json_ready(data):
    def _fallback(value):
        try:
            return DjangoJSONEncoder().default(value)
        except TypeError:
            return str(value)

    return json.loads(json.dumps(data, default=_fallback))


def _diff_snapshots(before, after):
    changed = {}
    keys = set(before.keys()) | set(after.keys())
    for key in sorted(keys):
        if before.get(key) != after.get(key):
            changed[key] = {
                "before": before.get(key),
                "after": after.get(key),
            }
    return changed


def _resolve_instance_tenant(instance):
    if hasattr(instance, "tenant_id"):
        return getattr(instance, "tenant", None)
    for candidate in ("financial_year", "period", "entry", "estimate", "sales_order", "budget", "purchase_order", "invoice", "transaction"):
        related = getattr(instance, candidate, None)
        if related is not None and hasattr(related, "tenant"):
            return getattr(related, "tenant", None)
    return get_current_tenant()


def _resolve_instance_branch(instance):
    def _normalize_branch(branch):
        if branch is None:
            return None
        if getattr(branch._meta, "label", "") == "Platform_Core.TenantBranch":
            return branch
        return None

    if hasattr(instance, "branch_id"):
        return _normalize_branch(getattr(instance, "branch", None))
    for candidate in ("estimate", "sales_order", "invoice", "transaction"):
        related = getattr(instance, candidate, None)
        if related is not None and hasattr(related, "branch"):
            return _normalize_branch(getattr(related, "branch", None))
    user = get_current_user()
    profile = getattr(user, "tenant_profile", None) if user else None
    return _normalize_branch(getattr(profile, "branch", None))


def _extract_client_ip(request):
    forwarded_for = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()[:64]
    real_ip = (request.META.get("HTTP_X_REAL_IP") or "").strip()
    if real_ip:
        return real_ip[:64]
    return (request.META.get("REMOTE_ADDR") or "")[:64]


def _request_metadata(request=None, response=None):
    request = request or get_current_request()
    if request is None:
        return {"authenticated": False}
    try:
        host = request.get_host()[:255] if hasattr(request, "get_host") else ""
    except Exception:
        host = ((request.META.get("HTTP_HOST") or request.META.get("SERVER_NAME") or ""))[:255]
    return {
        "host": host,
        "method": request.method,
        "path": request.path,
        "full_path": request.get_full_path()[:500] if hasattr(request, "get_full_path") else request.path,
        "query_params": dict(request.GET.lists()),
        "remote_addr": (request.META.get("REMOTE_ADDR") or "")[:64],
        "client_ip": _extract_client_ip(request),
        "forwarded_for": (request.META.get("HTTP_X_FORWARDED_FOR") or "")[:255],
        "real_ip": (request.META.get("HTTP_X_REAL_IP") or "")[:64],
        "referer": (request.META.get("HTTP_REFERER") or "")[:500],
        "origin": (request.META.get("HTTP_ORIGIN") or "")[:255],
        "scheme": "https" if request.is_secure() else "http",
        "server_name": (request.META.get("SERVER_NAME") or "")[:255],
        "server_port": (request.META.get("SERVER_PORT") or "")[:16],
        "content_type": (request.META.get("CONTENT_TYPE") or "")[:120],
        "accept": (request.META.get("HTTP_ACCEPT") or "")[:255],
        "authenticated": bool(getattr(getattr(request, "user", None), "is_authenticated", False)),
        "session_key": getattr(getattr(request, "session", None), "session_key", None),
        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:500],
        "response_status_code": getattr(response, "status_code", None),
    }


def log_model_event(*, instance, action, changes=None, previous=None, current=None, note="", metadata=None):
    AuditEventLog = apps.get_model("Platform_Core", "AuditEventLog")
    tenant = _resolve_instance_tenant(instance)
    branch = _resolve_instance_branch(instance)
    actor = get_current_user()
    try:
        AuditEventLog.objects.create(
            tenant=tenant,
            branch=branch,
            event_group="data_lifecycle",
            event_type=action,
            actor=actor,
            content_object=instance,
            object_repr=str(instance)[:255],
            model_label=instance._meta.label,
            object_pk=str(instance.pk),
            changes=_json_ready(changes or {}),
            previous_values=_json_ready(previous or {}),
            current_values=_json_ready(current or {}),
            status="success",
            note=note,
            metadata=_json_ready({**_request_metadata(), **(metadata or {})}),
        )
    except (OperationalError, ProgrammingError):
        return None


def log_business_event(*, event_group, event_type, tenant=None, actor=None, obj=None, branch=None, note="", metadata=None, status="success"):
    AuditEventLog = apps.get_model("Platform_Core", "AuditEventLog")
    if tenant is None and obj is not None:
        tenant = _resolve_instance_tenant(obj)
    if branch is None and obj is not None:
        branch = _resolve_instance_branch(obj)
    if actor is None:
        actor = get_current_user()
    try:
        payload = dict(
            tenant=tenant,
            branch=branch,
            event_group=event_group,
            event_type=event_type,
            actor=actor,
            object_id=str(obj.pk) if obj is not None and obj.pk is not None else "",
            object_repr=str(obj)[:255] if obj is not None else "",
            model_label=obj._meta.label if obj is not None else "",
            object_pk=str(obj.pk) if obj is not None and obj.pk is not None else "",
            status=status,
            note=note,
            metadata=_json_ready({**_request_metadata(), **(metadata or {})}),
        )
        if obj is not None:
            payload["content_object"] = obj
        AuditEventLog.objects.create(**payload)
    except (OperationalError, ProgrammingError):
        return None


def log_access_event(*, request, response=None, tenant=None, user=None, event_type="view"):
    AuditAccessLog = apps.get_model("Platform_Core", "AuditAccessLog")
    request_path = getattr(request, "path", "") or ""
    if request_path.startswith("/django-static/") or request_path.startswith("/media/"):
        return None
    actor = user if getattr(user, "is_authenticated", False) else None
    if tenant is None:
        tenant = _resolve_request_tenant(request)
    profile = getattr(actor, "tenant_profile", None) if actor else None
    branch = getattr(profile, "branch", None)
    status_code = getattr(response, "status_code", None)
    event_group = "access"
    if "auth/" in request.path:
        event_group = "security"
    try:
        return AuditAccessLog.objects.create(
            tenant=tenant,
            branch=branch,
            actor=actor,
            event_group=event_group,
            event_type=event_type,
            request_method=(getattr(request, "method", "") or "")[:10],
            request_path=request_path[:500],
            query_params=_json_ready(dict(request.GET.lists())) if hasattr(request, "GET") else {},
            status_code=status_code,
            remote_addr=_extract_client_ip(request),
            user_agent=(getattr(request, "META", {}) or {}).get("HTTP_USER_AGENT", "")[:500],
            metadata=_json_ready(_request_metadata(request=request, response=response)),
        )
    except (OperationalError, ProgrammingError):
        return None


def get_record_audit_summary(*, model_label, object_pk, tenant=None):
    AuditEventLog = apps.get_model("Platform_Core", "AuditEventLog")
    try:
        qs = AuditEventLog.objects.select_related("actor").filter(
            model_label=model_label,
            object_pk=str(object_pk),
        )
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
    except (OperationalError, ProgrammingError):
        return {
            "created_by_id": None,
            "created_by_name": None,
            "created_on": None,
            "updated_by_id": None,
            "updated_by_name": None,
            "updated_on": None,
            "deleted_by_id": None,
            "deleted_by_name": None,
            "deleted_on": None,
        }
    created = qs.filter(event_type="create").order_by("created_at", "id").first()
    updated = qs.filter(event_type__in=["update", "create"]).order_by("-created_at", "-id").first()
    deleted = qs.filter(event_type="delete").order_by("-created_at", "-id").first()
    return {
        "created_by_id": getattr(getattr(created, "actor", None), "id", None),
        "created_by_name": ((created.actor.get_full_name() or created.actor.username) if getattr(created, "actor", None) else None),
        "created_on": getattr(created, "created_at", None),
        "updated_by_id": getattr(getattr(updated, "actor", None), "id", None),
        "updated_by_name": ((updated.actor.get_full_name() or updated.actor.username) if getattr(updated, "actor", None) else None),
        "updated_on": getattr(updated, "created_at", None),
        "deleted_by_id": getattr(getattr(deleted, "actor", None), "id", None),
        "deleted_by_name": ((deleted.actor.get_full_name() or deleted.actor.username) if getattr(deleted, "actor", None) else None),
        "deleted_on": getattr(deleted, "created_at", None),
    }


def _capture_previous_state(sender, instance, **kwargs):
    if not _should_track_model(sender) or not instance.pk:
        return
    previous = sender.objects.filter(pk=instance.pk).values().first()
    instance._audit_previous_state = previous or {}


def _capture_deleted_state(sender, instance, **kwargs):
    if not _should_track_model(sender):
        return
    instance._audit_deleted_state = _instance_snapshot(instance)


def _log_saved_state(sender, instance, created, **kwargs):
    if not _should_track_model(sender):
        return
    current = _instance_snapshot(instance)
    if created:
        log_model_event(
            instance=instance,
            action="create",
            changes={key: {"before": None, "after": value} for key, value in current.items()},
            previous={},
            current=current,
        )
        return
    previous = getattr(instance, "_audit_previous_state", {}) or {}
    changes = _diff_snapshots(previous, current)
    if not changes:
        return
    log_model_event(
        instance=instance,
        action="update",
        changes=changes,
        previous=previous,
        current=current,
    )


def _log_deleted_state(sender, instance, **kwargs):
    if not _should_track_model(sender):
        return
    previous = getattr(instance, "_audit_deleted_state", {}) or _instance_snapshot(instance)
    log_model_event(
        instance=instance,
        action="delete",
        changes={key: {"before": value, "after": None} for key, value in previous.items()},
        previous=previous,
        current={},
    )


def _resolve_m2m_actor():
    return get_current_user()


def _resolve_m2m_tenant(instance):
    return _resolve_instance_tenant(instance)


def _resolve_m2m_branch(instance):
    return _resolve_instance_branch(instance)


def _make_m2m_handler(field_name):
    def _handler(sender, instance, action, reverse, model, pk_set, **kwargs):
        if reverse:
            return
        if not _should_track_model(instance.__class__):
            return
        if action not in {"post_add", "post_remove", "post_clear"}:
            return

        related_ids = sorted(pk_set) if pk_set else []
        relation_action = {
            "post_add": "m2m_add",
            "post_remove": "m2m_remove",
            "post_clear": "m2m_clear",
        }[action]
        message = f"{field_name} relation {relation_action.replace('m2m_', '')}"
        changes = {
            field_name: {
                "action": relation_action,
                "related_model": model._meta.label,
                "related_ids": related_ids,
            }
        }
        try:
            AuditEventLog = apps.get_model("Platform_Core", "AuditEventLog")
            AuditEventLog.objects.create(
                tenant=_resolve_m2m_tenant(instance),
                branch=_resolve_m2m_branch(instance),
                actor=_resolve_m2m_actor(),
                event_group="data_lifecycle",
                event_type=relation_action,
                content_object=instance,
                object_repr=str(instance)[:255],
                model_label=instance._meta.label,
                object_pk=str(instance.pk),
                changes=_json_ready(changes),
                previous_values={},
                current_values={field_name: related_ids},
                status="success",
                note=message,
                metadata=_json_ready({**_request_metadata(), "relation_field": field_name}),
            )
        except (OperationalError, ProgrammingError):
            return None

    return _handler


def _log_user_logged_in(sender, request, user, **kwargs):
    tenant = getattr(getattr(user, "tenant_profile", None), "tenant", None)
    log_access_event(request=request, tenant=tenant, user=user, event_type="login")


def _log_user_logged_out(sender, request, user, **kwargs):
    tenant = getattr(getattr(user, "tenant_profile", None), "tenant", None) if user else None
    log_access_event(request=request, tenant=tenant, user=user, event_type="logout")


def register_audit_signals():
    global _registered
    if _registered:
        return
    for model in apps.get_models():
        if not _should_track_model(model):
            continue
        pre_save.connect(_capture_previous_state, sender=model, weak=False, dispatch_uid=f"audit-pre-save-{model._meta.label}")
        post_save.connect(_log_saved_state, sender=model, weak=False, dispatch_uid=f"audit-post-save-{model._meta.label}")
        pre_delete.connect(_capture_deleted_state, sender=model, weak=False, dispatch_uid=f"audit-pre-delete-{model._meta.label}")
        post_delete.connect(_log_deleted_state, sender=model, weak=False, dispatch_uid=f"audit-post-delete-{model._meta.label}")
        for field in model._meta.many_to_many:
            m2m_changed.connect(
                _make_m2m_handler(field.name),
                sender=field.remote_field.through,
                weak=False,
                dispatch_uid=f"audit-m2m-{model._meta.label}-{field.name}",
            )
    _registered = True


def register_auth_signals():
    global _auth_registered
    if _auth_registered:
        return
    user_logged_in.connect(_log_user_logged_in, weak=False, dispatch_uid="audit-user-logged-in")
    user_logged_out.connect(_log_user_logged_out, weak=False, dispatch_uid="audit-user-logged-out")
    _auth_registered = True
