from django.db import migrations


def seed_budgeting_and_requisition_menu(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    budgeting_module = ModuleDefinition.objects.filter(slug="budgeting").first()
    procurement_module = ModuleDefinition.objects.filter(slug="procurement").first()
    finance_section = WorkspaceMenuSection.objects.filter(key="finance").first()

    if budgeting_module:
        budgeting_section, _ = WorkspaceMenuSection.objects.update_or_create(
            key="budgeting",
            defaults={
                "title": "Budgeting",
                "icon": "account_balance",
                "description": "Budget controls, commitments, and financial guardrails.",
                "module": budgeting_module,
                "sort_order": 25,
                "is_active": True,
                "is_system": True,
            },
        )
        WorkspaceMenuItem.objects.update_or_create(
            section=budgeting_section,
            key="budget-overview",
            defaults={
                "title": "Budget Overview",
                "icon": "account_balance_wallet",
                "description": "Track allocated, committed, obligated, and available budgets.",
                "route_path": "/budgeting/overview",
                "api_path": "/api/budgeting/dashboard/",
                "required_module": budgeting_module,
                "sort_order": 10,
                "is_active": True,
            },
        )

    if finance_section and procurement_module:
        WorkspaceMenuItem.objects.update_or_create(
            section=finance_section,
            key="requisitions",
            defaults={
                "title": "Requisitions",
                "icon": "fact_check",
                "description": "Create, review, approve, and convert requisitions into purchase orders.",
                "route_path": "/procurement/requisitions",
                "api_path": "/api/procurement/requisitions/",
                "required_module": procurement_module,
                "sort_order": 25,
                "is_active": True,
            },
        )


def unseed_budgeting_and_requisition_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    WorkspaceMenuItem.objects.filter(key="requisitions").delete()
    WorkspaceMenuSection.objects.filter(key="budgeting").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0011_accounting_periods"),
    ]

    operations = [
        migrations.RunPython(seed_budgeting_and_requisition_menu, unseed_budgeting_and_requisition_menu),
    ]

