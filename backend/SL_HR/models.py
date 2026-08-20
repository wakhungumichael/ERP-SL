from django.conf import settings
from django.db import models
from Platform_Core.models import AuditMetadataMixin


class PayPeriod(AuditMetadataMixin, models.Model):
    """A payroll period (e.g. July 2026)."""
    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="pay_periods",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=100)          # "July 2026"
    period_start = models.DateField()
    period_end = models.DateField()
    STATUS = [
        ("Draft",       "Draft"),
        ("Processing",  "Processing"),
        ("Completed",   "Completed"),
    ]
    status = models.CharField(max_length=20, choices=STATUS, default="Draft")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start"]
        unique_together = [("tenant", "name", "period_start", "period_end")]

    def __str__(self):
        return f"{self.name} ({self.status})"


class PayRecord(AuditMetadataMixin, models.Model):
    """One employee's pay entry for a given period."""
    period     = models.ForeignKey(PayPeriod, on_delete=models.CASCADE, related_name="records")
    employee   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pay_records")
    basic_pay  = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_pay    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("period", "employee")]
        ordering = ["employee__username"]

    def __str__(self):
        return f"{self.employee.get_full_name() or self.employee.username} — {self.period}"
