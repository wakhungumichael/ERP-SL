"""Own-task readers can use their scoped dashboard and paginated board."""
from django.db import migrations


def own_workspaces(apps, schema_editor):
    Item = apps.get_model('Platform_Core', 'WorkspaceMenuItem')
    for key, permissions in {
        'overview': ['SL_Projects.view_project_dashboard', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'],
        'task-board': ['SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'],
    }.items():
        for item in Item.objects.filter(section__key='projects-tasks', key=key):
            metadata = dict(item.metadata or {})
            metadata['required_any_permissions'] = permissions
            item.metadata = metadata
            item.save(update_fields=['metadata'])


class Migration(migrations.Migration):
    dependencies = [('Platform_Core', '0063_merge_organization_setup')]
    operations = [migrations.RunPython(own_workspaces, migrations.RunPython.noop)]
