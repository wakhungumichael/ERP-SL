from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0077_report_template")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="print_qr_codes_enabled",
            field=models.BooleanField(default=True),
        ),
    ]
