from django.db import migrations, models


def convert_port_465_to_ssl(apps, schema_editor):
    TenantSettings = apps.get_model("Platform_Core", "TenantSettings")
    TenantSettings.objects.filter(smtp_port=465, smtp_use_tls=True).update(
        smtp_use_tls=False,
        smtp_use_ssl=True,
    )


def restore_port_465_tls(apps, schema_editor):
    TenantSettings = apps.get_model("Platform_Core", "TenantSettings")
    TenantSettings.objects.filter(smtp_port=465, smtp_use_ssl=True).update(
        smtp_use_tls=True,
    )


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0034_workspace_overview_permissions")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="smtp_use_ssl",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(convert_port_465_to_ssl, restore_port_465_tls),
    ]
