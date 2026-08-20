from django.db import migrations


def add_weight_capture_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")

    section = WorkspaceMenuSection.objects.filter(key="weighbridge").first()
    if section is None:
        return

    weighbridge_module = (
        ModuleDefinition.objects.filter(slug="weighbridge").first()
        or ModuleDefinition.objects.filter(slug="commercial-weighbridge").first()
    )

    WorkspaceMenuItem.objects.update_or_create(
        section=section,
        key="weight-capture",
        defaults={
            "title": "Weight Capture",
            "icon": "scale",
            "description": "Capture first and second weights from one cashier workspace.",
            "route_path": "/weighbridge/weight-capture",
            "api_path": "/api/commercial-weighbridge/transactions/",
            "required_module": weighbridge_module,
            "sort_order": 15,
            "is_active": True,
        },
    )


def remove_weight_capture_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(key="weight-capture", route_path="/weighbridge/weight-capture").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0024_background_service_lease"),
    ]

    operations = [
        migrations.RunPython(add_weight_capture_menu, remove_weight_capture_menu),
    ]
