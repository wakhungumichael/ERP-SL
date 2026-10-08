from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import DocumentTemplate, Tenant, TenantSettings, TenantUserProfile
from SL_Sales.models import Estimate, EstimateLineItem
from SL_Weighbridge.models import (
    Branch,
    Company,
    Currency,
    Customer,
    Invoice,
    InvoiceLine,
    Item,
    Transaction,
    Vehicle,
    VehicleType,
)
from SL_Procurement.models import PurchaseOrder, PurchaseOrderItem


class TenantDocumentRenderingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(
            name="Render Tenant",
            code="render-tenant",
            legal_name="Render Tenant Ltd",
            contact_email="accounts@render.test",
            contact_phone="+254700111222",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("renderer", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.client.force_authenticate(self.user)

        self.company = Company.objects.create(
            name="Render Company",
            address="Nairobi",
            email="hq@render.test",
            phone="+254700333444",
        )
        self.branch = Branch.objects.create(
            company=self.company,
            name="Main Branch",
            address="Industrial Area",
            email="branch@render.test",
            phone="+254700555666",
        )
        self.currency = Currency.objects.create(name="Kenya Shilling", code="KES", symbol="KSh")
        self.vehicle_type = VehicleType.objects.create(
            name="Tipper",
            charge=1800,
            currency=self.currency,
            max_tare_weight=12000,
        )
        self.customer = Customer.objects.create(
            name="Acme Customer",
            phone_number="+254700999000",
            email="customer@acme.test",
        )
        self.item = Item.objects.create(name="Ballast", currency=self.currency)
        self.vehicle = Vehicle.objects.create(
            number_plate="KDD 123A",
            customer=self.customer,
            vehicle_type=self.vehicle_type,
        )

    def test_invoice_document_uses_selected_tenant_template(self):
        template = DocumentTemplate.objects.create(
            tenant=self.tenant,
            name="Modern Invoice",
            document_type="invoice",
            engine="html",
            body_template="""
              <div class="custom-invoice">
                <h1>{{ company.name }}</h1>
                <div>Template: Invoice</div>
                <div>Document: {{ document.number }}</div>
                <div>Color: {{ branding.primary_color }}</div>
              </div>
            """,
            stylesheet=".custom-invoice{padding:20px;}",
        )
        TenantSettings.objects.create(
            tenant=self.tenant,
            primary_color="#123456",
            footer_text="Render footer",
            invoice_template=template,
        )
        invoice = Invoice.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            total_amount=3500,
            currency="KES",
            status="issued",
            notes="Invoice note",
        )
        InvoiceLine.objects.create(
            invoice=invoice,
            description="Consulting",
            quantity=2,
            unit_price=1750,
            total_amount=3500,
        )

        response = self.client.get(reverse("invoice-document", kwargs={"pk": invoice.pk}))

        self.assertEqual(response.status_code, 200)
        self.assertIn("Template: Invoice", response.content.decode())
        self.assertIn(invoice.invoice_number, response.content.decode())
        self.assertIn("#123456", response.content.decode())

    def test_estimate_document_uses_selected_estimate_template(self):
        template = DocumentTemplate.objects.create(
            tenant=self.tenant,
            name="Estimate Layout",
            document_type="quotation",
            engine="html",
            body_template="""
              <div class="estimate-template">
                <h1>Estimate Template</h1>
                <div>{{ customer.name }}</div>
                <div>{{ document.number }}</div>
              </div>
            """,
        )
        TenantSettings.objects.create(
            tenant=self.tenant,
            primary_color="#654321",
            estimate_template=template,
        )
        estimate = Estimate.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            customer=self.customer,
            issue_date="2026-07-26",
            customer_name=self.customer.name,
            notes="Estimate note",
            terms="Net 7",
        )
        EstimateLineItem.objects.create(
            estimate=estimate,
            description="Service A",
            quantity=1,
            unit_price=5000,
            tax_rate=0,
            discount_amount=0,
        )
        estimate.recalculate()

        response = self.client.get(reverse("estimate-document", kwargs={"pk": estimate.pk}))

        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn("Estimate Template", html)
        self.assertIn(estimate.estimate_number, html)
        self.assertIn(self.customer.name, html)

    def test_receipt_document_uses_selected_receipt_template(self):
        template = DocumentTemplate.objects.create(
            tenant=self.tenant,
            name="Receipt Layout",
            document_type="receipt",
            engine="html",
            body_template="""
              <div class="receipt-template">
                <h1>Receipt Template</h1>
                <div>{{ document.number }}</div>
                <div>{{ company.branch_name }}</div>
                <div>{{ totals.total_display }}</div>
              </div>
            """,
        )
        TenantSettings.objects.create(
            tenant=self.tenant,
            primary_color="#0f766e",
            receipt_template=template,
        )
        tx = Transaction.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            customer=self.customer,
            vehicle=self.vehicle,
            operator="Moses",
            item=self.item,
            vehicle_type=self.vehicle_type,
            status="Completed",
            gross_weight=24000,
            tare_weight=12000,
            net_weight=12000,
            charge=1800,
            destination="Mombasa",
            weight_type="First Weight",
            payment_mode="Cash",
            payment_status="Paid",
        )
        tx.image.name = "transaction_images/captured_vehicle.jpg"
        tx.save(update_fields=["image"])

        response = self.client.get(reverse("wb-transaction-receipt", kwargs={"pk": tx.pk}))

        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn("Receipt Template", html)
        self.assertIn("TX-", html)
        self.assertIn("Main Branch", html)
        self.assertIn("KES 1,800.00", html)
        self.assertIn("Captured Vehicle Image", html)
        self.assertIn("transaction_images/captured_vehicle.jpg", html)

    def test_purchase_order_document_uses_selected_template(self):
        template = DocumentTemplate.objects.create(
            tenant=self.tenant,
            name="PO Layout",
            document_type="purchase_order",
            engine="html",
            body_template="""
              <div class="po-template">
                <h1>Purchase Order Template</h1>
                <div>{{ document.number }}</div>
                <div>{{ customer.name }}</div>
                <div>{{ totals.total_display }}</div>
              </div>
            """,
        )
        TenantSettings.objects.create(
            tenant=self.tenant,
            primary_color="#7c3aed",
            purchase_order_template=template,
        )
        po = PurchaseOrder.objects.create(
            reference="PO-2040",
            supplier_name="BuildCo Supplies",
            supplier_email="orders@buildco.test",
            supplier_phone="+254711000222",
            status="Approved",
            order_date="2026-07-26",
            expected_date="2026-07-30",
            total_amount=3600,
            currency="KES",
            notes="Deliver to site",
            created_by=self.user,
        )
        PurchaseOrderItem.objects.create(
            order=po,
            description="Cement Bags",
            unit="bag",
            quantity=2,
            unit_price=1800,
            total=0,
        )
        po.recalculate_total()

        response = self.client.get(reverse("procurement-order-document", kwargs={"pk": po.pk}))

        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn("Purchase Order Template", html)
        self.assertIn("PO-2040", html)
        self.assertIn("BuildCo Supplies", html)
        self.assertIn("KES 3,600.00", html)
