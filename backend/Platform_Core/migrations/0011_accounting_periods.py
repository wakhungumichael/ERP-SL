from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0010_tenant_default_tax_settings"),
    ]

    operations = [
        migrations.CreateModel(
            name="FinancialYear",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120)),
                ("code", models.CharField(max_length=40)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                ("status", models.CharField(choices=[("draft", "Draft"), ("open", "Open"), ("closed", "Closed")], default="draft", max_length=20)),
                ("is_active", models.BooleanField(default=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="financial_years", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["tenant__name", "-start_date", "-id"],
                "unique_together": {("tenant", "code")},
            },
        ),
        migrations.CreateModel(
            name="AccountingPeriod",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120)),
                ("code", models.CharField(max_length=40)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                ("period_type", models.CharField(choices=[("month", "Month"), ("quarter", "Quarter"), ("year", "Year"), ("adjustment", "Adjustment"), ("custom", "Custom")], default="month", max_length=20)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("open", "Open"), ("closed", "Closed"), ("locked", "Locked")], default="draft", max_length=20)),
                ("sequence_number", models.PositiveIntegerField(default=1)),
                ("is_adjustment", models.BooleanField(default=False)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("financial_year", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="periods", to="Platform_Core.financialyear")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="accounting_periods", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["tenant__name", "financial_year__start_date", "sequence_number", "start_date", "id"],
                "unique_together": {("tenant", "code")},
            },
        ),
    ]
