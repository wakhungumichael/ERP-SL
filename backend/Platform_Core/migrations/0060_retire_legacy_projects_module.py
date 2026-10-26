# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Retire the unused legacy ``projects`` subscription module.

The implemented project domain is ``SL_Projects`` and its supported module
slug is ``projects-tasks``. The old ``projects`` row has no workspace menu or
API implementation, but could still be activated through historical plans.
Keep the records for auditability while disabling them everywhere.
"""
from django.db import migrations


def retire_legacy_projects_module(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    PlanModule = apps.get_model("Platform_Core", "PlanModule")
    TenantModuleActivation = apps.get_model("Platform_Core", "TenantModuleActivation")

    legacy_module = ModuleDefinition.objects.filter(slug="projects").first()
    if legacy_module is None:
        return
    PlanModule.objects.filter(module=legacy_module).update(is_enabled=False)
    TenantModuleActivation.objects.filter(module=legacy_module).exclude(status="disabled").update(status="disabled")
    if legacy_module.is_active:
        legacy_module.is_active = False
        legacy_module.save(update_fields=["is_active", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0059_tenant_theme_colors")]

    operations = [migrations.RunPython(retire_legacy_projects_module, migrations.RunPython.noop)]
