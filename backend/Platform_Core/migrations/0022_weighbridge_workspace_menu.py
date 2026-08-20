from django.db import migrations


WEIGHBRIDGE_ITEMS = [
    {
        "key": "overview",
        "title": "Overview",
        "icon": "dashboard",
        "description": "Track pending weights, charges, and completed transactions.",
        "route_path": "/weighbridge/overview",
        "api_path": "/api/commercial-weighbridge/dashboard/",
        "sort_order": 10,
    },
    {
        "key": "transactions",
        "title": "Transactions",
        "icon": "swap_horiz",
        "description": "Browse and action weighbridge transaction records.",
        "route_path": "/weighbridge/transactions",
        "api_path": "/api/commercial-weighbridge/transactions/",
        "sort_order": 20,
    },
    {
        "key": "live-weight",
        "title": "Live Weight",
        "icon": "speed",
        "description": "Resolve current indicator readings and workflow context.",
        "route_path": "/weighbridge/live",
        "api_path": "/api/commercial-weighbridge/live-weight/",
        "sort_order": 30,
    },
    {
        "key": "reports",
        "title": "Reports",
        "icon": "assessment",
        "description": "Commercial reporting and discrepancy visibility.",
        "route_path": "/weighbridge/reports",
        "api_path": "/api/commercial-weighbridge/transactions/",
        "sort_order": 40,
    },
    {
        "key": "settings",
        "title": "Settings",
        "icon": "settings",
        "description": "Indicator, surveillance, pricing, and weighbridge setup.",
        "route_path": "/weighbridge/settings",
        "api_path": "/api/commercial-weighbridge/indicator-configs/",
        "sort_order": 50,
    },
    {
        "key": "overweight-log",
        "title": "Overweight Log",
        "icon": "warning",
        "description": "Review weight-threshold events captured by weighbridge surveillance.",
        "route_path": "/weighbridge/overweight-log",
        "api_path": "/api/commercial-weighbridge/overweight-events/",
        "sort_order": 60,
    },
    {
        "key": "discrepancies",
        "title": "Discrepancies",
        "icon": "report_problem",
        "description": "Investigate vehicle presence events that were not recorded as weighbridge transactions.",
        "route_path": "/weighbridge/discrepancies",
        "api_path": "/api/commercial-weighbridge/surveillance-discrepancies/",
        "sort_order": 70,
    },
]


def align_weighbridge_workspace_menu(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")

    weighbridge_module = (
        ModuleDefinition.objects.filter(slug="weighbridge").first()
        or ModuleDefinition.objects.filter(slug="commercial-weighbridge").first()
    )

    legacy_section = WorkspaceMenuSection.objects.filter(key="operations").first()
    section = WorkspaceMenuSection.objects.filter(key="weighbridge").first()

    if section is None and legacy_section is not None:
        section = legacy_section
        section.key = "weighbridge"
    elif section is None:
        section = WorkspaceMenuSection(key="weighbridge")

    section.title = "Weighbridge"
    section.icon = "scale"
    section.description = "Commercial weighbridge operations, live weights, surveillance, and discrepancy review."
    section.module = weighbridge_module
    section.sort_order = 10
    section.is_active = True
    section.is_system = True
    section.save()

    if legacy_section and legacy_section.pk != section.pk:
        for item in legacy_section.items.all():
            item.section = section
            item.save(update_fields=["section"])
        legacy_section.delete()

    for row in WEIGHBRIDGE_ITEMS:
        WorkspaceMenuItem.objects.update_or_create(
            section=section,
            key=row["key"],
            defaults={
                "title": row["title"],
                "icon": row["icon"],
                "description": row["description"],
                "route_path": row["route_path"],
                "api_path": row["api_path"],
                "required_module": weighbridge_module,
                "sort_order": row["sort_order"],
                "is_active": True,
            },
        )


def rollback_weighbridge_workspace_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    section = WorkspaceMenuSection.objects.filter(key="weighbridge").first()
    if section:
        section.items.filter(key__in=[row["key"] for row in WEIGHBRIDGE_ITEMS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0021_tenant_public_site_settings"),
    ]

    operations = [
        migrations.RunPython(align_weighbridge_workspace_menu, rollback_weighbridge_workspace_menu),
    ]
