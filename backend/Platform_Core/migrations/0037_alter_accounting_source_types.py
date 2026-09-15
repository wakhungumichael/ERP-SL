from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0036_tenant_settings_insecure_ssl"),
    ]

    operations = [
        migrations.AlterField(
            model_name="accountingpostingrule",
            name="source_type",
            field=models.CharField(
                choices=[
                    ("invoice", "Invoice"),
                    ("payment", "Payment"),
                    ("bill", "Bill"),
                    ("transaction", "Transaction"),
                    ("manual", "Manual"),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="journalentry",
            name="source_type",
            field=models.CharField(
                choices=[
                    ("invoice", "Invoice"),
                    ("payment", "Payment"),
                    ("bill", "Bill"),
                    ("transaction", "Transaction"),
                    ("manual", "Manual"),
                ],
                default="manual",
                max_length=20,
            ),
        ),
    ]
