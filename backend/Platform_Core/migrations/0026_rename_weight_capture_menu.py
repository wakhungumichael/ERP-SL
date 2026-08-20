from django.db import migrations


def rename_weight_capture_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    WorkspaceMenuItem.objects.filter(key="weight-capture").update(
        title="Weighment Entry",
        description="Unified ERP weighment workspace for first and second weight capture.",
        route_path="/weighbridge/weighment-entry",
    )


def revert_weight_capture_menu_name(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    WorkspaceMenuItem.objects.filter(key="weight-capture").update(
        title="Weight Capture",
        description="Capture first and second weights from one cashier workspace.",
        route_path="/weighbridge/weight-capture",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0025_weight_capture_menu"),
    ]

    operations = [
        migrations.RunPython(rename_weight_capture_menu, revert_weight_capture_menu_name),
    ]
