# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


def add_task_calendar_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    section = WorkspaceMenuSection.objects.filter(key="projects-tasks").first()
    if section:
        WorkspaceMenuItem.objects.update_or_create(section=section, key="task-calendar", defaults={"title": "Calendar", "icon": "calendar-days", "route_path": "/projects/calendar", "api_path": "/api/projects/tasks/?page_size=100", "required_module": section.module, "sort_order": 6, "is_active": True})


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0054_projects_tasks_kanban_menu")]
    operations = [migrations.RunPython(add_task_calendar_menu, migrations.RunPython.noop)]
