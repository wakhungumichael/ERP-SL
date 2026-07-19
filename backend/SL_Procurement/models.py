from django.conf import settings
from django.db import models
from django.utils import timezone


class PurchaseOrder(models.Model):
    STATUSES = [
        ("Draft",      "Draft"),
        ("Submitted",  "Submitted"),
        ("Approved",   "Approved"),
        ("Received",   "Received"),
        ("Cancelled",  "Cancelled"),
    ]

    reference      = models.CharField(max_length=50, unique=True)
    supplier_name  = models.CharField(max_length=200)
    supplier_email = models.EmailField(blank=True)
    supplier_phone = models.CharField(max_length=50, blank=True)
    status         = models.CharField(max_length=20, choices=STATUSES, default="Draft")
    order_date     = models.DateField()
    expected_date  = models.DateField(null=True, blank=True)
    total_amount   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    currency       = models.CharField(max_length=10, default="KES")
    notes          = models.TextField(blank=True)
    created_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="purchase_orders"
    )
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference} — {self.supplier_name}"

    def recalculate_total(self):
        from django.db.models import Sum
        total = self.items.aggregate(t=Sum("total"))["t"] or 0
        self.total_amount = total
        self.save(update_fields=["total_amount", "updated_at"])


class PurchaseOrderItem(models.Model):
    order       = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=300)
    unit        = models.CharField(max_length=50, default="pcs")
    quantity    = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price  = models.DecimalField(max_digits=12, decimal_places=2)
    total       = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["id"]

    def save(self, *args, **kwargs):
        self.total = self.quantity * self.unit_price
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.description} × {self.quantity}"


# ── Bill (vendor/supplier invoice) ────────────────────────────────────────────

class Bill(models.Model):
    STATUS_CHOICES = [
        ("draft",    "Draft"),
        ("received", "Received"),
        ("approved", "Approved"),
        ("paid",     "Paid"),
        ("overdue",  "Overdue"),
    ]

    tenant   = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE,
                                  related_name="bills")
    branch   = models.ForeignKey("SL_Weighbridge.Branch", on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name="bills")
    supplier = models.ForeignKey("SL_CRM.Supplier", on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name="bills")
    supplier_name = models.CharField(max_length=200, blank=True,
                                      help_text="Fallback if no FK supplier")

    bill_number = models.CharField(max_length=50, blank=True)
    reference   = models.CharField(max_length=100, blank=True,
                                    help_text="Supplier's own reference number")
    issue_date  = models.DateField(default=timezone.now)
    due_date    = models.DateField(null=True, blank=True)
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")

    subtotal  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    notes     = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="created_bills",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.bill_number:
            ts = timezone.now().strftime("%Y%m%d%H%M%S")
            self.bill_number = f"BILL-{ts}-{self.tenant_id or 'X'}"
        super().save(*args, **kwargs)

    def recalculate(self):
        lines = self.line_items.all()
        self.subtotal = sum(li.line_total for li in lines)
        self.tax_total = sum(li.line_total * (li.tax_rate / 100) for li in lines)
        self.total = self.subtotal + self.tax_total
        self.save(update_fields=["subtotal", "tax_total", "total", "updated_at"])

    def __str__(self):
        return self.bill_number or f"Bill #{self.pk}"


class BillLineItem(models.Model):
    bill        = models.ForeignKey(Bill, on_delete=models.CASCADE,
                                     related_name="line_items")
    product     = models.ForeignKey("SL_Sales.Product", on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name="bill_lines")
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
        return f"{self.bill} — {self.description}"
