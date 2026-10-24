# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


def add_task_board_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    section = WorkspaceMenuSection.objects.filter(key="projects-tasks").first()
    if not section:
        return
    WorkspaceMenuItem.objects.update_or_create(
        section=section,
        key="task-board",
        defaults={
            "title": "Task Board", "icon": "columns-3", "route_path": "/projects/board",
            "api_path": "/api/projects/tasks/?page_size=100", "required_module": section.module,
            "sort_order": 5, "is_active": True,
        },
    )


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0053_projects_tasks_workspace_menu")]
    operations = [migrations.RunPython(add_task_board_menu, migrations.RunPython.noop)]
