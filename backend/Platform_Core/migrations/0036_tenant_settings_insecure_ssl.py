from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0035_tenant_settings_smtp_ssl")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="smtp_allow_insecure_ssl",
            field=models.BooleanField(default=False),
        ),
    ]
