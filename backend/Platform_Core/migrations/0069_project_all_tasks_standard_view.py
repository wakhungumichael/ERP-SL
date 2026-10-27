from django.db import migrations


def align_project_workspace_permissions(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    permissions_by_item = {
        "projects": ["SL_Projects.view_project", "SL_Projects.add_project"],
        "all-tasks": ["SL_Projects.view_projecttask", "SL_Projects.view_all_projecttask"],
    }
    for item in Item.objects.filter(section__key="projects-tasks", key__in=permissions_by_item):
        metadata = dict(item.metadata or {})
        metadata["required_any_permissions"] = permissions_by_item[item.key]
        item.metadata = metadata
        item.required_permission = ""
        item.save(update_fields=["metadata", "required_permission", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0068_project_menu_legacy_task_view")]
    operations = [migrations.RunPython(align_project_workspace_permissions, migrations.RunPython.noop)]
