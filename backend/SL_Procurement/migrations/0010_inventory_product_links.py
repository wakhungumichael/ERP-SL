from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Sales", "0004_product_inventory_flags"),
        ("SL_Procurement", "0009_requisitionapproval_workflow_node"),
    ]

    operations = [
        migrations.AddField(
            model_name="requisitionline",
            name="product",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="requisition_lines", to="SL_Sales.product"),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="product",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="purchase_order_items", to="SL_Sales.product"),
        ),
        migrations.AddField(
            model_name="goodsreceiptline",
            name="product",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="goods_receipt_lines", to="SL_Sales.product"),
        ),
    ]
