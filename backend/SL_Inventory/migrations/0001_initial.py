from django.db import migrations, models
import django.db.models.deletion
class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("Platform_Core", "0027_backup_policy_scoped_artifacts"),
        ("SL_Sales", "0003_sales_orders"),
        ("SL_Procurement", "0009_requisitionapproval_workflow_node"),
        ("SL_Weighbridge", "0065_customer_lifecycle_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="Warehouse",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=40)),
                ("name", models.CharField(max_length=180)),
                ("warehouse_type", models.CharField(choices=[("main", "Main"), ("transit", "Transit"), ("branch", "Branch"), ("returns", "Returns"), ("restricted", "Restricted")], default="main", max_length=20)),
                ("status", models.CharField(choices=[("active", "Active"), ("inactive", "Inactive"), ("blocked", "Blocked")], default="active", max_length=20)),
                ("is_default", models.BooleanField(default=False)),
                ("is_virtual", models.BooleanField(default=False)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("branch", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="warehouses", to="SL_Weighbridge.branch")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="warehouses", to="Platform_Core.tenant")),
            ],
            options={"ordering": ["tenant__name", "name"], "unique_together": {("tenant", "code")}},
        ),
        migrations.CreateModel(
            name="InventoryMovement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("movement_type", models.CharField(choices=[("receipt", "Receipt"), ("reservation", "Reservation"), ("release", "Release"), ("issue", "Issue"), ("adjustment", "Adjustment")], max_length=20)),
                ("reference_type", models.CharField(choices=[("goods_receipt", "Goods Receipt"), ("sales_order", "Sales Order"), ("manual", "Manual")], default="manual", max_length=30)),
                ("reference_id", models.PositiveIntegerField(blank=True, null=True)),
                ("reference_line_id", models.PositiveIntegerField(blank=True, null=True)),
                ("reference_number", models.CharField(blank=True, max_length=80)),
                ("quantity", models.DecimalField(decimal_places=3, default=0, max_digits=14)),
                ("unit_cost", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("total_cost", models.DecimalField(decimal_places=2, default=0, max_digits=16)),
                ("movement_date", models.DateTimeField()),
                ("notes", models.TextField(blank=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="inventory_movements_created", to="auth.user")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inventory_movements", to="SL_Sales.product")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inventory_movements", to="Platform_Core.tenant")),
                ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="movements", to="SL_Inventory.warehouse")),
            ],
            options={"ordering": ["-movement_date", "-id"]},
        ),
        migrations.CreateModel(
            name="InventoryBalance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("on_hand_qty", models.DecimalField(decimal_places=3, default=0, max_digits=14)),
                ("reserved_qty", models.DecimalField(decimal_places=3, default=0, max_digits=14)),
                ("available_qty", models.DecimalField(decimal_places=3, default=0, max_digits=14)),
                ("average_cost", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("valuation_amount", models.DecimalField(decimal_places=2, default=0, max_digits=16)),
                ("last_movement_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inventory_balances", to="SL_Sales.product")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inventory_balances", to="Platform_Core.tenant")),
                ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="balances", to="SL_Inventory.warehouse")),
            ],
            options={"ordering": ["warehouse__name", "product__name"], "unique_together": {("warehouse", "product")}},
        ),
        migrations.CreateModel(
            name="InventoryReservation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=3, default=0, max_digits=14)),
                ("status", models.CharField(choices=[("active", "Active"), ("released", "Released"), ("consumed", "Consumed")], default="active", max_length=20)),
                ("reserved_at", models.DateTimeField()),
                ("released_at", models.DateTimeField(blank=True, null=True)),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="inventory_reservations_created", to="auth.user")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inventory_reservations", to="SL_Sales.product")),
                ("sales_order", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="inventory_reservations", to="SL_Sales.salesorder")),
                ("sales_order_line", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="inventory_reservations", to="SL_Sales.salesorderlineitem")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inventory_reservations", to="Platform_Core.tenant")),
                ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="reservations", to="SL_Inventory.warehouse")),
            ],
            options={"ordering": ["-reserved_at", "-id"]},
        ),
    ]
