from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0011_accounting_periods"),
    ]

    operations = [
        migrations.CreateModel(
            name="AccountingPeriodAuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("action", models.CharField(choices=[("created", "Created"), ("opened", "Opened"), ("closed", "Closed"), ("locked", "Locked"), ("reopened", "Reopened"), ("financial-year-updated", "Financial Year Updated")], max_length=40)),
                ("note", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("financial_year", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_logs", to="Platform_Core.financialyear")),
                ("performed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="accounting_period_actions", to="auth.user")),
                ("period", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_logs", to="Platform_Core.accountingperiod")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="accounting_period_audit_logs", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]
