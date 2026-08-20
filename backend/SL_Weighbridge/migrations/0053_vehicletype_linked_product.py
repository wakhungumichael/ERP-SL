from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Sales", "0003_sales_orders"),
        ("SL_Weighbridge", "0052_overweightconfig_notify_email_notify_on_overweight"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehicletype",
            name="linked_product",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="weighbridge_vehicle_types",
                to="SL_Sales.product",
            ),
        ),
    ]
