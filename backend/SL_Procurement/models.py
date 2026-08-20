from django.conf import settings
from django.db import models
from django.utils import timezone
from django.contrib.auth.models import Group
from Platform_Core.models import AuditMetadataMixin


class Requisition(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("submitted", "Submitted"),
        ("pending_approval", "Pending Approval"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("cancelled", "Cancelled"),
        ("po_created", "PO Created"),
    ]
    BUDGET_STATUS_CHOICES = [
        ("pending", "Pending"),
        ("passed", "Passed"),
        ("warning", "Warning"),
        ("blocked", "Blocked"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="requisitions")
    branch = models.ForeignKey(
        "SL_Weighbridge.Branch",
        on_delete=models.SET_NULL,
        related_name="requisitions",
        blank=True,
        null=True,
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requisitions",
    )
    request_number = models.CharField(max_length=50, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    cost_center = models.CharField(max_length=120)
    gl_account = models.ForeignKey(
        "Platform_Core.Account",
        on_delete=models.SET_NULL,
        related_name="requisitions",
        blank=True,
        null=True,
    )
    project_code = models.CharField(max_length=80, blank=True)
    needed_by = models.DateField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    budget_status = models.CharField(max_length=20, choices=BUDGET_STATUS_CHOICES, default="pending")
    budget_message = models.CharField(max_length=255, blank=True)
    estimated_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="KES")
    vendor_option = models.CharField(max_length=200, blank=True)
    submitted_at = models.DateTimeField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.request_number:
            ts = timezone.now().strftime("%Y%m%d%H%M%S")
            self.request_number = f"REQ-{ts}-{self.tenant_id or 'X'}"
        super().save(*args, **kwargs)

    def recalculate_total(self):
        from django.db.models import Sum

        self.estimated_total = self.lines.aggregate(total=Sum("line_total"))["total"] or 0
        self.save(update_fields=["estimated_total", "updated_at"])

    def __str__(self):
        return self.request_number or f"Requisition #{self.pk}"


class RequisitionLine(AuditMetadataMixin, models.Model):
    ITEM_TYPE_CHOICES = [
        ("goods", "Goods"),
        ("service", "Service"),
    ]

    requisition = models.ForeignKey(Requisition, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey(
        "SL_Sales.Product",
        on_delete=models.SET_NULL,
        related_name="requisition_lines",
        blank=True,
        null=True,
    )
    item_type = models.CharField(max_length=20, choices=ITEM_TYPE_CHOICES, default="goods")
    description = models.CharField(max_length=300)
    unit = models.CharField(max_length=50, default="pcs")
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    gl_account = models.ForeignKey(
        "Platform_Core.Account",
        on_delete=models.SET_NULL,
        related_name="requisition_lines",
        blank=True,
        null=True,
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["id"]

    def save(self, *args, **kwargs):
        self.line_total = self.quantity * self.unit_price
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.requisition} - {self.description}"


class ApprovalMatrix(AuditMetadataMixin, models.Model):
    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="approval_matrices")
    name = models.CharField(max_length=180)
    cost_center = models.CharField(max_length=120, blank=True)
    min_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    max_amount = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    step_order = models.PositiveIntegerField(default=1)
    approval_group = models.ForeignKey(
        Group,
        on_delete=models.PROTECT,
        related_name="procurement_approval_rules",
    )
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["tenant__name", "step_order", "min_amount"]

    def __str__(self):
        return f"{self.tenant.name} - {self.name}"


class RequisitionApproval(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("skipped", "Skipped"),
    ]

    requisition = models.ForeignKey(Requisition, on_delete=models.CASCADE, related_name="approvals")
    matrix = models.ForeignKey(
        ApprovalMatrix,
        on_delete=models.SET_NULL,
        related_name="approval_steps",
        blank=True,
        null=True,
    )
    workflow_node = models.ForeignKey(
        "Platform_Core.WorkflowNodeDefinition",
        on_delete=models.SET_NULL,
        related_name="procurement_approvals",
        blank=True,
        null=True,
    )
    step_order = models.PositiveIntegerField(default=1)
    approval_group = models.ForeignKey(
        Group,
        on_delete=models.PROTECT,
        related_name="procurement_approvals",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    assigned_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="assigned_procurement_approvals",
        blank=True,
        null=True,
    )
    acted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="acted_procurement_approvals",
        blank=True,
        null=True,
    )
    decision_notes = models.TextField(blank=True)
    acted_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["step_order", "id"]

    def __str__(self):
        return f"{self.requisition.request_number} - Step {self.step_order}"


class PurchaseOrder(AuditMetadataMixin, models.Model):
    STATUSES = [
        ("Draft",      "Draft"),
        ("Submitted",  "Submitted"),
        ("Approved",   "Approved"),
        ("Received",   "Received"),
        ("Cancelled",  "Cancelled"),
    ]

    reference      = models.CharField(max_length=50, unique=True)
    tenant         = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="purchase_orders",
        blank=True,
        null=True,
    )
    branch         = models.ForeignKey(
        "SL_Weighbridge.Branch",
        on_delete=models.SET_NULL,
        related_name="purchase_orders",
        blank=True,
        null=True,
    )
    requisition    = models.ForeignKey(
        Requisition,
        on_delete=models.SET_NULL,
        related_name="purchase_orders",
        blank=True,
        null=True,
    )
    supplier_name  = models.CharField(max_length=200)
    supplier_email = models.EmailField(blank=True)
    supplier_phone = models.CharField(max_length=50, blank=True)
    status         = models.CharField(max_length=20, choices=STATUSES, default="Draft")
    order_date     = models.DateField()
    expected_date  = models.DateField(null=True, blank=True)
    cost_center    = models.CharField(max_length=120, blank=True)
    gl_account     = models.ForeignKey(
        "Platform_Core.Account",
        on_delete=models.SET_NULL,
        related_name="purchase_orders",
        blank=True,
        null=True,
    )
    project_code   = models.CharField(max_length=80, blank=True)
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


