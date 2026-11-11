from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("SL_Weighbridge", "0085_invoice_billing_details")]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="prices_include_tax",
            field=models.BooleanField(default=False),
        ),
    ]
