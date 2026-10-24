# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


def add_projects_reports_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    section = WorkspaceMenuSection.objects.filter(key="projects-tasks").first()
    if section:
        WorkspaceMenuItem.objects.update_or_create(section=section, key="reports", defaults={"title": "Reports", "icon": "chart-no-axes-combined", "route_path": "/projects/reports", "api_path": "/api/projects/reports/", "required_module": section.module, "sort_order": 7, "is_active": True})


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0055_projects_tasks_calendar_menu")]
    operations = [migrations.RunPython(add_projects_reports_menu, migrations.RunPython.noop)]
