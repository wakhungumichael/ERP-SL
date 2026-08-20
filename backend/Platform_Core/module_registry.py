from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from django.apps import apps
from django.db import ProgrammingError
from django.db.utils import OperationalError
from django.utils.text import slugify

from Platform_Core.models import Industry, ModuleDefinition


DISCOVERABLE_APP_LABELS = {"Platform_Core"}
DISCOVERABLE_APP_PREFIXES = ("SL_",)
PLATFORM_API_MODULES_DIR = Path(__file__).resolve().parent.parent / "Platform_API" / "modules"
PLATFORM_API_MODULE_EXCLUDES = {"__pycache__", "platform"}

MODULE_METADATA_BY_APP = {
    "Platform_Core": {
        "slug": "platform-core",
        "name": "Platform Core",
        "category": "core",
        "scope": "hybrid",
        "is_core": True,
        "description": "Tenant management, user auth, roles, and workspace configuration.",
    },
    "SL_Weighbridge": {
        "slug": "weighbridge",
        "name": "Commercial Weighbridge",
        "category": "vertical",
        "scope": "organization",
        "is_core": True,
        "description": "Weight ticket capture, transaction management, and live scale integration.",
    },
    "SL_Budgeting": {
        "slug": "budgeting",
        "name": "Budgeting & Commitments",
        "category": "shared",
        "scope": "organization",
        "description": "Budget setup, commitment accounting, and financial control checks.",
    },
    "SL_CRM": {
        "slug": "crm",
        "name": "CRM",
        "category": "vertical",
        "scope": "organization",
        "description": "Customer, supplier, contact, and opportunity management.",
    },
    "SL_HR": {
        "slug": "hr-payroll",
        "name": "HR & Payroll",
        "category": "shared",
        "scope": "organization",
        "description": "Staff management, leave tracking, and payroll processing.",
    },
    "SL_Procurement": {
        "slug": "procurement",
        "name": "Procurement",
        "category": "shared",
        "scope": "organization",
        "description": "Purchase orders, supplier management, and goods receipt.",
    },
    "SL_Sales": {
        "slug": "sales",
        "name": "Sales",
        "category": "shared",
        "scope": "organization",
        "description": "Sales orders, products, recurring billing, and customer commerce flows.",
    },
    "SL_Inventory": {
        "slug": "inventory",
        "name": "Inventory",
        "category": "shared",
        "scope": "organization",
        "description": "Stock items, inventory movements, warehouse balances, and product availability.",
    },
    "SL_Ticketing": {
        "slug": "ticketing",
        "name": "Ticketing",
        "category": "shared",
        "scope": "organization",
        "description": "Service tickets, issue resolution, and support workflow coordination.",
    },
}

MANUAL_MODULES = [
    {
        "slug": "invoicing",
        "name": "Invoicing & Payments",
        "category": "shared",
        "scope": "organization",
        "is_core": True,
        "description": "Invoice generation, payment capture, and receipt management.",
    },
    {
        "slug": "accounting",
        "name": "Accounting",
        "category": "shared",
        "scope": "organization",
        "description": "Ledger entries, accounting rules, and financial reporting.",
    },
    {
        "slug": "reporting",
        "name": "Reporting & Analytics",
        "category": "shared",
        "scope": "organization",
        "description": "Dashboards, scheduled reports, and data exports.",
    },
    {
        "slug": "integrations",
        "name": "External Integrations",
        "category": "integration",
        "scope": "hybrid",
        "description": "M-Pesa, bank feeds, SMS gateways, and third-party APIs.",
    },
]

MODULE_METADATA_BY_API_DIR = {
    "hr": {
        "slug": "hr-payroll",
        "name": "HR & Payroll",
        "category": "shared",
        "scope": "organization",
        "description": "Staff management, leave tracking, and payroll processing.",
    },
    "payments": {
        "slug": "payments",
        "name": "Payments",
        "category": "shared",
        "scope": "organization",
        "description": "Tenant collection operations for invoices, receipts, and settlement tracking. SaaS subscription billing stays under platform billing controls.",
    },
    "ticketing": {
        "slug": "ticketing",
        "name": "Ticketing",
        "category": "shared",
        "scope": "organization",
        "description": "Service tickets, issue resolution, and support workflow coordination.",
    },
    "purchases": {
        "slug": "purchases",
        "name": "Purchases",
        "category": "shared",
        "scope": "organization",
        "description": "Supplier bills, purchasing cycles, and payables execution workflows.",
    },
}

DEFAULT_INDUSTRY_SLUGS = [
    "logistics-transport",
    "manufacturing",
    "construction",
    "agriculture",
    "energy-mining",
    "general-trade",
]

