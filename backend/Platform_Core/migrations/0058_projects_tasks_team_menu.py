# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


def add_projects_team_tasks_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    section = WorkspaceMenuSection.objects.filter(key="projects-tasks").first()
    if section:
        WorkspaceMenuItem.objects.update_or_create(section=section, key="team-tasks", defaults={"title": "Team Tasks", "icon": "users-round", "route_path": "/projects/team-tasks", "api_path": "/api/projects/tasks/?scope=team", "required_module": section.module, "sort_order": 5, "is_active": True})


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0057_projects_tasks_followups_menu")]
    operations = [migrations.RunPython(add_projects_team_tasks_menu, migrations.RunPython.noop)]
