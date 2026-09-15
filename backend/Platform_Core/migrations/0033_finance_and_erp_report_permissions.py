from django.db import migrations


def apply_menu_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(section__key="finance").update(
        required_permission="Platform_Core.can_access_finance_workspace"
    )


def remove_menu_permissions(apps, schema_editor):
    WorkspaceMenuItem = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    WorkspaceMenuItem.objects.filter(
        section__key="finance",
        required_permission="Platform_Core.can_access_finance_workspace",
    ).update(required_permission="")


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0032_weighbridge_process_menu_permissions"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="tenantsettings",
            options={
                "ordering": ["tenant__name"],
                "permissions": [
                    ("can_access_finance_workspace", "Can access the Finance workspace"),
                    ("can_view_erp_reports", "Can view ERP reports"),
                ],
            },
        ),
        migrations.RunPython(apply_menu_permissions, remove_menu_permissions),
    ]
