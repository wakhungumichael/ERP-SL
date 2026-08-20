import datetime
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Sales.models import Estimate, EstimateLineItem, SalesOrder
from SL_Weighbridge.models import Company, Customer, Invoice


class SalesOrderFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Savannah Logistics", code="savannah-logistics", is_active=True, status="active")
        self.user = User.objects.create_user("sales_admin", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.client.force_authenticate(self.user)

        self.company = Company.objects.create(
            name="Savannah Logistics Ltd",
            address="Nairobi",
            email="sales@savannah.test",
            phone="+254700000010",
        )
        self.customer = Customer.objects.create(
            name="Customer A",
            phone_number="+254700000011",
            email="customera@test.local",
        )

    def test_estimate_can_convert_to_sales_order(self):
        estimate = Estimate.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            customer_name=self.customer.name,
            status="sent",
            discount_total=Decimal("100.00"),
            notes="Urgent order",
            terms="Net 30",
        )
        EstimateLineItem.objects.create(
            estimate=estimate,
            description="Bulk cargo handling",
            quantity=Decimal("2"),
            unit_price=Decimal("1000.00"),
            tax_rate=Decimal("16.00"),
            discount_amount=Decimal("0.00"),
        )
        estimate.recalculate()

        response = self.client.post(reverse("estimate-convert-to-order", kwargs={"pk": estimate.pk}))
        self.assertEqual(response.status_code, 201, response.data)

        estimate.refresh_from_db()
        self.assertIsNotNone(estimate.converted_to_sales_order_id)
        order = SalesOrder.objects.get(pk=estimate.converted_to_sales_order_id)
        self.assertEqual(order.status, "confirmed")
        self.assertEqual(order.line_items.count(), 1)
        self.assertEqual(order.total, estimate.total)

    def test_sales_order_can_convert_to_invoice(self):
        order = SalesOrder.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            customer_name=self.customer.name,
            status="confirmed",
            notes="Invoice this order",
        )
        order.line_items.create(
            description="Handling fee",
            quantity=Decimal("1"),
            unit_price=Decimal("2500.00"),
            tax_rate=Decimal("0.00"),
            discount_amount=Decimal("0.00"),
        )
        order.recalculate()

        response = self.client.post(reverse("sales-order-convert", kwargs={"pk": order.pk}))
        self.assertEqual(response.status_code, 201, response.data)

        order.refresh_from_db()
        self.assertEqual(order.status, "invoiced")
        self.assertIsNotNone(order.converted_to_invoice_id)
        invoice = Invoice.objects.get(pk=order.converted_to_invoice_id)
        self.assertEqual(invoice.total_amount, order.total)

    def test_sales_order_with_manual_customer_and_decimal_quantity_converts_to_invoice(self):
        order = SalesOrder.objects.create(
            tenant=self.tenant,
            customer=None,
            customer_name="Walk In Buyer",
            status="confirmed",
            notes="Manual customer order",
        )
        order.line_items.create(
            description="Bulk aggregate",
            quantity=Decimal("0.500"),
            unit_price=Decimal("2500.00"),
            tax_rate=Decimal("0.00"),
            discount_amount=Decimal("0.00"),
        )
        order.recalculate()

        response = self.client.post(reverse("sales-order-convert", kwargs={"pk": order.pk}))
        self.assertEqual(response.status_code, 201, response.data)

        order.refresh_from_db()
        invoice = Invoice.objects.get(pk=order.converted_to_invoice_id)
        self.assertEqual(invoice.customer.name, "Walk In Buyer")
        self.assertEqual(invoice.total_amount, order.total)
        self.assertEqual(invoice.lines.count(), 1)
        invoice_line = invoice.lines.first()
        self.assertEqual(invoice_line.quantity, 1)
        self.assertEqual(invoice_line.total_amount, order.line_items.first().line_total)
        self.assertIn("Qty 0.5", invoice_line.description)

    def test_estimate_to_invoice_creates_invoice_lines(self):
        estimate = Estimate.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            customer_name=self.customer.name,
            status="accepted",
            discount_total=Decimal("0.00"),
            notes="Convert with lines",
            terms="Net 30",
        )
        EstimateLineItem.objects.create(
            estimate=estimate,
            description="Quoted handling",
            quantity=Decimal("2"),
            unit_price=Decimal("1000.00"),
            tax_rate=Decimal("16.00"),
            discount_amount=Decimal("0.00"),
        )
        estimate.recalculate()

        response = self.client.post(reverse("estimate-convert", kwargs={"pk": estimate.pk}))
        self.assertEqual(response.status_code, 201, response.data)

        estimate.refresh_from_db()
        invoice = Invoice.objects.get(pk=estimate.converted_to_invoice_id)
        self.assertEqual(invoice.lines.count(), 1)
        self.assertEqual(invoice.lines.first().total_amount, estimate.line_items.first().line_total)

    def test_aging_report_buckets_receivables(self):
        today = timezone.localdate()
        invoice_specs = [
            ("INV-CURRENT", today + datetime.timedelta(days=5), Decimal("1000.00"), "current"),
            ("INV-10", today - datetime.timedelta(days=10), Decimal("2000.00"), "days_1_30"),
            ("INV-45", today - datetime.timedelta(days=45), Decimal("3000.00"), "days_31_60"),
            ("INV-75", today - datetime.timedelta(days=75), Decimal("4000.00"), "days_61_90"),
            ("INV-120", today - datetime.timedelta(days=120), Decimal("5000.00"), "days_90_plus"),
        ]
        for number, due_date, total, _ in invoice_specs:
            Invoice.objects.create(
                tenant=self.tenant,
                customer=self.customer,
                invoice_number=number,
                total_amount=total,
                due_date=due_date,
                status="issued",
                currency="KES",
            )

        response = self.client.get(reverse("sales-aging"))
        self.assertEqual(response.status_code, 200, response.data)
        summary = response.data["summary"]
        self.assertEqual(summary["current"], 1000.0)
        self.assertEqual(summary["days_1_30"], 2000.0)
        self.assertEqual(summary["days_31_60"], 3000.0)
        self.assertEqual(summary["days_61_90"], 4000.0)
        self.assertEqual(summary["days_90_plus"], 5000.0)
