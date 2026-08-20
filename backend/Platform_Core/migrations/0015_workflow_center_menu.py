from django.db import migrations


def seed_workflow_center_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    section = WorkspaceMenuSection.objects.filter(key="platform-admin").first()
    if not section:
        return

    WorkspaceMenuItem.objects.update_or_create(
        section=section,
        key="workflow-center",
        defaults={
            "title": "Workflow Center",
            "icon": "account_tree",
            "description": "Central workflow configuration, approval routing, and dashboard inbox setup.",
            "route_path": "/platform/workflows",
            "api_path": "/api/platform/workflows/definitions/",
            "sort_order": 27,
            "is_active": True,
        },
    )


def unseed_workflow_center_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(key="workflow-center").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0014_workflow_center"),
    ]

    operations = [
        migrations.RunPython(seed_workflow_center_menu, unseed_workflow_center_menu),
    ]

