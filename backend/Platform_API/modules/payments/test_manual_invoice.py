from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Sales.models import Product
from SL_Weighbridge.models import Customer, Invoice


class ManualInvoiceCreationTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Invoice Workspace",
            code="invoice-workspace",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("invoice-admin", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        self.customer = Customer.objects.create(
            tenant=self.tenant,
            name="Invoice Customer",
            phone_number="+254700123987",
            email="invoice-customer@example.test",
        )
        self.product = Product.objects.create(
            tenant=self.tenant,
            code="SUPPORT",
            name="Support",
            description="Annual support",
            product_type="service",
            unit_price=Decimal("6000.00"),
            is_sales_item=True,
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_creates_product_linked_invoice_with_combined_tax(self):
        response = self.client.post(
            reverse("invoice-list"),
            {
                "customer_id": self.customer.pk,
                "currency": "KES",
                "source_module": "manual",
                "tax_mode": "combined",
                "combined_tax_rate": 16,
                "line_items": [
                    {
                        "product_id": self.product.pk,
                        "description": "Edited invoice wording",
                        "qty": "0.500",
                        "unit_price": "6000.00",
                        "tax_rate": 0,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        invoice = Invoice.objects.get(pk=response.data["id"])
        self.assertEqual(invoice.subtotal_amount, Decimal("3000.00"))
        self.assertEqual(invoice.tax_total, Decimal("480.00"))
        self.assertEqual(invoice.total_amount, Decimal("3480.00"))
        line = invoice.lines.get()
        self.assertEqual(line.product, self.product)
        self.assertEqual(line.quantity, Decimal("0.500"))
        self.assertEqual(line.description, "Edited invoice wording")

