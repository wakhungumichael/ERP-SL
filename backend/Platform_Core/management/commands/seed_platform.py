"""
Management command: seed platform ModuleDefinitions and SubscriptionPlans.
Safe to run multiple times — uses get_or_create and updates existing records.
"""
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

from Platform_Core.module_registry import (
    get_default_industry_slugs_by_module,
    sync_module_definitions,
)
from Platform_Core.models import (
    Industry,
    ModuleDefinition,
    PlanModule,
    PricingRuleType,
    SubscriptionPlan,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
)

INDUSTRIES = [
    {
        "slug": "logistics-transport",
        "name": "Logistics & Transport",
        "description": "Fleet, dispatch, weighbridge, routing, and freight operations.",
    },
    {
        "slug": "manufacturing",
        "name": "Manufacturing",
        "description": "Production, raw materials, warehouse, procurement, and cost control.",
    },
    {
        "slug": "construction",
        "name": "Construction",
        "description": "Project delivery, materials, subcontracting, and equipment operations.",
    },
    {
        "slug": "agriculture",
        "name": "Agriculture",
        "description": "Farm supply chains, produce intake, agro-processing, and field operations.",
    },
    {
        "slug": "energy-mining",
        "name": "Energy & Mining",
        "description": "Bulk movement, extraction logistics, compliance, and asset-heavy operations.",
    },
    {
        "slug": "general-trade",
        "name": "General Trade",
        "description": "Sales, purchasing, finance, CRM, and standard back-office workflows.",
    },
]

PLANS = [
    {
        "code": "starter",
        "name": "Starter",
        "billing_period": "monthly",
        "price": "49.00",
        "currency": "KES",
        "trial_days": 14,
        "max_users": 5,
        "max_branches": 1,
        "max_devices": 2,
        "max_monthly_transactions": 1000,
        "is_active": True,
        "features": {"support": "email", "sla": "48h"},
    },
    {
        "code": "starter-annual",
        "name": "Starter Annual",
        "billing_period": "annual",
        "price": "490.00",
        "currency": "KES",
        "trial_days": 14,
        "max_users": 5,
        "max_branches": 1,
        "max_devices": 2,
        "max_monthly_transactions": 1000,
        "is_active": True,
        "features": {"support": "email", "sla": "48h", "annual_commitment": True},
    },
    {
        "code": "professional",
        "name": "Professional",
        "billing_period": "monthly",
        "price": "79.00",
        "currency": "KES",
        "trial_days": 14,
        "max_users": 20,
        "max_branches": 3,
        "max_devices": 10,
        "max_monthly_transactions": 10000,
        "is_active": True,
        "features": {"support": "email+phone", "sla": "24h", "api_access": True},
    },
    {
        "code": "professional-annual",
        "name": "Professional Annual",
        "billing_period": "annual",
        "price": "790.00",
        "currency": "KES",
        "trial_days": 14,
        "max_users": 20,
        "max_branches": 3,
        "max_devices": 10,
        "max_monthly_transactions": 10000,
        "is_active": True,
        "features": {"support": "email+phone", "sla": "24h", "api_access": True, "annual_commitment": True},
    },
    {
        "code": "enterprise",
        "name": "Enterprise - SL Weighbridge",
        "billing_period": "monthly",
        "price": "100.00",
        "currency": "KES",
        "trial_days": 14,
        "max_users": 200,
        "max_branches": 20,
        "max_devices": 100,
        "max_monthly_transactions": 100000,
        "is_active": True,
        "features": {
            "support": "dedicated",
            "sla": "4h",
            "api_access": True,
            "custom_branding": True,
            "white_label": True,
        },
    },
    {
        "code": "enterprise-annual",
        "name": "Enterprise - SL Weighbridge Annual",
        "billing_period": "annual",
        "price": "1000.00",
        "currency": "KES",
        "trial_days": 14,
        "max_users": 200,
        "max_branches": 20,
        "max_devices": 100,
        "max_monthly_transactions": 100000,
        "is_active": True,
        "features": {
            "support": "dedicated",
            "sla": "4h",
            "api_access": True,
            "custom_branding": True,
            "white_label": True,
            "annual_commitment": True,
        },
    },
]

