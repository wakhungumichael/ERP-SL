from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0020_audit_logs_menu"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="footer_menu",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="landing_page_config",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="login_page_config",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
