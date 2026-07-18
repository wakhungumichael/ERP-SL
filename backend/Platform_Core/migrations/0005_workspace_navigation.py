from django.db import migrations, models
import django.db.models.deletion


SECTIONS = [
    {
        "key": "operations",
        "title": "Operations",
        "icon": "scale",
        "description": "Commercial weighbridge operations, live weights, transactions, and reporting.",
        "module_slug": "commercial-weighbridge",
        "sort_order": 10,
    },
    {
        "key": "finance",
        "title": "Finance",
        "icon": "payments",
        "description": "Invoicing, collections, gateways, and accounting visibility.",
        "module_slug": "billing",
        "sort_order": 20,
    },
    {
        "key": "platform-admin",
        "title": "Platform Admin",
        "icon": "admin_panel_settings",
        "description": "Tenants, plans, licenses, integrations, and workspace setup.",
        "module_slug": "core",
        "sort_order": 30,
    },
]


ITEMS = [
    {
        "section_key": "operations",
        "key": "operations-dashboard",
        "title": "Operations Dashboard",
        "icon": "dashboard",
        "description": "Track pending weights, charges, and completed transactions.",
        "route_path": "/workspace/operations/dashboard",
        "api_path": "/api/commercial-weighbridge/dashboard/",
        "required_module_slug": "commercial-weighbridge",
        "sort_order": 10,
    },
    {
        "section_key": "operations",
        "key": "transactions",
        "title": "Transactions",
        "icon": "swap_horiz",
        "description": "Browse and action transaction flow records.",
        "route_path": "/workspace/operations/transactions",
        "api_path": "/api/commercial-weighbridge/transactions/",
        "required_module_slug": "commercial-weighbridge",
        "sort_order": 20,
    },
    {
        "section_key": "operations",
        "key": "live-weight",
        "title": "Live Weight",
        "icon": "speed",
        "description": "Resolve current indicator readings and workflow context.",
        "route_path": "/workspace/operations/live-weight",
        "api_path": "/api/commercial-weighbridge/live-weight/",
        "required_module_slug": "commercial-weighbridge",
        "sort_order": 30,
    },
    {
        "section_key": "operations",
        "key": "reports",
        "title": "Reports",
        "icon": "assessment",
        "description": "Commercial reporting and discrepancy visibility.",
        "route_path": "/workspace/operations/reports",
        "api_path": "/api/commercial-weighbridge/reports/",
        "required_module_slug": "commercial-weighbridge",
        "sort_order": 40,
    },
    {
        "section_key": "finance",
        "key": "finance-overview",
        "title": "Finance Overview",
        "icon": "account_balance_wallet",
        "description": "Finance summary for invoices, gateways, and collections.",
        "route_path": "/workspace/finance/overview",
        "api_path": "/api/payments/",
        "required_module_slug": "billing",
        "sort_order": 10,
    },
    {
        "section_key": "finance",
        "key": "invoices",
        "title": "Invoices",
        "icon": "receipt_long",
        "description": "Review issued and pending invoices.",
        "route_path": "/workspace/finance/invoices",
        "api_path": "/api/payments/invoices/",
        "required_module_slug": "billing",
        "sort_order": 20,
    },
    {
        "section_key": "finance",
        "key": "accounting",
        "title": "Accounting",
        "icon": "request_quote",
        "description": "Accounting dashboard and posting readiness.",
        "route_path": "/workspace/finance/accounting",
        "api_path": "/api/accounting/dashboard/",
        "required_module_slug": "accounting",
        "sort_order": 30,
    },
    {
        "section_key": "platform-admin",
        "key": "tenants",
        "title": "Tenants",
        "icon": "business",
        "description": "Tenant catalog and lifecycle management.",
        "route_path": "/workspace/admin/tenants",
        "api_path": "/api/platform/tenants/",
        "required_module_slug": "core",
        "sort_order": 10,
    },
    {
        "section_key": "platform-admin",
        "key": "roles-users",
        "title": "Users & Roles",
        "icon": "manage_accounts",
        "description": "Users, roles, permissions, and access checks.",
        "route_path": "/workspace/admin/users",
        "api_path": "/api/platform/users/",
        "required_module_slug": "users",
        "sort_order": 20,
    },
    {
        "section_key": "platform-admin",
        "key": "workspace-menu",
        "title": "Workspace Menu",
        "icon": "menu_open",
        "description": "Menu sections, workspace items, and role-based navigation setup.",
        "route_path": "/workspace/admin/menu",
        "api_path": "/api/platform/workspace/menu-sections/",
        "required_module_slug": "core",
        "sort_order": 25,
    },
    {
        "section_key": "platform-admin",
        "key": "licenses",
        "title": "Licenses",
        "icon": "vpn_key",
        "description": "License lifecycle and subscription activation.",
        "route_path": "/workspace/admin/licenses",
        "api_path": "/api/platform/licenses/",
        "required_module_slug": "licensing",
        "sort_order": 30,
    },
    {
        "section_key": "platform-admin",
        "key": "integrations",
        "title": "Integrations",
        "icon": "hub",
        "description": "Indicators, gateways, and endpoint health.",
        "route_path": "/workspace/admin/integrations",
        "api_path": "/api/platform/integrations/health/",
        "required_module_slug": "integrations",
        "sort_order": 40,
    },
]


def seed_workspace_navigation(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    module_map = {module.slug: module for module in ModuleDefinition.objects.all()}
    for section_data in SECTIONS:
        section_defaults = {
            "title": section_data["title"],
            "icon": section_data["icon"],
            "description": section_data["description"],
            "sort_order": section_data["sort_order"],
            "module": module_map.get(section_data["module_slug"]),
            "is_active": True,
            "is_system": True,
        }
        WorkspaceMenuSection.objects.update_or_create(key=section_data["key"], defaults=section_defaults)

    for item_data in ITEMS:
        section = WorkspaceMenuSection.objects.get(key=item_data["section_key"])
        defaults = {
            "title": item_data["title"],
            "icon": item_data["icon"],
            "description": item_data["description"],
            "route_path": item_data["route_path"],
            "api_path": item_data["api_path"],
            "required_module": module_map.get(item_data["required_module_slug"]),
            "sort_order": item_data["sort_order"],
            "is_active": True,
        }
        WorkspaceMenuItem.objects.update_or_create(section=section, key=item_data["key"], defaults=defaults)


def unseed_workspace_navigation(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuSection.objects.filter(key__in=[section["key"] for section in SECTIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0001_initial"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        # Tables were already created by 0001_initial on this installation.
        # This migration only seeds the default workspace navigation data.
        migrations.RunPython(seed_workspace_navigation, unseed_workspace_navigation),
    ]