PLAN_MODULES = {
    "starter": [
        "platform-core",
        "weighbridge",
        "invoicing",
        "reporting",
    ],
    "starter-annual": [
        "platform-core",
        "weighbridge",
        "invoicing",
        "reporting",
    ],
    "professional": [
        "platform-core",
        "weighbridge",
        "invoicing",
        "budgeting",
        "accounting",
        "crm",
        "ticketing",
        "reporting",
        "procurement",
    ],
    "professional-annual": [
        "platform-core",
        "weighbridge",
        "invoicing",
        "budgeting",
        "accounting",
        "crm",
        "ticketing",
        "reporting",
        "procurement",
    ],
    "enterprise": [
        "platform-core",
        "weighbridge",
        "invoicing",
        "budgeting",
        "accounting",
        "crm",
        "hr-payroll",
        "ticketing",
        "procurement",
        "reporting",
        "integrations",
    ],
    "enterprise-annual": [
        "platform-core",
        "weighbridge",
        "invoicing",
        "budgeting",
        "accounting",
        "crm",
        "hr-payroll",
        "ticketing",
        "procurement",
        "reporting",
        "integrations",
    ],
}

PRICING_RULE_TYPES = [
    {
        "slug": "customer",
        "name": "Customer Based",
        "description": "Applies a pricing adjustment for one customer or a customer segment.",
        "module_slug": "weighbridge",
        "config_schema": {"supported_conditions": ["customer_id", "customer_ids", "weight_type"]},
    },
    {
        "slug": "customer-vehicle-type",
        "name": "Customer + Vehicle Type",
        "description": "Overrides or discounts charges for a customer and vehicle-type combination.",
        "module_slug": "weighbridge",
        "config_schema": {"supported_conditions": ["customer_id", "vehicle_type_id", "weight_type"]},
    },
    {
        "slug": "vehicle-weight-band",
        "name": "Vehicle Weight Band",
        "description": "Applies pricing based on a weight range captured at the weighbridge.",
        "module_slug": "weighbridge",
        "config_schema": {"supported_conditions": ["min_weight_kg", "max_weight_kg", "vehicle_type_id", "weight_type"]},
    },
]


