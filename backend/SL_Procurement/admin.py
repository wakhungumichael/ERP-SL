from django.contrib import admin

from .models import (
    ApprovalMatrix,
    GoodsReceiptLine,
    GoodsReceiptNote,
    MatchException,
    PaymentQueueItem,
    PurchaseOrder,
    PurchaseOrderItem,
    Requisition,
    RequisitionApproval,
    RequisitionLine,
)


class RequisitionLineInline(admin.TabularInline):
    model = RequisitionLine
    extra = 1
    fields = ["item_type", "description", "unit", "quantity", "unit_price", "line_total", "gl_account"]
    readonly_fields = ["line_total"]


class RequisitionApprovalInline(admin.TabularInline):
    model = RequisitionApproval
    extra = 0
    fields = ["step_order", "approval_group", "status", "assigned_user", "acted_by", "acted_at"]
    readonly_fields = ["acted_at"]


@admin.register(Requisition)
class RequisitionAdmin(admin.ModelAdmin):
    list_display = [
        "request_number",
        "tenant",
        "title",
        "cost_center",
        "status",
        "budget_status",
        "estimated_total",
        "currency",
    ]
    list_filter = ["tenant", "status", "budget_status", "currency"]
    search_fields = ["request_number", "title", "cost_center", "project_code"]
    inlines = [RequisitionLineInline, RequisitionApprovalInline]


@admin.register(ApprovalMatrix)
class ApprovalMatrixAdmin(admin.ModelAdmin):
    list_display = ["tenant", "name", "cost_center", "min_amount", "max_amount", "step_order", "approval_group", "is_active"]
    list_filter = ["tenant", "is_active", "approval_group"]
    search_fields = ["name", "cost_center", "tenant__name", "approval_group__name"]

class POItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 1
    fields = ["description", "unit", "quantity", "unit_price", "total"]
    readonly_fields = ["total"]


class GoodsReceiptLineInline(admin.TabularInline):
    model = GoodsReceiptLine
    extra = 1
    fields = ["purchase_order_item", "description", "ordered_quantity", "received_quantity", "accepted_quantity", "unit_price", "line_total"]
    readonly_fields = ["line_total"]


@admin.register(GoodsReceiptNote)
class GoodsReceiptNoteAdmin(admin.ModelAdmin):
    list_display = ["receipt_number", "tenant", "purchase_order", "received_date", "status"]
    list_filter = ["tenant", "status"]
    search_fields = ["receipt_number", "purchase_order__reference"]
    inlines = [GoodsReceiptLineInline]

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ["reference", "tenant", "supplier_name", "status", "order_date", "total_amount", "currency"]
    list_filter = ["tenant", "status"]
    search_fields = ["reference", "supplier_name", "cost_center", "project_code"]
    inlines = [POItemInline]


@admin.register(MatchException)
class MatchExceptionAdmin(admin.ModelAdmin):
    list_display = ["tenant", "exception_type", "status", "bill", "purchase_order", "goods_receipt", "variance_percent"]
    list_filter = ["tenant", "exception_type", "status"]
    search_fields = ["message", "line_reference"]


@admin.register(PaymentQueueItem)
class PaymentQueueItemAdmin(admin.ModelAdmin):
    list_display = ["tenant", "bill", "supplier_name", "amount", "due_date", "status", "prepared_at"]
    list_filter = ["tenant", "status"]
    search_fields = ["supplier_name", "payment_reference", "bill__bill_number"]
