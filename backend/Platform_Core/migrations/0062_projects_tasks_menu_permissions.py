"""Make Projects & Tasks navigation follow each active role's permissions."""

from django.db import migrations


MENU_PERMISSIONS = {
    "overview": ["SL_Projects.view_project_dashboard"],
    "projects": ["SL_Projects.view_project"],
    "all-tasks": ["SL_Projects.view_all_projecttask"],
    "my-tasks": ["SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
    "team-tasks": ["SL_Projects.view_all_projecttask"],
    "task-board": ["SL_Projects.view_all_projecttask"],
    "task-calendar": ["SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
    "reports": ["SL_Projects.export_project", "SL_Projects.export_projecttask"],
    "follow-ups": ["SL_Projects.view_own_projecttask", "SL_Projects.view_all_projecttask"],
}


def apply_project_menu_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for key, permissions in MENU_PERMISSIONS.items():
        for item in WorkspaceMenuItem.objects.filter(section__key="projects-tasks", key=key):
            metadata = dict(item.metadata or {})
            metadata["required_any_permissions"] = permissions
            item.metadata = metadata
            item.save(update_fields=["metadata"])


def remove_project_menu_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for item in WorkspaceMenuItem.objects.filter(section__key="projects-tasks", key__in=MENU_PERMISSIONS):
        metadata = dict(item.metadata or {})
        metadata.pop("required_any_permissions", None)
        item.metadata = metadata
        item.save(update_fields=["metadata"])


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0060_retire_legacy_projects_module")]

    operations = [migrations.RunPython(apply_project_menu_permissions, remove_project_menu_permissions)]
