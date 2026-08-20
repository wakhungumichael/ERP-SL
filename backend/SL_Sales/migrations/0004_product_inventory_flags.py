from django.db import migrations, models


def seed_existing_product_flags(apps, schema_editor):
    Product = apps.get_model("SL_Sales", "Product")
    Product.objects.filter(product_type="product").update(
        is_sales_item=True,
        is_purchase_item=True,
        is_stock_item=True,
        is_service=False,
    )
    Product.objects.filter(product_type="service").update(
        is_sales_item=True,
        is_purchase_item=True,
        is_stock_item=False,
        is_service=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Sales", "0003_sales_orders"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="is_purchase_item",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="product",
            name="is_sales_item",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="product",
            name="is_service",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="product",
            name="is_stock_item",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(seed_existing_product_flags, migrations.RunPython.noop),
    ]
