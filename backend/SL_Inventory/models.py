from decimal import Decimal

from django.conf import settings
from django.db import models

from Platform_Core.models import AuditMetadataMixin


class Warehouse(AuditMetadataMixin, models.Model):
    TYPE_CHOICES = [
        ("main", "Main"),
        ("transit", "Transit"),
        ("branch", "Branch"),
        ("returns", "Returns"),
        ("restricted", "Restricted"),
    ]
    STATUS_CHOICES = [
        ("active", "Active"),
        ("inactive", "Inactive"),
        ("blocked", "Blocked"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="warehouses")
    branch = models.ForeignKey(
        "SL_Weighbridge.Branch",
        on_delete=models.SET_NULL,
        related_name="warehouses",
        blank=True,
        null=True,
    )
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=180)
    warehouse_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="main")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    is_default = models.BooleanField(default=False)
    is_virtual = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["tenant__name", "name"]
        unique_together = ("tenant", "code")

    def __str__(self):
        return f"{self.code} - {self.name}"


class InventoryBalance(AuditMetadataMixin, models.Model):
    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="inventory_balances")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="balances")
    product = models.ForeignKey("SL_Sales.Product", on_delete=models.CASCADE, related_name="inventory_balances")
    on_hand_qty = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    reserved_qty = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    available_qty = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    average_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valuation_amount = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    last_movement_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["warehouse__name", "product__name"]
        unique_together = ("warehouse", "product")

    def recalculate_available(self):
        self.available_qty = Decimal(self.on_hand_qty or 0) - Decimal(self.reserved_qty or 0)

    def __str__(self):
        return f"{self.warehouse} - {self.product}"


class InventoryMovement(AuditMetadataMixin, models.Model):
    MOVEMENT_TYPE_CHOICES = [
        ("receipt", "Receipt"),
        ("reservation", "Reservation"),
        ("release", "Release"),
        ("issue", "Issue"),
        ("adjustment", "Adjustment"),
    ]
    REFERENCE_TYPE_CHOICES = [
        ("goods_receipt", "Goods Receipt"),
        ("sales_order", "Sales Order"),
        ("manual", "Manual"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="inventory_movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="movements")
    product = models.ForeignKey("SL_Sales.Product", on_delete=models.CASCADE, related_name="inventory_movements")
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPE_CHOICES)
    reference_type = models.CharField(max_length=30, choices=REFERENCE_TYPE_CHOICES, default="manual")
    reference_id = models.PositiveIntegerField(blank=True, null=True)
    reference_line_id = models.PositiveIntegerField(blank=True, null=True)
    reference_number = models.CharField(max_length=80, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_cost = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    movement_date = models.DateTimeField()
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="inventory_movements_created",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-movement_date", "-id"]

    def save(self, *args, **kwargs):
        self.total_cost = Decimal(self.quantity or 0) * Decimal(self.unit_cost or 0)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.movement_type}:{self.reference_number or self.id}"


class InventoryReservation(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("released", "Released"),
        ("consumed", "Consumed"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="inventory_reservations")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="reservations")
    product = models.ForeignKey("SL_Sales.Product", on_delete=models.CASCADE, related_name="inventory_reservations")
    sales_order = models.ForeignKey(
        "SL_Sales.SalesOrder",
        on_delete=models.CASCADE,
        related_name="inventory_reservations",
        blank=True,
        null=True,
    )
    sales_order_line = models.ForeignKey(
        "SL_Sales.SalesOrderLineItem",
        on_delete=models.CASCADE,
        related_name="inventory_reservations",
        blank=True,
        null=True,
    )
    quantity = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    reserved_at = models.DateTimeField()
    released_at = models.DateTimeField(blank=True, null=True)
    consumed_at = models.DateTimeField(blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="inventory_reservations_created",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-reserved_at", "-id"]

    def __str__(self):
        return f"Reservation {self.product} x {self.quantity}"

