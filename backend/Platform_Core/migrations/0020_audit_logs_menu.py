from django.db import migrations


def seed_audit_logs_menu(apps, schema_editor):
    WorkspaceMenuSection = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")

    section = WorkspaceMenuSection.objects.filter(key="platform-admin").first()
    if not section:
        return

    WorkspaceMenuItem.objects.update_or_create(
        section=section,
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


def unseed_audit_logs_menu(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(key="audit-logs").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0019_merge_20260727_1730"),
    ]

    operations = [
        migrations.RunPython(seed_audit_logs_menu, unseed_audit_logs_menu),
    ]
