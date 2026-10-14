from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("SL_Sales", "0005_sales_customer_permissions")]

    operations = [
        migrations.CreateModel(
            name="OrganisationCharge",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("code", models.CharField(blank=True, max_length=40)),
                ("calculation_type", models.CharField(choices=[("percentage", "Percentage"), ("fixed", "Fixed amount")], default="percentage", max_length=12)),
                ("rate", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("applies_to", models.CharField(choices=[("estimate", "Estimates"), ("invoice", "Invoices"), ("both", "Estimates and invoices")], default="both", max_length=12)),
                ("is_active", models.BooleanField(default=True)),
                ("is_default", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sales_charges", to="Platform_Core.tenant")),
            ],
            options={"ordering": ["name"], "unique_together": {("tenant", "name")}},
        ),
        migrations.AddField(model_name="estimate", name="charge_total", field=models.DecimalField(decimal_places=2, default=0, max_digits=14)),
        migrations.CreateModel(
            name="EstimateCharge",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("calculation_type", models.CharField(choices=[("percentage", "Percentage"), ("fixed", "Fixed amount")], max_length=12)),
                ("rate", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("charge_rule", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="estimate_snapshots", to="SL_Sales.organisationcharge")),
                ("estimate", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="charges", to="SL_Sales.estimate")),
            ],
            options={"ordering": ["id"]},
        ),
    ]
