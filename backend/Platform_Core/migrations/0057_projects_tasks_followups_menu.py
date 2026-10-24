# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


def add_projects_followups_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    section = WorkspaceMenuSection.objects.filter(key="projects-tasks").first()
    if section:
        WorkspaceMenuItem.objects.update_or_create(section=section, key="follow-ups", defaults={"title": "Follow-ups", "icon": "calendar-check", "route_path": "/projects/follow-ups", "api_path": "/api/projects/follow-ups/", "required_module": section.module, "sort_order": 8, "is_active": True})


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0056_projects_tasks_reports_menu")]
    operations = [migrations.RunPython(add_projects_followups_menu, migrations.RunPython.noop)]
