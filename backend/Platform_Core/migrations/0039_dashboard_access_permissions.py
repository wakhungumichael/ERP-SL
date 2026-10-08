from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0038_teller_receipt_window")]

    operations = [
        migrations.AlterModelOptions(
            name="tenantsettings",
            options={
                "ordering": ["tenant__name"],
                "permissions": [
                    ("can_view_workspace_dashboard", "Can view the Workspace dashboard"),
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
                    ("can_view_procurement_overview", "Can view the Procurement overview"),
                    ("can_view_budgeting_overview", "Can view the Budgeting overview"),
                    ("can_view_hr_overview", "Can view the HR overview"),
                ],
            },
        ),
    ]
