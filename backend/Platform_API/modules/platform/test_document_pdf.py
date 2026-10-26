# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image
from pypdf import PdfReader
from rest_framework.test import APIClient

from Platform_Core.models import DocumentTemplate, Tenant, TenantSettings, TenantUserProfile
from Platform_Core.template_library import (
    _legacy_body, _legacy_stylesheet, ensure_shared_document_template_library,
)
from SL_Sales.models import Estimate, EstimateLineItem
from SL_Weighbridge.models import Customer, Invoice, InvoiceLine
from SL_Procurement.models import PurchaseOrder, PurchaseOrderItem


class DocumentPdfTests(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.tenant = Tenant.objects.create(name="Branded Tenant", code="branded-pdf", is_active=True, status="active")
        self.user = User.objects.create_user("pdf-user")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        logo = BytesIO()
        Image.new("RGB", (120, 50), color="black").save(logo, format="PNG")
        self.settings = TenantSettings.objects.create(
            tenant=self.tenant, primary_color="#000000", footer_text="Branded document footer",
            logo_file=SimpleUploadedFile("brand.png", logo.getvalue(), content_type="image/png"),
        )
        self.estimate = Estimate.objects.create(tenant=self.tenant, customer_name="PDF Customer", notes="Project notes", terms="Valid for 14 days")
        EstimateLineItem.objects.create(estimate=self.estimate, description="Professional services", quantity=2, unit_price=1500)
        self.estimate.recalculate()
        ensure_shared_document_template_library()

    def assert_pdf(self, response, number):
        self.assertEqual(response.status_code, 200, response.content[:200])
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn(".pdf", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF-"))
        reader = PdfReader(BytesIO(response.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn(number, text)
        self.assertIn("Branded Tenant", text)
        self.assertIn("Branded document footer", text)
        self.assertTrue(any(list(page.images) for page in reader.pages), "Logo must be embedded in the PDF")
        return reader, text

    def test_each_estimate_layout_exports_real_pdf_with_logo_and_brand(self):
        for name in ("Estimate Classic", "Estimate Modern", "Estimate Compact"):
            with self.subTest(layout=name):
                self.settings.estimate_template = DocumentTemplate.objects.get(tenant=None, name=name)
                self.settings.save()
                url = reverse("estimate-document", args=[self.estimate.pk])
                preview = self.client.get(url)
                self.assertIn(b"#000000", preview.content)
                self.assertIn(b"brand", preview.content)
                self.assertNotIn(b"{{ branding.primary_color }}", preview.content)
                response = self.client.get(url, {"download": "1"})
                _, text = self.assert_pdf(response, self.estimate.estimate_number)
                self.assertIn("KES 3,000.00", text)
                self.assertIn("Valid for 14 days", text)

    def test_invoice_pdf_honors_tenant_custom_template(self):
        customer = Customer.objects.create(tenant=self.tenant, name="PDF Customer")
        invoice = Invoice.objects.create(tenant=self.tenant, customer=customer, total_amount=3000, status="draft", currency="KES")
        InvoiceLine.objects.create(invoice=invoice, description="Services", quantity=2, unit_price=1500, total_amount=3000)
        response = self.client.get(reverse("invoice-document", args=[invoice.pk]), {"download": "pdf"})
        self.assert_pdf(response, invoice.invoice_number)
        self.settings.invoice_template = DocumentTemplate.objects.create(
            tenant=self.tenant, name="Private layout", document_type="invoice",
            body_template="<h1>Private invoice layout</h1><p>{{ document.number }}</p><p>{{ branding.footer_text }}</p>",
        )
        self.settings.save()
        response = self.client.get(reverse("invoice-document", args=[invoice.pk]), {"download": "pdf"})
        text = PdfReader(BytesIO(response.content)).pages[0].extract_text()
        self.assertIn("Private invoice layout", text)

    def test_purchase_order_pdf_has_branding_and_order_lines(self):
        order = PurchaseOrder.objects.create(tenant=self.tenant, reference="PO-PDF-001", supplier_name="PDF Supplier", order_date="2026-10-25", created_by=self.user)
        PurchaseOrderItem.objects.create(order=order, description="Office supplies", quantity=2, unit_price=1500)
        order.recalculate_total()
        response = self.client.get(reverse("procurement-order-document", args=[order.pk]), {"download": "pdf"})
        _, text = self.assert_pdf(response, order.reference)
        self.assertIn("Office supplies", text)
        self.assertIn("PDF Supplier", text)

    def test_statement_pdf_uses_selected_layout_and_preserves_aging(self):
        customer = Customer.objects.create(tenant=self.tenant, name="Statement Customer")
        Invoice.objects.create(tenant=self.tenant, customer=customer, total_amount=3000, status="issued", currency="KES")
        self.settings.statement_template = DocumentTemplate.objects.get(tenant=None, name="Statement Modern")
        self.settings.save()
        response = self.client.get(reverse("customer-statement-document", args=[customer.pk]), {"download": "pdf"})
        _, text = self.assert_pdf(response, f"STM-{customer.pk:04d}")
        self.assertIn("Aging Summary", text)
        self.assertIn("Outstanding Balance", " ".join(text.split()))
        self.assertIn("KES 3,000.00", text)

    def test_estimate_email_attaches_pdf(self):
        self.settings.smtp_host = "smtp.example.test"
        self.settings.smtp_user = "sender@example.test"
        self.settings.save()
        with patch("Platform_API.modules.sales.views.get_tenant_smtp_connection", return_value=mail.get_connection()):
            response = self.client.post(reverse("estimate-email", args=[self.estimate.pk]), {"email": "customer@example.test"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        attachment = mail.outbox[0].attachments[0]
        self.assertTrue(attachment[0].endswith(".pdf"))
        self.assertTrue(attachment[1].startswith(b"%PDF-"))
        self.assertEqual(attachment[2], "application/pdf")

    def test_long_estimate_continues_onto_multiple_pages(self):
        EstimateLineItem.objects.bulk_create([
            EstimateLineItem(estimate=self.estimate, description=f"Service line {index:03d}", quantity=1, unit_price=100, line_total=100)
            for index in range(100)
        ])
        self.estimate.recalculate()
        response = self.client.get(reverse("estimate-document", args=[self.estimate.pk]), {"download": "pdf"})
        reader, text = self.assert_pdf(response, self.estimate.estimate_number)
        self.assertGreater(len(reader.pages), 1)
        self.assertIn("Service line 099", text)
        self.assertIn("KES 13,000.00", text)

    def test_pdf_cannot_be_downloaded_by_a_different_tenant(self):
        other = Tenant.objects.create(name="Other", code="other-pdf")
        user = User.objects.create_user("other-pdf-user")
        TenantUserProfile.objects.create(user=user, tenant=other, is_tenant_admin=True)
        self.client.force_authenticate(user)
        response = self.client.get(reverse("estimate-document", args=[self.estimate.pk]), {"download": "pdf"})
        self.assertEqual(response.status_code, 404)

    def test_library_upgrades_untouched_shared_templates_and_preserves_customizations(self):
        template = DocumentTemplate.objects.get(tenant=None, name="Estimate Classic")
        template.body_template = _legacy_body("Estimate", "classic")
        template.stylesheet = _legacy_stylesheet("classic")
        template.save()
        ensure_shared_document_template_library()
        template.refresh_from_db()
        self.assertIn("business-document", template.body_template)
        template.body_template = "<h1>Customized shared layout</h1>"
        template.save()
        ensure_shared_document_template_library()
        template.refresh_from_db()
        self.assertEqual(template.body_template, "<h1>Customized shared layout</h1>")