MODULE_INDUSTRY_OVERRIDES = {
    "weighbridge": [
        "logistics-transport",
        "manufacturing",
        "construction",
        "agriculture",
        "energy-mining",
    ],
}


def _is_discoverable_app(app_config):
    if app_config.name in DISCOVERABLE_APP_LABELS:
        return True
    return any(app_config.name.startswith(prefix) for prefix in DISCOVERABLE_APP_PREFIXES)


def _build_module_metadata_from_app(app_config):
    explicit = getattr(app_config, "sl_module_definition", None)
    if explicit:
        data = deepcopy(explicit)
        data.setdefault("is_active", True)
        data.setdefault("scope", "organization")
        return data

    override = MODULE_METADATA_BY_APP.get(app_config.name)
    if override:
        data = deepcopy(override)
        data.setdefault("is_active", True)
        data.setdefault("scope", "organization")
        return data

    label = app_config.name.split(".")[-1]
    slug_source = label
    if slug_source.startswith("SL_"):
        slug_source = slug_source[3:]
    slug = slugify(slug_source.replace("_", "-"))
    verbose_name = getattr(app_config, "verbose_name", "") or label.replace("_", " ")
    clean_name = str(verbose_name).replace("SL ", "").strip()
    return {
        "slug": slug,
        "name": clean_name.title(),
        "category": "shared",
        "scope": "organization",
        "description": f"{clean_name.title()} module auto-discovered from installed apps.",
        "is_core": False,
        "is_active": True,
    }


def _discover_platform_api_modules():
    modules = {}
    if not PLATFORM_API_MODULES_DIR.exists():
        return modules

    for child in PLATFORM_API_MODULES_DIR.iterdir():
        if not child.is_dir() or child.name in PLATFORM_API_MODULE_EXCLUDES:
            continue

        explicit = MODULE_METADATA_BY_API_DIR.get(child.name)
        if explicit:
            modules[explicit["slug"]] = {
                **deepcopy(explicit),
                "is_active": True,
                "scope": explicit.get("scope", "organization"),
            }
            continue

        clean_name = child.name.replace("-", " ").replace("_", " ").title()
        slug = slugify(child.name.replace("_", "-"))
        modules[slug] = {
            "slug": slug,
            "name": clean_name,
            "category": "shared",
            "scope": "organization",
            "description": f"{clean_name} module auto-discovered from Platform API modules.",
            "is_core": False,
            "is_active": True,
        }

    return modules


def get_discovered_module_definitions():
    modules = {}
    for app_config in apps.get_app_configs():
        if not _is_discoverable_app(app_config):
            continue
        module_data = _build_module_metadata_from_app(app_config)
        modules[module_data["slug"]] = module_data

    for slug, module_data in _discover_platform_api_modules().items():
        modules.setdefault(slug, module_data)

    for module_data in MANUAL_MODULES:
        modules[module_data["slug"]] = deepcopy(module_data)

    return [modules[slug] for slug in sorted(modules)]


def get_default_industry_slugs_by_module():
    mapping = {}
    for module in get_discovered_module_definitions():
        mapping[module["slug"]] = MODULE_INDUSTRY_OVERRIDES.get(
            module["slug"],
            DEFAULT_INDUSTRY_SLUGS,
        )
    return mapping


def sync_module_definitions():
    try:
        module_definitions = get_discovered_module_definitions()
        default_industries = get_default_industry_slugs_by_module()
        new_count = 0
        updated_count = 0

        for data in module_definitions:
            obj, created = ModuleDefinition.objects.get_or_create(
                slug=data["slug"],
                defaults=data,
            )
            if created:
                new_count += 1
            else:
                changed_fields = []
                for field, value in data.items():
                    if getattr(obj, field) != value:
                        setattr(obj, field, value)
                        changed_fields.append(field)
                if changed_fields:
                    obj.save(update_fields=changed_fields + ["updated_at"])
                    updated_count += 1

        industry_map = {
            industry.slug: industry
            for industry in Industry.objects.filter(is_active=True)
        }
        for module in ModuleDefinition.objects.all():
            desired_slugs = default_industries.get(module.slug)
            if not desired_slugs:
                continue
            module.industries.set(
                [industry_map[slug] for slug in desired_slugs if slug in industry_map]
            )

        return {
            "created": new_count,
            "updated": updated_count,
            "definitions": module_definitions,
        }
    except (OperationalError, ProgrammingError):
        return {
            "created": 0,
            "updated": 0,
            "definitions": [],
        }
