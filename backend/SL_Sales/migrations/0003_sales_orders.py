from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Sales", "0002_remove_estimate_estimate_unique_number_per_tenant_and_more"),
        ("SL_Weighbridge", "0052_overweightconfig_notify_email_notify_on_overweight"),
        ("Platform_Core", "0006_tenant_user_profile_branch_settings"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SalesOrder",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("customer_name", models.CharField(blank=True, max_length=200)),
                ("order_number", models.CharField(blank=True, max_length=50)),
                ("order_date", models.DateField(default=django.utils.timezone.now)),
                ("expected_delivery_date", models.DateField(blank=True, null=True)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("confirmed", "Confirmed"), ("fulfilled", "Fulfilled"), ("cancelled", "Cancelled"), ("invoiced", "Invoiced")], default="draft", max_length=20)),
                ("subtotal", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("discount_total", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("tax_total", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("total", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("notes", models.TextField(blank=True)),
                ("terms", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("branch", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_orders", to="SL_Weighbridge.branch")),
                ("converted_to_invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="source_sales_order", to="SL_Weighbridge.invoice")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_sales_orders", to=settings.AUTH_USER_MODEL)),
                ("customer", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_orders", to="SL_Weighbridge.customer")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sales_orders", to="Platform_Core.tenant")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddField(
            model_name="estimate",
            name="converted_to_sales_order",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="source_estimate", to="SL_Sales.salesorder"),
        ),
        migrations.AddField(
            model_name="salesorder",
            name="estimate",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_orders", to="SL_Sales.estimate"),
        ),
        migrations.AlterUniqueTogether(
            name="salesorder",
            unique_together={("tenant", "order_number")},
        ),
        migrations.CreateModel(
            name="SalesOrderLineItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("description", models.CharField(blank=True, max_length=300)),
                ("quantity", models.DecimalField(decimal_places=3, default=1, max_digits=10)),
                ("unit_price", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("tax_rate", models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ("discount_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("line_total", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("product", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_order_lines", to="SL_Sales.product")),
                ("sales_order", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="line_items", to="SL_Sales.salesorder")),
            ],
            options={"ordering": ["sort_order", "id"]},
        ),
    ]
