from django.db import migrations


def rename_project_team(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    Item.objects.using(schema_editor.connection.alias).filter(
        section__key="projects-tasks", key="team-tasks",
    ).update(title="Project team", description="Project team tasks available in the active branch.")


class Migration(migrations.Migration):
    dependencies = [
        ("SL_Projects", "0015_project_configuration_menu"),
        ("Platform_Core", "0058_projects_tasks_team_menu"),
    ]
    operations = [migrations.RunPython(rename_project_team, migrations.RunPython.noop)]
