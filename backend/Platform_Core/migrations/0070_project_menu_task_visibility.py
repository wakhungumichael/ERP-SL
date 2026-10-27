from django.db import migrations


def align_projects_menu(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for item in Item.objects.filter(section__key="projects-tasks", key="projects"):
        metadata = dict(item.metadata or {})
        metadata["required_any_permissions"] = [
            "SL_Projects.view_project",
            "SL_Projects.add_project",
            "SL_Projects.view_projecttask",
            "SL_Projects.view_own_projecttask",
            "SL_Projects.view_all_projecttask",
        ]
        item.metadata = metadata
        item.required_permission = ""
        item.save(update_fields=["metadata", "required_permission", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0069_project_all_tasks_standard_view")]

    operations = [migrations.RunPython(align_projects_menu, migrations.RunPython.noop)]
