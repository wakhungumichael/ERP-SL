from __future__ import annotations

import json
import os
import subprocess
import zipfile
from collections import defaultdict
from pathlib import Path

from django.apps import apps
from django.contrib.auth.models import Group, User
from django.conf import settings
from django.core import serializers
from django.db import connection, models
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

EXCLUDED_EXPORT_MODELS = {
    "admin.LogEntry",
    "authtoken.Token",
}

_EXISTING_TABLE_NAMES = None


def _database_url() -> str:
    return os.getenv("DATABASE_URL") or getattr(settings, "DATABASE_URL", "") or ""


def resolve_backup_directory(policy) -> Path:
    raw_path = (policy.target_path or "").strip()
    if raw_path:
        base = Path(raw_path).expanduser()
    else:
        base = Path(settings.BASE_DIR) / "backups"
        if policy.tenant and getattr(policy.tenant, "code", ""):
            base = base / policy.tenant.code
        else:
            base = base / "general"
    return base.resolve()


def build_backup_filename(policy) -> str:
    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    tenant_slug = policy.tenant.code if policy.tenant else "general"
    extension = "zip" if policy.tenant_id else "dump"
    return f"{tenant_slug}_{slugify(policy.name) or 'backup'}_{timestamp}.{extension}"


def _iter_export_models():
    for model in apps.get_models():
        opts = model._meta
        if opts.proxy or opts.auto_created or opts.label in EXCLUDED_EXPORT_MODELS or not _table_exists(model):
            continue
        yield model


def _existing_table_names():
    global _EXISTING_TABLE_NAMES
    if _EXISTING_TABLE_NAMES is None:
        _EXISTING_TABLE_NAMES = set(connection.introspection.table_names())
    return _EXISTING_TABLE_NAMES


def _table_exists(model):
    return model._meta.db_table in _existing_table_names()


def _tenant_relation_field(model):
    for field in model._meta.get_fields():
        if (
            isinstance(field, (models.ForeignKey, models.OneToOneField))
            and field.concrete
            and field.name == "tenant"
            and getattr(field.related_model._meta, "label", "") == "Platform_Core.Tenant"
        ):
            return field
    return None


def _ordered_queryset(model, *, pks=None):
    queryset = model._default_manager.all()
    if pks is not None:
        queryset = queryset.filter(pk__in=pks)
    return queryset.order_by(model._meta.pk.name)


def _seed_tenant_model_ids(tenant):
    included = defaultdict(set)
    Tenant = apps.get_model("Platform_Core", "Tenant")
    included[Tenant].add(tenant.pk)

    for model in _iter_export_models():
        field = _tenant_relation_field(model)
        if field is None:
            continue
        ids = _ordered_queryset(model).filter(**{field.name: tenant}).values_list("pk", flat=True)
        included[model].update(ids)
    return included


def _expand_descendant_model_ids(included):
    models_to_scan = list(_iter_export_models())
    changed = True

    while changed:
        changed = False
        for model in models_to_scan:
            query = Q()
            for field in model._meta.get_fields():
                if not isinstance(field, (models.ForeignKey, models.OneToOneField)) or not field.concrete:
                    continue
                target_ids = included.get(field.related_model)
                if target_ids:
                    query |= Q(**{f"{field.name}__in": list(target_ids)})

            if not query:
                continue

            queryset = model._default_manager.filter(query)
            existing_ids = included.get(model)
            if existing_ids:
                queryset = queryset.exclude(pk__in=existing_ids)

            new_ids = set(queryset.values_list("pk", flat=True))
            if new_ids:
                included[model].update(new_ids)
                changed = True


