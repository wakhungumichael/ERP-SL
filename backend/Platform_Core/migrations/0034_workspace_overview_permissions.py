from django.db import migrations


OVERVIEW_PERMISSIONS = {
    "/workspace/operations/dashboard": "Platform_Core.can_view_weighbridge_overview",
    "/weighbridge/overview": "Platform_Core.can_view_weighbridge_overview",
    "/sales/overview": "Platform_Core.can_view_sales_overview",
    "/inventory/overview": "Platform_Core.can_view_inventory_overview",
    "/workspace/finance/overview": "Platform_Core.can_view_finance_overview",
    "/finance/overview": "Platform_Core.can_view_finance_overview",
    "/crm/dashboard": "Platform_Core.can_view_crm_overview",
    "/ticketing/overview": "Platform_Core.can_view_ticketing_overview",
    "/manufacturing/overview": "Platform_Core.can_view_manufacturing_overview",
    "/retail/overview": "Platform_Core.can_view_retail_overview",
    "/services/overview": "Platform_Core.can_view_services_overview",
}


def apply_overview_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for route_path, permission in OVERVIEW_PERMISSIONS.items():
        WorkspaceMenuItem.objects.filter(route_path=route_path).update(required_permission=permission)


def remove_overview_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for route_path, permission in OVERVIEW_PERMISSIONS.items():
        WorkspaceMenuItem.objects.filter(route_path=route_path, required_permission=permission).update(required_permission="")


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0033_finance_and_erp_report_permissions"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="tenantsettings",
            options={
                "ordering": ["tenant__name"],
                "permissions": [
                    ("can_access_finance_workspace", "Can access the Finance workspace"),
                    ("can_view_erp_reports", "Can view ERP reports"),
                    ("can_view_weighbridge_overview", "Can view the Weighbridge overview"),
                    ("can_view_sales_overview", "Can view the Sales overview"),
                    ("can_view_inventory_overview", "Can view the Inventory overview"),
                    ("can_view_finance_overview", "Can view the Finance overview"),
                    ("can_view_crm_overview", "Can view the CRM overview"),
                    ("can_view_ticketing_overview", "Can view the Ticketing overview"),
                    ("can_view_manufacturing_overview", "Can view the Manufacturing overview"),
                    ("can_view_retail_overview", "Can view the Retail overview"),
                    ("can_view_services_overview", "Can view the Services overview"),
                ],
            },
        ),
        migrations.RunPython(apply_overview_permissions, remove_overview_permissions),
    ]
