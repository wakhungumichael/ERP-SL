from django.conf import settings
from django.db import models
from django.utils import timezone
from Platform_Core.models import AuditMetadataMixin


class Budget(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("active", "Active"),
        ("closed", "Closed"),
        ("archived", "Archived"),
    ]
    CONTROL_MODE_CHOICES = [
        ("hard", "Hard Control"),
        ("soft", "Soft Control"),
    ]
    PERIOD_TYPE_CHOICES = [
        ("annual", "Annual"),
        ("quarterly", "Quarterly"),
        ("monthly", "Monthly"),
        ("custom", "Custom"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="budgets")
    branch = models.ForeignKey(
        "Platform_Core.TenantBranch",
        on_delete=models.SET_NULL,
        related_name="budgets",
        blank=True,
        null=True,
    )
    financial_year = models.ForeignKey(
        "Platform_Core.FinancialYear",
        on_delete=models.SET_NULL,
        related_name="budgets",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=180)
    code = models.CharField(max_length=40)
    period_type = models.CharField(max_length=20, choices=PERIOD_TYPE_CHOICES, default="annual")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    control_mode = models.CharField(max_length=20, choices=CONTROL_MODE_CHOICES, default="hard")
    start_date = models.DateField()
    end_date = models.DateField()
    currency = models.CharField(max_length=10, default="KES")
    description = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="created_budgets",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["tenant__name", "-start_date", "name"]
        unique_together = ("tenant", "code")

    def __str__(self):
        return f"{self.tenant.name} - {self.code}"


class BudgetLine(AuditMetadataMixin, models.Model):
    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="lines")
    account = models.ForeignKey(
        "Platform_Core.Account",
        on_delete=models.PROTECT,
        related_name="budget_lines",
    )
    cost_center = models.CharField(max_length=120)
    project_code = models.CharField(max_length=80, blank=True)
    period_year = models.PositiveIntegerField(default=timezone.now().year)
    period_month = models.PositiveSmallIntegerField(blank=True, null=True)
    allocated_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    committed_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    obligated_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    actual_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["budget__name", "cost_center", "account__code", "period_year", "period_month"]
        unique_together = (
            "budget",
            "account",
            "cost_center",
            "project_code",
            "period_year",
            "period_month",
        )

    @property
    def available_amount(self):
        return self.allocated_amount - (
            self.committed_amount + self.obligated_amount + self.actual_amount
        )

    def __str__(self):
        return f"{self.budget.code} - {self.account.code} - {self.cost_center}"


class BudgetCommitment(AuditMetadataMixin, models.Model):
    SOURCE_TYPE_CHOICES = [
        ("requisition", "Requisition"),
        ("purchase_order", "Purchase Order"),
        ("bill", "Bill"),
        ("manual", "Manual"),
    ]
    STATE_CHOICES = [
        ("committed", "Committed"),
        ("obligated", "Obligated"),
        ("actual", "Actual"),
        ("released", "Released"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="budget_commitments")
    budget_line = models.ForeignKey(BudgetLine, on_delete=models.CASCADE, related_name="commitments")
    source_type = models.CharField(max_length=30, choices=SOURCE_TYPE_CHOICES, default="requisition")
    source_reference = models.CharField(max_length=80)
    state = models.CharField(max_length=20, choices=STATE_CHOICES, default="committed")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="budget_commitments_created",
        blank=True,
        null=True,
    )
    released_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.source_type}:{self.source_reference} - {self.amount}"


class BudgetCheckLog(AuditMetadataMixin, models.Model):
    RESULT_CHOICES = [
        ("pass", "Pass"),
        ("warn", "Warn"),
        ("block", "Block"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="budget_check_logs")
    budget_line = models.ForeignKey(
        BudgetLine,
        on_delete=models.SET_NULL,
        related_name="check_logs",
        blank=True,
        null=True,
    )
    requisition_reference = models.CharField(max_length=80, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    result = models.CharField(max_length=20, choices=RESULT_CHOICES)
    message = models.CharField(max_length=255, blank=True)
    checked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="budget_checks_run",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tenant.name} - {self.result}"
