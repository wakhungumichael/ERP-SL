"""
SL_Sales — common product/service catalog, estimates, and recurring invoices.

These models are shared across all modules (Weighbridge, Purchases, etc.)
so that Products & Services live in one place rather than scattered per-module.
"""
from django.conf import settings
from django.db import models
from django.utils import timezone


# ── Product / Service catalogue ───────────────────────────────────────────────

class Product(models.Model):
    PRODUCT_TYPE_CHOICES = [
        ("product", "Product"),
        ("service", "Service"),
    ]

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="products",
    )
    code        = models.CharField(max_length=50, blank=True)
    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    product_type= models.CharField(max_length=20, choices=PRODUCT_TYPE_CHOICES, default="service")
    unit        = models.CharField(max_length=50, blank=True, help_text="e.g. kg, ton, unit, hour")
    unit_price  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_rate    = models.DecimalField(max_digits=5, decimal_places=2, default=0,
                                      help_text="Percentage, e.g. 16 for 16%")
    is_active   = models.BooleanField(default=True)

    # Optional chart-of-accounts linkage
    income_account  = models.ForeignKey(
        "Platform_Core.Account", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="income_products",
    )
    expense_account = models.ForeignKey(
        "Platform_Core.Account", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="expense_products",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["tenant_id", "name"]
        unique_together = ("tenant", "code")

    def __str__(self):
        return f"{self.code} — {self.name}" if self.code else self.name


# ── Estimates / Quotes ────────────────────────────────────────────────────────

class Estimate(models.Model):
    STATUS_CHOICES = [
        ("draft",    "Draft"),
        ("sent",     "Sent"),
        ("accepted", "Accepted"),
        ("declined", "Declined"),
        ("expired",  "Expired"),
    ]

    tenant   = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE,
                                  related_name="estimates")
    branch   = models.ForeignKey("SL_Weighbridge.Branch", on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name="estimates")
    customer = models.ForeignKey("SL_Weighbridge.Customer", on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name="estimates")
    # Fallback name if no FK customer
    customer_name = models.CharField(max_length=200, blank=True)

    estimate_number = models.CharField(max_length=50, blank=True)
    issue_date  = models.DateField(default=timezone.now)
    expiry_date = models.DateField(null=True, blank=True)
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")

    subtotal        = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_total       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total           = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    notes  = models.TextField(blank=True)
    terms  = models.TextField(blank=True)

    # Once converted to an invoice
    converted_to_invoice = models.ForeignKey(
        "SL_Weighbridge.Invoice", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="source_estimate",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="created_estimates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("tenant", "estimate_number")

    def save(self, *args, **kwargs):
        if not self.estimate_number:
            ts = timezone.now().strftime("%Y%m%d%H%M%S")
            self.estimate_number = f"EST-{ts}-{self.tenant_id or 'X'}"
        super().save(*args, **kwargs)

    def recalculate(self):
        lines = self.line_items.all()
        self.subtotal = sum(li.line_total for li in lines)
        self.tax_total = sum(
            li.line_total * (li.tax_rate / 100) for li in lines
        )
        self.total = self.subtotal + self.tax_total - self.discount_total
        self.save(update_fields=["subtotal", "tax_total", "total", "updated_at"])

    def __str__(self):
        return self.estimate_number or f"Estimate #{self.pk}"


class EstimateLineItem(models.Model):
    estimate    = models.ForeignKey(Estimate, on_delete=models.CASCADE,
                                     related_name="line_items")
    product     = models.ForeignKey(Product, on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name="estimate_lines")
    description = models.CharField(max_length=300, blank=True)
    quantity    = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    unit_price  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_rate    = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sort_order  = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def save(self, *args, **kwargs):
        self.line_total = (self.quantity * self.unit_price) - self.discount_amount
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.estimate} — {self.description}"


# ── Recurring Invoices ────────────────────────────────────────────────────────

class RecurringInvoice(models.Model):
    FREQUENCY_CHOICES = [
        ("weekly",    "Weekly"),
        ("monthly",   "Monthly"),
        ("quarterly", "Quarterly"),
        ("yearly",    "Yearly"),
    ]
    STATUS_CHOICES = [
        ("active", "Active"),
        ("paused", "Paused"),
        ("ended",  "Ended"),
    ]

    tenant   = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE,
                                  related_name="recurring_invoices")
    branch   = models.ForeignKey("SL_Weighbridge.Branch", on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name="recurring_invoices")
    customer = models.ForeignKey("SL_Weighbridge.Customer", on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name="recurring_invoices")
    customer_name = models.CharField(max_length=200, blank=True)

    frequency        = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default="monthly")
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    start_date       = models.DateField(default=timezone.now)
    end_date         = models.DateField(null=True, blank=True)
    next_invoice_date= models.DateField(default=timezone.now)
    last_generated_at= models.DateTimeField(null=True, blank=True)

    subtotal  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    notes     = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="created_recurring_invoices",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        cname = self.customer_name or (self.customer.name if self.customer else "—")
        return f"Recurring {self.frequency} — {cname}"


class RecurringInvoiceLineItem(models.Model):
    recurring_invoice = models.ForeignKey(RecurringInvoice, on_delete=models.CASCADE,
                                           related_name="line_items")
    product     = models.ForeignKey(Product, on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name="recurring_lines")
    description = models.CharField(max_length=300, blank=True)
    quantity    = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    unit_price  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_rate    = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    line_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sort_order  = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def save(self, *args, **kwargs):
        self.line_total = self.quantity * self.unit_price
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.recurring_invoice} — {self.description}"
