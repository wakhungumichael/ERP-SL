from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0037_alter_accounting_source_types")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="teller_receipt_latest_records",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="teller_receipt_max_age_hours",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
