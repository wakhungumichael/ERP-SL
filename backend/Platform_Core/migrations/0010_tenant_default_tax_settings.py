from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0009_industries_pricing_rules"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="default_tax_name",
            field=models.CharField(blank=True, default="VAT", max_length=100),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="default_tax_rate",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=5),
        ),
    ]
