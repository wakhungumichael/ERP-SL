from decimal import Decimal
from io import BytesIO

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse
from pypdf import PdfReader
from rest_framework.test import APIClient

from Platform_Core.document_pdf import document_pdf_bytes
from Platform_Core.documents import _invoice_context, render_invoice_document
from Platform_Core.models import DocumentTemplate, Tenant, TenantSettings, TenantUserProfile
from Platform_Core.professional_templates import body as old_body, stylesheet as old_stylesheet
from Platform_Core.template_library import ensure_shared_document_template_library
from SL_Weighbridge.models import Customer, Invoice, InvoiceCharge, InvoiceLine


class InvoiceBillingDetailsTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Invoice Issuer", code="invoice-billing-test", contact_email="accounts@example.test")
        self.settings = TenantSettings.objects.create(tenant=self.tenant, invoice_address="Issuer House\nNairobi, Kenya", invoice_tax_number="ISSUER-TAX", invoice_payment_instructions="Use the invoice number as the payment reference.", invoice_website="https://example.test", default_tax_name="VAT")
        self.user = User.objects.create_user("billing-editor", first_name="Accounts", last_name="Officer", email="officer@example.test")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Billing Client", address="Client House\nP.O. Box 123, Nairobi", email="client@example.test", phone_number="+254700900100")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_invoice(self, **values):
        data = {"customer_id": self.customer.pk, "line_items": [{"description": "Support services", "qty": "1", "unit_price": "100", "tax_rate": "16"}], **values}
        response = self.client.post(reverse("invoice-list"), data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Invoice.objects.get(pk=response.data["id"])

    def test_customer_contacts_are_snapshotted_and_preparer_is_recorded(self):
        invoice = self.create_invoice()
        self.customer.address = "New customer address"
        self.customer.email = "changed@example.test"
        self.customer.save()
        response = self.client.get(reverse("invoice-detail", args=[invoice.pk]))
        self.assertEqual(response.data["billing_address"], "Client House\nP.O. Box 123, Nairobi")
        self.assertEqual(response.data["billing_email"], "client@example.test")
        self.assertEqual(response.data["prepared_by_name"], "Accounts Officer")
        self.assertEqual(invoice.created_by, self.user)

    def test_create_and_edit_billing_details_without_changing_master_customer_or_money(self):
        invoice = self.create_invoice(billing_address="Invoice-specific address", billing_contact_name="Finance Manager", customer_reference="PO-2026-010", customer_tax_number="CLIENT-TAX")
        line_id = invoice.lines.get().pk
        invoice.status = "issued"
        invoice.save()
        response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), {"billing_address": "Corrected billing address", "billing_email": "billing@example.test", "billing_phone": "+254711900100", "billing_contact_name": "Accounts Manager"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        invoice.refresh_from_db()
        self.assertEqual(invoice.total_amount, Decimal("116.00"))
        self.assertEqual(invoice.lines.get().pk, line_id)
        self.assertEqual(invoice.billing_contact_name, "Accounts Manager")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.email, "client@example.test")
        self.assertEqual(self.customer.address, "Client House\nP.O. Box 123, Nairobi")

    def test_invalid_email_is_rejected_on_create_and_edit(self):
        response = self.client.post(reverse("invoice-list"), {"customer_id": self.customer.pk, "line_items": [{"description": "Services", "qty": 1, "unit_price": 100}], "billing_email": "invalid"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Invoice.objects.exists())
        invoice = self.create_invoice()
        response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), {"billing_email": "invalid"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_preparer_cannot_be_forged_and_viewer_cannot_edit_contacts(self):
        invoice = self.create_invoice()
        url = reverse("invoice-detail", args=[invoice.pk])
        self.assertEqual(self.client.patch(url, {"created_by": 99}, format="json").status_code, 400)
        profile = self.user.tenant_profile
        profile.is_tenant_admin = False
        profile.save()
        self.user = User.objects.get(pk=self.user.pk)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.patch(url, {"billing_address": "Denied"}, format="json").status_code, 403)

    def test_changing_draft_customer_clears_previous_customer_contact_details(self):
        invoice = self.create_invoice(billing_contact_name="Previous contact", customer_tax_number="OLD-TAX", customer_reference="OLD-PO")
        other = Customer.objects.create(tenant=self.tenant, name="Another client", address="Another address", email="another@example.test", phone_number="+254700900101")
        response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), {"customer_id": other.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["billing_address"], "Another address")
        self.assertEqual(response.data["billing_email"], "another@example.test")
        self.assertEqual(response.data["billing_contact_name"], "")
        self.assertEqual(response.data["customer_reference"], "")

    def test_old_invoices_fall_back_to_customer_address_without_inventing_a_preparer(self):
        invoice = Invoice.objects.create(tenant=self.tenant, customer=self.customer)
        Invoice.objects.filter(pk=invoice.pk).update(billing_address="", billing_email="", billing_phone="")
        invoice.refresh_from_db()
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["customer"]["address"], self.customer.address)
        self.assertEqual(context["company"]["prepared_by"], "")

    def test_charge_is_not_misreported_as_tax_and_pdf_has_party_details(self):
        invoice = self.create_invoice(billing_contact_name="Finance Manager", customer_tax_number="CLIENT-TAX", customer_reference="PO-2026-010")
        InvoiceCharge.objects.create(invoice=invoice, name="Delivery", amount=10)
        invoice.charge_total = 10
        invoice.total_amount = 126
        invoice.save()
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["totals"]["tax_display"], "KES 16.00")
        self.assertEqual(context["charges"][0]["amount_display"], "KES 10.00")
        ensure_shared_document_template_library()
        for variant in ["Classic", "Modern", "Compact"]:
            with self.subTest(variant=variant):
                self.settings.invoice_template = DocumentTemplate.objects.get(tenant=None, name=f"Invoice {variant}")
                self.settings.save()
                invoice.tenant = Tenant.objects.get(pk=self.tenant.pk)
                data = document_pdf_bytes(render_invoice_document(invoice).html)
                pdf = PdfReader(BytesIO(data))
                text = " ".join(" ".join(page.extract_text().split()) for page in pdf.pages)
                for expected in ["Client House", "Issuer House", "Finance Manager", "CLIENT-TAX", "ISSUER-TAX", "PO-2026-010", "Accounts Officer", "VAT (16%)", "Delivery", "KES 126.00", "Page 1 of 1"]:
                    self.assertIn(expected, text)
                self.assertEqual(len(pdf.pages), 1)
                self.assertNotIn("Discount", text)

    def test_previous_shared_invoice_layouts_upgrade_but_custom_edits_are_preserved(self):
        ensure_shared_document_template_library()
        template = DocumentTemplate.objects.get(tenant=None, name="Invoice Classic")
        template.body_template = old_body("Invoice", "classic")
        template.stylesheet = old_stylesheet("classic")
        template.save()
        ensure_shared_document_template_library()
        template.refresh_from_db()
        self.assertIn("Billing contact", template.body_template)
        template.stylesheet += "\n/* Custom company styling */"
        template.save()
        ensure_shared_document_template_library()
        template.refresh_from_db()
        self.assertIn("Custom company styling", template.stylesheet)

    def test_long_invoice_repeats_headers_and_numbers_every_page(self):
        invoice = self.create_invoice()
        InvoiceLine.objects.bulk_create([InvoiceLine(invoice=invoice, description=f"Service line {index:03d} with a detailed description", quantity=1, unit_price=100, total_amount=100) for index in range(65)])
        data = document_pdf_bytes(render_invoice_document(invoice).html)
        pdf = PdfReader(BytesIO(data))
        self.assertGreater(len(pdf.pages), 1)
        text = " ".join(page.extract_text() for page in pdf.pages)
        self.assertIn("Service line 064", text)
        for index, page in enumerate(pdf.pages, 1):
            self.assertIn(f"Page {index} of {len(pdf.pages)}", " ".join(page.extract_text().split()))
        for page in pdf.pages[1:-1]:
            self.assertIn("Description", page.extract_text())

    def test_organization_invoice_settings_save_and_remain_tenant_scoped(self):
        url = f"/api/platform/tenants/{self.tenant.pk}/settings/"
        response = self.client.patch(url, {"invoice_address": "New issuer address", "invoice_tax_number": "TAX-001", "invoice_website": "https://billing.example.test", "invoice_payment_instructions": "Bank details for this organization only"}, format="json")
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.invoice_address, "New issuer address")
        other = Tenant.objects.create(name="Other issuer", code="other-issuer-billing")
        other_settings = TenantSettings.objects.create(tenant=other)
        response = self.client.patch(f"/api/platform/tenants/{other.pk}/settings/", {"invoice_address": "Denied"}, format="json")
        self.assertIn(response.status_code, [403, 404])
        other_settings.refresh_from_db()
        self.assertEqual(other_settings.invoice_address, "")

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_issuing_uses_invoice_billing_email_instead_of_master_customer_email(self):
        from django.core import mail
        invoice = self.create_invoice(billing_email="billing-desk@example.test")
        response = self.client.post(f"/api/payments/invoices/{invoice.pk}/issue/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(mail.outbox[-1].to, ["billing-desk@example.test"])
