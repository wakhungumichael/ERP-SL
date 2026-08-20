from django.contrib import admin

from .models import InventoryBalance, InventoryMovement, InventoryReservation, Warehouse


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "tenant", "branch", "warehouse_type", "status", "is_default")
    list_filter = ("warehouse_type", "status", "is_default")
    search_fields = ("name", "code", "tenant__name", "branch__name")


@admin.register(InventoryBalance)
class InventoryBalanceAdmin(admin.ModelAdmin):
    list_display = ("warehouse", "product", "on_hand_qty", "reserved_qty", "available_qty", "valuation_amount")
    list_filter = ("warehouse__tenant", "warehouse")
    search_fields = ("warehouse__name", "product__name", "product__code")


@admin.register(InventoryMovement)
class InventoryMovementAdmin(admin.ModelAdmin):
    list_display = ("movement_type", "reference_number", "warehouse", "product", "quantity", "movement_date")
    list_filter = ("movement_type", "reference_type", "warehouse__tenant")
    search_fields = ("reference_number", "warehouse__name", "product__name", "product__code")


@admin.register(InventoryReservation)
class InventoryReservationAdmin(admin.ModelAdmin):
    list_display = ("sales_order", "product", "warehouse", "quantity", "status", "reserved_at")
    list_filter = ("status", "warehouse__tenant")
    search_fields = ("sales_order__order_number", "product__name", "warehouse__name")

