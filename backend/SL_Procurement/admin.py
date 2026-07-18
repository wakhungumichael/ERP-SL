from django.contrib import admin
from .models import PurchaseOrder, PurchaseOrderItem

class POItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 1
    fields = ["description", "unit", "quantity", "unit_price", "total"]
    readonly_fields = ["total"]

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ["reference", "supplier_name", "status", "order_date", "total_amount", "currency"]
    list_filter = ["status"]
    inlines = [POItemInline]
