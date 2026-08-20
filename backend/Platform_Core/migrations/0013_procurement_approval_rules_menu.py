from django.db import migrations


def seed_procurement_approval_rules_menu(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    procurement_module = ModuleDefinition.objects.filter(slug="procurement").first()
    finance_section = WorkspaceMenuSection.objects.filter(key="finance").first()
    if not finance_section or not procurement_module:
        return

    WorkspaceMenuItem.objects.update_or_create(
        section=finance_section,
        key="approval-rules",
        defaults={
            "title": "Approval Rules",
            "icon": "rule",
            "description": "Configure requisition approval thresholds and routing groups.",
            "route_path": "/procurement/approval-rules",
            "api_path": "/api/procurement/approval-matrix/",
            "required_module": procurement_module,
            "sort_order": 26,
            "is_active": True,
        },
    )


def unseed_procurement_approval_rules_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(key="approval-rules").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0012_budgeting_and_requisition_menu"),
    ]

    operations = [
        migrations.RunPython(seed_procurement_approval_rules_menu, unseed_procurement_approval_rules_menu),
    ]

