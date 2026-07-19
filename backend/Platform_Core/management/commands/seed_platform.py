"""
Management command: seed platform ModuleDefinitions and SubscriptionPlans.
Safe to run multiple times — uses get_or_create and updates existing records.
"""
from django.core.management.base import BaseCommand

from Platform_Core.models import ModuleDefinition, SubscriptionPlan

MODULES = [
    {
        "slug": "platform-core",
        "name": "Platform Core",
        "category": "core",
        "is_core": True,
        "description": "Tenant management, user auth, roles, and workspace configuration.",
    },
    {
        "slug": "weighbridge",
        "name": "Commercial Weighbridge",
        "category": "vertical",
        "is_core": True,
        "description": "Weight ticket capture, transaction management, and live scale integration.",
    },
    {
        "slug": "invoicing",
        "name": "Invoicing & Payments",
        "category": "shared",
        "is_core": True,
        "description": "Invoice generation, payment capture, and receipt management.",
    },
    {
        "slug": "accounting",
        "name": "Accounting",
        "category": "shared",
        "description": "Ledger entries, accounting rules, and financial reporting.",
    },
    {
        "slug": "crm",
        "name": "CRM",
        "category": "vertical",
        "description": "Customer, supplier, contact, and opportunity management.",
    },
    {
        "slug": "hr-payroll",
        "name": "HR & Payroll",
        "category": "shared",
        "description": "Staff management, leave tracking, and payroll processing.",
    },
    {
        "slug": "procurement",
        "name": "Procurement",
        "category": "shared",
        "description": "Purchase orders, supplier management, and goods receipt.",
    },
    {
        "slug": "reporting",
        "name": "Reporting & Analytics",
        "category": "shared",
        "description": "Dashboards, scheduled reports, and data exports.",
    },
    {
        "slug": "integrations",
        "name": "External Integrations",
        "category": "integration",
        "description": "M-Pesa, bank feeds, SMS gateways, and third-party APIs.",
    },
]

PLANS = [
    {
        "code": "starter",
        "name": "Starter",
        "billing_period": "monthly",
        "price": "4999.00",
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
        "code": "professional",
        "name": "Professional",
        "billing_period": "monthly",
        "price": "14999.00",
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
        "code": "enterprise",
        "name": "Enterprise",
        "billing_period": "annual",
        "price": "149999.00",
        "currency": "KES",
        "trial_days": 30,
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
]


class Command(BaseCommand):
    help = "Seed platform module definitions and subscription plans"

    def handle(self, *args, **options):
        new_mods = 0
        for data in MODULES:
            obj, created = ModuleDefinition.objects.get_or_create(
                slug=data["slug"], defaults=data
            )
            if not created:
                for k, v in data.items():
                    setattr(obj, k, v)
                obj.save()
            if created:
                new_mods += 1

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

        self.stdout.write(
            self.style.SUCCESS(
                f"Modules: {new_mods} created, {len(MODULES) - new_mods} updated. "
                f"Plans: {new_plans} created, {len(PLANS) - new_plans} updated."
            )
        )
