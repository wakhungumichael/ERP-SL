from django.db import migrations


def rename_vehicle_presence_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    WorkspaceMenuItem.objects.filter(
        key="overweight-log",
        route_path="/weighbridge/overweight-log",
    ).update(
        title="Vehicle Presence",
        description="Review vehicle presence events captured by weighbridge surveillance.",
    )


def restore_overweight_log_label(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    WorkspaceMenuItem.objects.filter(
        key="overweight-log",
        route_path="/weighbridge/overweight-log",
    ).update(
        title="Overweight Log",
        description="Review weight-threshold events captured by weighbridge surveillance.",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0022_weighbridge_workspace_menu"),
    ]

    operations = [
        migrations.RunPython(rename_vehicle_presence_menu, restore_overweight_log_label),
    ]
