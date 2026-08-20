from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Inventory.models import InventoryBalance, InventoryMovement, InventoryReservation, Warehouse
from SL_Procurement.models import GoodsReceiptNote, PurchaseOrder, PurchaseOrderItem
from SL_Sales.models import Product, SalesOrder


class InventoryIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Inventory Tenant", code="inventory-tenant", is_active=True, status="active")
        self.user = User.objects.create_user("inventory_admin", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.client.force_authenticate(self.user)

        self.stock_product = Product.objects.create(
            tenant=self.tenant,
            code="SKU-001",
            name="Stock Item",
            product_type="product",
            unit="pcs",
            unit_price=Decimal("125.00"),
            tax_rate=Decimal("0.00"),
            is_active=True,
            is_sales_item=True,
            is_purchase_item=True,
            is_stock_item=True,
            is_service=False,
        )

    def test_goods_receipt_posts_inventory_balance_and_movement(self):
        po = PurchaseOrder.objects.create(
            tenant=self.tenant,
            reference="PO-INV-001",
            supplier_name="Supplier A",
            status="Approved",
            order_date="2026-08-12",
            total_amount=Decimal("500.00"),
            currency="KES",
            created_by=self.user,
        )
        po_item = PurchaseOrderItem.objects.create(
            order=po,
            product=self.stock_product,
            description="Stock Item",
            unit="pcs",
            quantity=Decimal("4.000"),
            unit_price=Decimal("125.00"),
            total=Decimal("0"),
        )

        response = self.client.post(
            reverse("procurement-receipts"),
            {
                "purchase_order": po.id,
                "received_date": "2026-08-12",
                "status": "received",
                "lines": [
                    {
                        "purchase_order_item": po_item.id,
                        "product": self.stock_product.id,
                        "description": "Stock Item",
                        "ordered_quantity": "4.000",
                        "received_quantity": "4.000",
                        "accepted_quantity": "4.000",
                        "unit_price": "125.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

        receipt = GoodsReceiptNote.objects.get(pk=response.data["id"])
        warehouse = Warehouse.objects.get(tenant=self.tenant, is_default=True)
        balance = InventoryBalance.objects.get(tenant=self.tenant, warehouse=warehouse, product=self.stock_product)
        movement = InventoryMovement.objects.get(
            tenant=self.tenant,
            reference_type="goods_receipt",
            reference_id=receipt.id,
            product=self.stock_product,
        )

        self.assertEqual(balance.on_hand_qty, Decimal("4.000"))
        self.assertEqual(balance.reserved_qty, Decimal("0"))
        self.assertEqual(balance.available_qty, Decimal("4.000"))
        self.assertEqual(movement.movement_type, "receipt")
        self.assertEqual(movement.quantity, Decimal("4.000"))

    def test_sales_order_confirmation_and_fulfillment_sync_inventory(self):
        Warehouse.objects.create(
            tenant=self.tenant,
            code="MAIN",
            name="Main Warehouse",
            warehouse_type="main",
            status="active",
            is_default=True,
        )
        InventoryBalance.objects.create(
            tenant=self.tenant,
            warehouse=Warehouse.objects.get(tenant=self.tenant, code="MAIN"),
            product=self.stock_product,
            on_hand_qty=Decimal("10.000"),
            reserved_qty=Decimal("0"),
            available_qty=Decimal("10.000"),
            average_cost=Decimal("125.00"),
            valuation_amount=Decimal("1250.00"),
        )

        response = self.client.post(
            reverse("sales-order-list"),
            {
                "customer_name": "Walk In Buyer",
                "status": "confirmed",
                "line_items": [
                    {
                        "product": self.stock_product.id,
                        "description": "Stock Item",
                        "quantity": "3.000",
                        "unit_price": "125.00",
                        "tax_rate": "0.00",
                        "discount_amount": "0.00",
                        "sort_order": 1,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

        order = SalesOrder.objects.get(pk=response.data["id"])
        reservation = InventoryReservation.objects.get(sales_order=order, product=self.stock_product)
        balance = InventoryBalance.objects.get(product=self.stock_product, warehouse__tenant=self.tenant)

        self.assertEqual(reservation.status, "active")
        self.assertEqual(reservation.quantity, Decimal("3.000"))
        self.assertEqual(balance.on_hand_qty, Decimal("10.000"))
        self.assertEqual(balance.reserved_qty, Decimal("3.000"))
        self.assertEqual(balance.available_qty, Decimal("7.000"))

        response = self.client.patch(
            reverse("sales-order-detail", kwargs={"pk": order.pk}),
            {"status": "fulfilled"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        reservation.refresh_from_db()
        balance.refresh_from_db()
        issue = InventoryMovement.objects.get(
            tenant=self.tenant,
            reference_type="sales_order",
            reference_id=order.id,
            movement_type="issue",
            product=self.stock_product,
        )

        self.assertEqual(reservation.status, "consumed")
        self.assertEqual(balance.on_hand_qty, Decimal("7.000"))
        self.assertEqual(balance.reserved_qty, Decimal("0"))
        self.assertEqual(balance.available_qty, Decimal("7.000"))
        self.assertEqual(issue.quantity, Decimal("3.000"))
