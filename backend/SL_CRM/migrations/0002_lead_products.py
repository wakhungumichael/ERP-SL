from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Sales", "0004_product_inventory_flags"),
        ("SL_CRM", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="lead",
            name="products",
            field=models.ManyToManyField(blank=True, related_name="crm_leads", to="SL_Sales.product"),
        ),
    ]
