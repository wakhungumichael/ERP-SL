# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Expose personal project workspaces to roles using the standard task view right."""
from django.db import migrations


MENU_PERMISSIONS = {
    "overview": ["SL_Projects.view_project_dashboard", "SL_Projects.view_projecttask", "SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
    "my-tasks": ["SL_Projects.view_projecttask", "SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
    "task-board": ["SL_Projects.view_projecttask", "SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
    "task-calendar": ["SL_Projects.view_projecttask", "SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
    "follow-ups": ["SL_Projects.view_projecttask", "SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
}


def apply_permissions(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for key, permissions in MENU_PERMISSIONS.items():
        for item in Item.objects.filter(section__key="projects-tasks", key=key):
            metadata = dict(item.metadata or {})
            metadata["required_any_permissions"] = permissions
            item.metadata = metadata
            item.save(update_fields=["metadata"])


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0067_tenant_dashboard_layouts")]
    operations = [migrations.RunPython(apply_permissions, migrations.RunPython.noop)]
