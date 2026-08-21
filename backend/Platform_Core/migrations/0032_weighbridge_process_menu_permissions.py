from django.db import migrations


WEIGHBRIDGE_PROCESS_PERMISSIONS = {
    "weight-capture": "SL_Weighbridge.can_access_weighment_entry",
    "live-weight": "SL_Weighbridge.can_view_live_weight",
    "reports": "SL_Weighbridge.can_manage_weighbridge_reports",
    "settings": "SL_Weighbridge.can_manage_weighbridge_settings",
    "overweight-log": "SL_Weighbridge.can_manage_vehicle_presence",
    "discrepancies": "SL_Weighbridge.can_review_weighbridge_discrepancies",
}


def apply_process_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    for key, permission in WEIGHBRIDGE_PROCESS_PERMISSIONS.items():
        WorkspaceMenuItem.objects.filter(section__key="weighbridge", key=key).update(
            required_permission=permission
        )


def remove_process_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(
        section__key="weighbridge",
        key__in=WEIGHBRIDGE_PROCESS_PERMISSIONS,
    ).update(required_permission="")


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0031_module_definition_scope"),
    ]

    operations = [
        migrations.RunPython(apply_process_permissions, remove_process_permissions),
    ]
