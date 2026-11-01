from django.db import migrations


def align_pages(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    alias = schema_editor.connection.alias
    rules = {"/projects": "SL_Projects.view_project", "/projects/overview": "SL_Projects.view_project_dashboard"}
    for item in Item.objects.using(alias).filter(route_path__in=rules):
        item.metadata = {**(item.metadata or {}), "required_any_permissions": [rules[item.route_path]]}
        item.required_permission = rules[item.route_path]
        item.save(using=alias, update_fields=["metadata", "required_permission"])


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0013_grant_task_deactivation")]
    operations = [migrations.RunPython(align_pages, migrations.RunPython.noop)]