class Command(BaseCommand):
    help = "Seed platform module definitions and subscription plans"

    def handle(self, *args, **options):
        for data in INDUSTRIES:
            Industry.objects.update_or_create(slug=data["slug"], defaults=data)

        module_sync = sync_module_definitions()
        discovered_modules = module_sync["definitions"]
        module_industries = get_default_industry_slugs_by_module()

        new_plans = 0
        for data in PLANS:
            obj, created = SubscriptionPlan.objects.get_or_create(
                code=data["code"], defaults=data
            )
            if not created:
                for k, v in data.items():
                    setattr(obj, k, v)
                obj.save()
            if created:
                new_plans += 1

        module_map = {
            module.slug: module
            for module in ModuleDefinition.objects.all()
        }
        industry_map = {
            industry.slug: industry
            for industry in Industry.objects.filter(is_active=True)
        }
        plan_map = {
            plan.code: plan
            for plan in SubscriptionPlan.objects.all()
        }
        for module_slug, industry_slugs in module_industries.items():
            module = module_map.get(module_slug)
            if not module:
                continue
            module.industries.set(
                [industry_map[slug] for slug in industry_slugs if slug in industry_map]
            )

        created_plan_modules = 0
        updated_plan_modules = 0
        for plan_code, module_slugs in PLAN_MODULES.items():
            plan = plan_map.get(plan_code)
            if not plan:
                continue
            desired = set(module_slugs)
            existing_rows = {
                row.module.slug: row
                for row in PlanModule.objects.select_related("module").filter(plan=plan)
            }
            for module_slug in desired:
                module = module_map.get(module_slug)
                if not module:
                    continue
                row, created = PlanModule.objects.get_or_create(
                    plan=plan,
                    module=module,
                    defaults={"is_enabled": True},
                )
                if created:
                    created_plan_modules += 1
                elif not row.is_enabled:
                    row.is_enabled = True
                    row.save(update_fields=["is_enabled", "updated_at"])
                    updated_plan_modules += 1
            for module_slug, row in existing_rows.items():
                should_enable = module_slug in desired
                if row.is_enabled != should_enable:
                    row.is_enabled = should_enable
                    row.save(update_fields=["is_enabled", "updated_at"])
                    updated_plan_modules += 1

        for data in PRICING_RULE_TYPES:
            module_slug = data["module_slug"]
            defaults = {
                "name": data["name"],
                "description": data["description"],
                "config_schema": data["config_schema"],
                "module": module_map.get(module_slug),
                "is_active": True,
            }
            PricingRuleType.objects.update_or_create(slug=data["slug"], defaults=defaults)

        audit_section = WorkspaceMenuSection.objects.filter(key="platform-admin").first()
        if audit_section is not None:
            WorkspaceMenuItem.objects.update_or_create(
                section=audit_section,
                key="audit-logs",
                defaults={
                    "title": "Audit Logs",
                    "icon": "history",
                    "description": "Tenant-aware audit events, access logs, and record history.",
                    "route_path": "/platform/audit",
                    "api_path": "/api/platform/audit/events/",
                    "sort_order": 35,
                    "is_active": True,
                },
            )

        ticketing_module, _ = ModuleDefinition.objects.update_or_create(
            slug="ticketing",
            defaults={
                "name": "Ticketing",
                "category": "shared",
                "scope": "organization",
                "description": "Tenant-scoped support inboxes, public forms, tracking portals, and webhook workflows.",
                "is_active": True,
            },
        )
        ticketing_section, _ = WorkspaceMenuSection.objects.update_or_create(
            key="ticketing",
            defaults={
                "title": "Ticketing",
                "icon": "ticket",
                "description": "Public support forms, queues, and automation settings.",
                "module": ticketing_module,
                "sort_order": 62,
                "is_active": True,
            },
        )
        for item_key, item_defaults in (
            (
                "overview",
                {
                    "title": "Overview",
                    "icon": "layout-dashboard",
                    "description": "Ticketing KPIs and recent activity.",
                    "route_path": "/ticketing/overview",
                    "api_path": "/api/ticketing/dashboard/",
                    "sort_order": 1,
                },
            ),
            (
                "queue",
                {
                    "title": "Agent Queue",
                    "icon": "inbox",
                    "description": "Work the shared queue and respond to requesters.",
                    "route_path": "/ticketing/queue",
                    "api_path": "/api/ticketing/tickets/",
                    "sort_order": 2,
                },
            ),
            (
                "forms",
                {
                    "title": "Forms & Schema",
                    "icon": "file-code",
                    "description": "Manage external intake schemas and embed-ready forms.",
                    "route_path": "/ticketing/forms",
                    "api_path": "/api/ticketing/forms/",
                    "sort_order": 3,
                },
            ),
            (
                "automation",
                {
                    "title": "Automation",
                    "icon": "workflow",
                    "description": "Configure routing rules and webhook endpoints.",
                    "route_path": "/ticketing/automation",
                    "api_path": "/api/ticketing/routing-rules/",
                    "sort_order": 4,
                },
            ),
            (
                "settings",
                {
                    "title": "Settings",
                    "icon": "settings-2",
                    "description": "Allowed domains, branding, portal access, and API keys.",
                    "route_path": "/ticketing/settings",
                    "api_path": "/api/ticketing/config/",
                    "sort_order": 5,
                },
            ),
        ):
            WorkspaceMenuItem.objects.update_or_create(
                section=ticketing_section,
                key=item_key,
                defaults={
                    **item_defaults,
                    "required_module": ticketing_module,
                    "is_active": True,
                },
            )

        tenant_audit_permissions = list(
            Permission.objects.filter(
                codename__in=["view_tenant_audit_logs", "view_tenant_access_logs"]
            )
        )
        global_audit_permissions = list(
            Permission.objects.filter(
                codename__in=[
                    "view_tenant_audit_logs",
                    "view_tenant_access_logs",
                    "view_global_audit_logs",
                    "view_global_access_logs",
                ]
            )
        )

        for group_name in ("Tenant Admin",):
            group, _ = Group.objects.get_or_create(name=group_name)
            if tenant_audit_permissions:
                group.permissions.add(*tenant_audit_permissions)

        for group_name in ("Platform Admin", "Superadmin"):
            group, _ = Group.objects.get_or_create(name=group_name)
            if global_audit_permissions:
                group.permissions.add(*global_audit_permissions)

        self.stdout.write(
            self.style.SUCCESS(
                f"Modules: {module_sync['created']} created, {module_sync['updated']} updated, {len(discovered_modules)} discovered. "
                f"Plans: {new_plans} created, {len(PLANS) - new_plans} updated. "
                f"Plan modules: {created_plan_modules} created, {updated_plan_modules} updated."
            )
        )
