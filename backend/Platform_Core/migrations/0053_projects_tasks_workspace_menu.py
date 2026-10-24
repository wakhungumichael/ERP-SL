# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


def seed_projects_tasks_menu(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    module, _ = ModuleDefinition.objects.get_or_create(
        slug="projects-tasks",
        defaults={
            "name": "Projects & Tasks", "category": "shared", "scope": "organization",
            "description": "Branch-aware project delivery, tasks, milestones, and follow-ups.", "is_active": True,
        },
    )
    section, _ = WorkspaceMenuSection.objects.update_or_create(
        key="projects-tasks",
        defaults={
            "title": "Projects & Tasks", "icon": "kanban-square", "module": module,
            "description": "Plan projects, assign work, and follow up on deadlines.", "sort_order": 58, "is_active": True,
        },
    )
    items = (
        ("overview", "Overview", "layout-dashboard", "/projects/overview", "/api/projects/dashboard/", 1),
        ("projects", "Projects", "folder-kanban", "/projects", "/api/projects/projects/", 2),
        ("all-tasks", "All Tasks", "list-todo", "/projects/tasks", "/api/projects/tasks/", 3),
        ("my-tasks", "My Tasks", "user-check", "/projects/my-tasks", "/api/projects/tasks/?scope=mine", 4),
    )
    for key, title, icon, route_path, api_path, sort_order in items:
        WorkspaceMenuItem.objects.update_or_create(
            section=section, key=key,
            defaults={"title": title, "icon": icon, "route_path": route_path, "api_path": api_path,
                      "required_module": module, "sort_order": sort_order, "is_active": True},
        )


def unseed_projects_tasks_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuSection.objects.filter(key="projects-tasks").delete()


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0052_tenant_settings_session_timeout"), ("SL_Projects", "0001_initial")]
    operations = [migrations.RunPython(seed_projects_tasks_menu, unseed_projects_tasks_menu)]
