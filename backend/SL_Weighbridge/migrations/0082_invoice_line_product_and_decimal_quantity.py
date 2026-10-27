import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("SL_Sales", "0003_sales_orders"),
        ("SL_Weighbridge", "0081_weighingoperationtype_requires_payment"),
    ]
    operations = [
        migrations.AddField(
            model_name="invoiceline",
            name="product",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="invoice_lines", to="SL_Sales.product"),
        ),
        migrations.AlterField(
            model_name="invoiceline",
            name="quantity",
            field=models.DecimalField(decimal_places=3, default=1, max_digits=10),
        ),
    ]