def _include_auth_dependencies(included, tenant):
    user_ids = set()
    group_ids = set(
        Group.objects.filter(name__startswith=f"tenant:{tenant.pk}:").values_list("pk", flat=True)
    )

    for model, ids in list(included.items()):
        if not ids:
            continue
        queryset = _ordered_queryset(model, pks=ids)
        for field in model._meta.fields:
            if not isinstance(field, (models.ForeignKey, models.OneToOneField)):
                continue
            if field.related_model is User:
                user_ids.update(
                    queryset.exclude(**{field.attname: None}).values_list(field.attname, flat=True)
                )
            elif field.related_model is Group:
                group_ids.update(
                    queryset.exclude(**{field.attname: None}).values_list(field.attname, flat=True)
                )

    if user_ids:
        included[User].update(user_ids)
    if group_ids:
        included[Group].update(group_ids)


def _serialize_model_records(model, ids):
    if not ids:
        return "[]"
    try:
        return serializers.serialize("json", _ordered_queryset(model, pks=ids))
    except Exception as exc:
        raise RuntimeError(f"Failed to serialize {model._meta.label}: {exc}") from exc


def _write_media_files(archive, model, ids):
    if not ids:
        return []

    file_fields = [field for field in model._meta.fields if isinstance(field, models.FileField)]
    if not file_fields:
        return []

    exported_files = []
    seen = set()
    for instance in _ordered_queryset(model, pks=ids):
        for field in file_fields:
            file_value = getattr(instance, field.name, None)
            storage = getattr(file_value, "storage", None)
            file_name = getattr(file_value, "name", "") if file_value else ""
            if not file_name or not storage or file_name in seen:
                continue
            if not storage.exists(file_name):
                continue

            seen.add(file_name)
            archive_name = f"media/{file_name.lstrip('/')}"
            try:
                with storage.open(file_name, "rb") as handle:
                    archive.writestr(archive_name, handle.read())
            except Exception as exc:
                raise RuntimeError(
                    f"Failed to export file '{file_name}' from {model._meta.label}: {exc}"
                ) from exc
            exported_files.append(archive_name)
    return exported_files


def _create_tenant_scoped_archive(policy) -> Path:
    tenant = policy.tenant
    if tenant is None:
        raise RuntimeError("Tenant-scoped export requires a tenant-backed backup policy.")

    backup_dir = resolve_backup_directory(policy)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_file = backup_dir / build_backup_filename(policy)

    included = _seed_tenant_model_ids(tenant)
    _expand_descendant_model_ids(included)
    _include_auth_dependencies(included, tenant)

    manifest = {
        "format": "tenant-scoped-export",
        "version": 1,
        "generated_at": timezone.now().isoformat(),
        "policy": {
            "id": policy.pk,
            "name": policy.name,
        },
        "tenant": {
            "id": tenant.pk,
            "name": tenant.name,
            "code": tenant.code,
        },
        "models": [],
        "files": [],
    }

    with zipfile.ZipFile(backup_file, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for model in sorted(included.keys(), key=lambda item: item._meta.label_lower):
            ids = sorted(included[model])
            if not ids:
                continue

            archive_name = f"data/{model._meta.label_lower}.json"
            archive.writestr(archive_name, _serialize_model_records(model, ids))
            manifest["models"].append(
                {
                    "model": model._meta.label,
                    "record_count": len(ids),
                    "archive_path": archive_name,
                }
            )
            manifest["files"].extend(_write_media_files(archive, model, ids))

        archive.writestr("manifest.json", json.dumps(manifest, indent=2, sort_keys=True))

    return backup_file


def create_backup_archive(policy) -> Path:
    if policy.tenant_id:
        return _create_tenant_scoped_archive(policy)

    db_url = _database_url()
    if not db_url:
        raise RuntimeError("DATABASE_URL is not configured.")
    if db_url.startswith("sqlite:"):
        raise RuntimeError("PostgreSQL backup is not available when DATABASE_URL points to SQLite.")

    backup_dir = resolve_backup_directory(policy)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_file = backup_dir / build_backup_filename(policy)

    env = os.environ.copy()
    subprocess.run(
        ["pg_dump", db_url, "-Fc", "-f", str(backup_file)],
        check=True,
        env=env,
    )
    return backup_file