class PurchaseOrderItem(AuditMetadataMixin, models.Model):
    order       = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    product     = models.ForeignKey(
        "SL_Sales.Product",
        on_delete=models.SET_NULL,
        related_name="purchase_order_items",
        blank=True,
        null=True,
    )
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


class GoodsReceiptNote(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("received", "Received"),
        ("partial", "Partial"),
        ("closed", "Closed"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="goods_receipts")
    branch = models.ForeignKey(
        "SL_Weighbridge.Branch",
        on_delete=models.SET_NULL,
        related_name="goods_receipts",
        blank=True,
        null=True,
    )
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name="goods_receipts",
    )
    receipt_number = models.CharField(max_length=50, blank=True)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="goods_receipts",
    )
    received_date = models.DateField(default=timezone.now)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.receipt_number:
            ts = timezone.now().strftime("%Y%m%d%H%M%S")
            self.receipt_number = f"GRN-{ts}-{self.tenant_id or 'X'}"
        super().save(*args, **kwargs)

    def __str__(self):
        return self.receipt_number or f"GRN #{self.pk}"


class GoodsReceiptLine(AuditMetadataMixin, models.Model):
    goods_receipt = models.ForeignKey(GoodsReceiptNote, on_delete=models.CASCADE, related_name="lines")
    purchase_order_item = models.ForeignKey(
        PurchaseOrderItem,
        on_delete=models.SET_NULL,
        related_name="receipt_lines",
        blank=True,
        null=True,
    )
    product = models.ForeignKey(
        "SL_Sales.Product",
        on_delete=models.SET_NULL,
        related_name="goods_receipt_lines",
        blank=True,
        null=True,
    )
    description = models.CharField(max_length=300)
    ordered_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    received_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    accepted_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        ordering = ["id"]

    def save(self, *args, **kwargs):
        self.line_total = self.accepted_quantity * self.unit_price
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.goods_receipt} - {self.description}"


# ── Bill (vendor/supplier invoice) ────────────────────────────────────────────

class Bill(AuditMetadataMixin, models.Model):
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
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bills",
    )
    goods_receipt = models.ForeignKey(
        GoodsReceiptNote,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bills",
    )
    supplier_name = models.CharField(max_length=200, blank=True,
                                      help_text="Fallback if no FK supplier")

    bill_number = models.CharField(max_length=50, blank=True)
    reference   = models.CharField(max_length=100, blank=True,
                                    help_text="Supplier's own reference number")
    issue_date  = models.DateField(default=timezone.now)
    due_date    = models.DateField(null=True, blank=True)
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    match_status = models.CharField(max_length=20, default="pending")

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


class BillLineItem(AuditMetadataMixin, models.Model):
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


class MatchException(AuditMetadataMixin, models.Model):
    TYPE_CHOICES = [
        ("missing_po", "Missing PO"),
        ("missing_receipt", "Missing Receipt"),
        ("quantity_variance", "Quantity Variance"),
        ("price_variance", "Price Variance"),
        ("line_missing", "Line Missing"),
    ]
    STATUS_CHOICES = [
        ("open", "Open"),
        ("resolved", "Resolved"),
        ("waived", "Waived"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="match_exceptions")
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="match_exceptions",
    )
    goods_receipt = models.ForeignKey(
        GoodsReceiptNote,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="match_exceptions",
    )
    bill = models.ForeignKey(
        Bill,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="match_exceptions",
    )
    exception_type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    line_reference = models.CharField(max_length=255, blank=True)
    variance_percent = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    message = models.CharField(max_length=255)
    details = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "-created_at"]

    def __str__(self):
        return f"{self.exception_type} - {self.message}"


class PaymentQueueItem(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("ready", "Ready"),
        ("scheduled", "Scheduled"),
        ("paid", "Paid"),
        ("blocked", "Blocked"),
    ]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="payment_queue_items")
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name="payment_queue_items")
    supplier_name = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    due_date = models.DateField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    payment_reference = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)
    prepared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="prepared_payment_queue_items",
        blank=True,
        null=True,
    )
    prepared_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "due_date", "-created_at"]

    def __str__(self):
        return f"{self.bill.bill_number} - {self.status}"
