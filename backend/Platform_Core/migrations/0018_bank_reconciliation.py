from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0017_workflow_engine_nodes"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BankReconciliationSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=150)),
                ("code", models.CharField(blank=True, max_length=50)),
                ("statement_date_from", models.DateField()),
                ("statement_date_to", models.DateField()),
                ("statement_opening_balance", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("statement_closing_balance", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("notes", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("in_progress", "In Progress"), ("completed", "Completed")], default="draft", max_length=20)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("account", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="bank_reconciliation_sessions", to="Platform_Core.account")),
                ("financial_year", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="bank_reconciliation_sessions", to="Platform_Core.financialyear")),
                ("period", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="bank_reconciliation_sessions", to="Platform_Core.accountingperiod")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="bank_reconciliation_sessions", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["tenant__name", "-statement_date_to", "-id"],
                "unique_together": {("tenant", "code")},
            },
        ),
        migrations.CreateModel(
            name="BankStatementLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("line_date", models.DateField()),
                ("reference", models.CharField(blank=True, max_length=120)),
                ("description", models.CharField(blank=True, max_length=255)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                ("status", models.CharField(choices=[("open", "Open"), ("matched", "Matched"), ("ignored", "Ignored")], default="open", max_length=20)),
                ("matched_at", models.DateTimeField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("matched_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="bank_statement_line_matches", to=settings.AUTH_USER_MODEL)),
                ("matched_journal_line", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="reconciliation_statement_line", to="Platform_Core.journalentryline")),
                ("session", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lines", to="Platform_Core.bankreconciliationsession")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="bank_statement_lines", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["line_date", "id"],
            },
        ),
    ]
