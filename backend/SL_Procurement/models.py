from django.conf import settings
from django.db import models


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
