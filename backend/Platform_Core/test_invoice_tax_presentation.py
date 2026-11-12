"""Invoice PDFs retain entered prices and explicitly reconcile net, tax and gross."""
from decimal import Decimal
from io import BytesIO
import os
from pathlib import Path
from random import Random

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from pypdf import PdfReader
from rest_framework.test import APIClient

from Platform_Core.document_pdf import document_pdf_bytes
from Platform_Core.documents import _invoice_context, render_document_template_preview, render_invoice_document
from Platform_Core.models import DocumentTemplate, Tenant, TenantSettings, TenantUserProfile
from Platform_Core.template_library import ensure_shared_document_template_library
from SL_Sales.models import OrganisationCharge
from SL_Weighbridge.invoice_presentation import invoice_line_breakdown
from SL_Weighbridge.models import Customer, Invoice, InvoiceLine


class InvoicePresentationRoundingTests(SimpleTestCase):
    def test_fractional_lines_keep_the_same_gross_pennies_as_the_saved_screen(self):
        rows = invoice_line_breakdown([
            {"quantity": Decimal(".001"), "entered_unit_price": Decimal("1004.90"), "total": Decimal("0")},
            {"quantity": Decimal(".001"), "entered_unit_price": Decimal("100004.80"), "total": Decimal("0")},
        ], Decimal("87.08"), Decimal("13.93"), inclusive=True, combined=True)
        self.assertEqual([row["gross"] for row in rows], [Decimal("1.01"), Decimal("100.00")])
        self.assertEqual(sum(row["net"] for row in rows), Decimal("87.08"))
        self.assertEqual(sum(row["tax"] for row in rows), Decimal("13.93"))

    def test_inclusive_columns_balance_and_never_show_negative_tax(self):
        random = Random(42)
        for _ in range(250):
            lines = [{
                "quantity": Decimal(random.randrange(1, 5000)) / 1000,
                "entered_unit_price": Decimal(random.randrange(100000)) / 100,
                "total": Decimal("0"),
            } for _ in range(random.randrange(1, 20))]
            rate = Decimal(random.choice(["0", "7.5", "16", "20", "25"]))
            gross = sum((line["quantity"] * line["entered_unit_price"] for line in lines), Decimal("0")).quantize(Decimal(".01"))
            subtotal = (gross / (1 + rate / 100)).quantize(Decimal(".01"))
            tax = gross - subtotal
            rows = invoice_line_breakdown(lines, subtotal, tax, inclusive=True, combined=True)
            self.assertEqual(sum(row["net"] for row in rows), subtotal)
            self.assertEqual(sum(row["tax"] for row in rows), tax)
            self.assertEqual(sum(row["gross"] for row in rows), gross)
            for row in rows:
                self.assertGreaterEqual(row["tax"], 0)
                self.assertEqual(row["net"] + row["tax"], row["gross"])


class InvoiceTaxPresentationTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Example Software Services Limited", code="invoice-pdf-tax", status="active", contact_email="billing@example.test", contact_phone="+254700000000")
        self.settings, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
        self.settings.default_tax_name = "VAT"
        self.settings.default_tax_rate = 16
        self.settings.primary_color = "#2563eb"
        self.settings.invoice_address = "Example Business Centre\nP.O. Box 100, Nairobi, Kenya"
        self.settings.invoice_tax_number = "EXAMPLE-TAX-ID"
        self.settings.invoice_payment_instructions = "Pay using the agreed bank or mobile payment details."
        self.settings.save()
        self.user = User.objects.create_user("invoice-pdf-admin", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Example Client Organization", address="Client House\nP.O. Box 200, Nairobi, Kenya", phone_number="+254711111111", email="finance@example.test")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        ensure_shared_document_template_library()

    def create_invoice(self, **overrides):
        response = self.client.post(reverse("invoice-list"), {
            "customer_id": self.customer.pk, "invoice_date": "2026-10-30",
            "tax_mode": "combined", "combined_tax_rate": 16, "prices_include_tax": True,
            "billing_contact_name": "Finance Office", "customer_reference": "CONTRACT-EXAMPLE",
            "line_items": [
                {"description": "Inception meeting, stakeholder engagement, mobilization, support arrangements, 12-month work plan and governance framework.", "qty": 1, "unit_price": "737500"},
                {"description": "System baseline assessment and integration review, quarterly support, updated issue matrix and risk/action register.", "qty": 1, "unit_price": "590000"},
            ], **overrides,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Invoice.objects.get(pk=response.data["id"])

    def render(self, invoice, title="Classic", sample_name=None):
        self.settings.invoice_template = DocumentTemplate.objects.get(tenant=None, name="Invoice " + title)
        self.settings.save()
        invoice.tenant = Tenant.objects.get(pk=self.tenant.pk)
        rendered = render_invoice_document(invoice)
        data = document_pdf_bytes(rendered.html)
        reader = PdfReader(BytesIO(data))
        text = " ".join(" ".join(page.extract_text().split()) for page in reader.pages)
        if sample_name and os.environ.get("INVOICE_PDF_QA_DIR"):
            destination = Path(os.environ["INVOICE_PDF_QA_DIR"])
            destination.mkdir(parents=True, exist_ok=True)
            (destination / sample_name).write_bytes(data)
            (destination / sample_name).with_suffix(".html").write_text(rendered.html)
        return reader, text, rendered

    def test_inclusive_entered_prices_and_each_tax_column_balance_without_data_changes(self):
        invoice = self.create_invoice()
        stored = list(invoice.lines.values("id", "unit_price", "total_amount", "tax_amount"))
        context = _invoice_context(invoice, self.settings)
        self.assertEqual([line["entered_unit_price"] for line in context["lines"]], [Decimal("737500"), Decimal("590000")])
        self.assertEqual([line["net_amount"] for line in context["lines"]], [Decimal("635775.86"), Decimal("508620.69")])
        self.assertEqual([line["line_tax"] for line in context["lines"]], [Decimal("101724.14"), Decimal("81379.31")])
        self.assertEqual([line["gross_amount"] for line in context["lines"]], [Decimal("737500"), Decimal("590000")])
        self.assertEqual(context["totals"]["items_subtotal"], Decimal("1327500"))
        self.assertEqual(context["totals"]["subtotal"], Decimal("1144396.55"))
        self.assertEqual(context["totals"]["tax"], Decimal("183103.45"))
        self.assertEqual(context["totals"]["total"], Decimal("1327500"))
        self.assertEqual(context["tax_summary"][0]["gross"], Decimal("1327500"))
        self.assertEqual(stored, list(invoice.lines.values("id", "unit_price", "total_amount", "tax_amount")))

    def test_exclusive_subtotal_adds_tax(self):
        invoice = self.create_invoice(prices_include_tax=False, line_items=[
            {"description": "A", "qty": 1, "unit_price": 100},
            {"description": "B", "qty": 1, "unit_price": 200},
        ])
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["document"]["unit_price_basis"], "excl. tax")
        self.assertEqual(context["totals"]["items_subtotal"], Decimal("300"))
        self.assertEqual(context["totals"]["tax"], Decimal("48"))
        self.assertEqual([line["gross_amount"] for line in context["lines"]], [Decimal("116"), Decimal("232")])
        self.assertEqual(context["totals"]["total"], Decimal("348"))
        reader, text, _ = self.render(invoice, sample_name="invoice-exclusive.pdf")
        self.assertEqual(len(reader.pages), 1)
        self.assertIn("Subtotal (excl. tax)", text)
        self.assertIn("KES 348.00", text)

    def test_mixed_per_line_rates_are_summarized_separately(self):
        invoice = self.create_invoice(prices_include_tax=False, tax_mode="per_line", line_items=[
            {"description": "Taxable", "qty": 1, "unit_price": 40, "tax_rate": 16},
            {"description": "Zero rate", "qty": 1, "unit_price": 60, "tax_rate": 0},
        ])
        context = _invoice_context(invoice, self.settings)
        groups = {group["label"]: group for group in context["tax_summary"]}
        self.assertEqual(groups["VAT (16%)"]["net"], Decimal("40"))
        self.assertEqual(groups["VAT (16%)"]["tax"], Decimal("6.40"))
        self.assertEqual(groups["VAT (0%)"]["net"], Decimal("60"))
        self.assertEqual(groups["VAT (0%)"]["tax"], 0)
        self.assertEqual(sum(group["gross"] for group in groups.values()), invoice.total_amount)

    def test_fractional_net_subtotal_does_not_fabricate_tax(self):
        invoice = self.create_invoice(prices_include_tax=False, tax_mode="per_line", line_items=[
            {"description": str(i), "qty": ".333", "unit_price": ".01", "tax_rate": 0} for i in range(2)
        ])
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["totals"]["subtotal"], Decimal(".01"))
        self.assertEqual(context["totals"]["tax"], 0)
        self.assertEqual(sum(line["net_amount"] for line in context["lines"]), Decimal(".01"))
        self.assertEqual(sum(line["line_tax"] for line in context["lines"]), 0)

    def test_legacy_invoice_without_subtotal_retains_its_line_and_tax_totals(self):
        invoice = Invoice.objects.create(tenant=self.tenant, customer=self.customer, total_amount=116)
        InvoiceLine.objects.create(invoice=invoice, description="Legacy service", quantity=1, unit_price=100, total_amount=100)
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["totals"]["subtotal"], Decimal("100"))
        self.assertEqual(context["totals"]["tax"], Decimal("16"))
        self.assertEqual(context["lines"][0]["gross_amount"], Decimal("116"))
        self.assertNotIn("(0%)", context["tax_summary"][0]["label"])

    def test_additional_charges_remain_separate_from_item_tax_totals(self):
        charge = OrganisationCharge.objects.create(tenant=self.tenant, name="Delivery", calculation_type="fixed", rate=50)
        invoice = self.create_invoice(charge_ids=[charge.pk], line_items=[{"description": "Service", "qty": 1, "unit_price": 1160}])
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["totals"]["items_subtotal"], Decimal("1160"))
        self.assertEqual(context["tax_summary"][0]["gross"], Decimal("1160"))
        self.assertEqual(context["totals"]["total"], Decimal("1210"))
        self.assertEqual(context["charges"][0]["amount_display"], "KES 50.00")

    def test_every_shared_variant_renders_tax_columns_and_original_prices(self):
        invoice = self.create_invoice()
        for title in ["Classic", "Modern", "Compact", "Executive", "Minimal"]:
            with self.subTest(title=title):
                sample = "invoice-inclusive-" + title.lower() + ".pdf" if title in {"Classic", "Modern", "Compact"} else None
                reader, text, _ = self.render(invoice, title, sample)
                self.assertEqual(len(reader.pages), 1)
                for expected in ["Unit price", "incl. tax", "Amount excl. tax", "Tax amount", "Tax summary", "VAT (16%)", "KES 737,500.00", "KES 590,000.00", "KES 635,775.86", "KES 101,724.14", "KES 508,620.69", "KES 81,379.31", "Subtotal (incl. tax)", "KES 1,144,396.55", "KES 183,103.45", "KES 1,327,500.00"]:
                    self.assertIn(expected, text, title)
                self.assertNotIn("Prepared by:", text)

    def test_branded_invoice_with_bank_notes_keeps_totals_on_first_page(self):
        import base64
        from unittest.mock import patch
        from PIL import Image

        image = BytesIO()
        Image.new("RGB", (180, 60), "#2563eb").save(image, format="PNG")
        logo = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
        invoice = self.create_invoice(notes="\n".join([
            "Bank Name: Example Bank Limited",
            "Branch: Business Centre Branch",
            "Bank Code: 000",
            "Branch Code: 001",
            "Swift Code: EXAMPLE",
            "KES Account Number: EXAMPLE-0001",
            "Payment reference: contract and invoice number",
        ]))
        self.settings.invoice_payment_instructions = ""
        self.settings.save()
        for title in ["Classic", "Modern", "Compact", "Executive", "Minimal"]:
            with self.subTest(title=title), patch("Platform_Core.documents._safe_logo_url", return_value=logo):
                sample = "invoice-branded-bank-notes.pdf" if title == "Executive" else None
                reader, text, _ = self.render(invoice, title, sample)
                first_page = " ".join(reader.pages[0].extract_text().split())
                self.assertIn("Invoice total", first_page)
                self.assertIn("KES 1,327,500.00", first_page)
                self.assertIn("EXAMPLE-0001", text)
                if title == "Executive":
                    self.assertEqual(len(reader.pages), 1, "The reported short Executive invoice should fit one page.")
                self.assertIn("Document reference", text)
                for page in reader.pages:
                    self.assertTrue(page.extract_text().strip())

    def test_zero_rate_keeps_prices_and_total_without_deducting_tax(self):
        invoice = self.create_invoice(combined_tax_rate=0, line_items=[{"description": "Zero-rated example", "qty": 1, "unit_price": 737500}])
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["lines"][0]["net_amount"], Decimal("737500"))
        self.assertEqual(context["lines"][0]["gross_amount"], Decimal("737500"))
        self.assertEqual(context["lines"][0]["line_tax"], 0)
        reader, text, _ = self.render(invoice, sample_name="invoice-zero-rate.pdf")
        self.assertEqual(len(reader.pages), 1)
        self.assertIn("VAT (0%)", text)
        self.assertIn("KES 0.00", text)
        self.assertIn("KES 737,500.00", text)

    def test_exact_previous_shared_templates_upgrade_and_customer_edits_remain(self):
        from Platform_Core.document_styles import apply_layout, stylesheet as overrides
        from Platform_Core.invoice_templates_v1 import body, stylesheet, alignment_stylesheet
        for variant, title in [("classic", "Classic"), ("modern", "Modern"), ("compact", "Compact"), ("executive", "Executive"), ("minimal", "Minimal")]:
            template = DocumentTemplate.objects.get(tenant=None, name="Invoice " + title)
            old_body = apply_layout(body(variant), variant).replace('<table class="heading', f'<table cellpadding="{6 if variant == "compact" else 12}" class="heading')
            old_css = stylesheet(variant) + overrides(variant) + alignment_stylesheet()
            template.body_template, template.stylesheet = old_body, old_css
            template.save()
            ensure_shared_document_template_library()
            template.refresh_from_db()
            self.assertIn("line.net_amount_display", template.body_template)
            self.assertIn("tax_summary", template.body_template)
            template.body_template = old_body + "<!-- customer customization -->"
            template.stylesheet = old_css
            template.save()
            ensure_shared_document_template_library()
            template.refresh_from_db()
            self.assertEqual(template.body_template, old_body + "<!-- customer customization -->")
        private = DocumentTemplate.objects.create(tenant=self.tenant, name="Private invoice", document_type="invoice", body_template=old_body, stylesheet=old_css)
        from Platform_Core.template_library import upgrade_shared_template
        upgrade_shared_template(private)
        private.refresh_from_db()
        self.assertEqual(private.body_template, old_body)

    def test_invoice_gallery_preview_uses_configured_tax_name_rate_and_currency(self):
        self.tenant.default_currency = "USD"
        self.tenant.save()
        self.settings.default_tax_name = "Configured tax"
        self.settings.default_tax_rate = Decimal("7.5")
        self.settings.save()
        self.tenant = Tenant.objects.get(pk=self.tenant.pk)
        template = DocumentTemplate.objects.get(tenant=None, name="Invoice Classic")
        rendered = render_document_template_preview(template, tenant=self.tenant)
        text = " ".join(PdfReader(BytesIO(document_pdf_bytes(rendered.html))).pages[0].extract_text().split())
        for expected in ["Configured tax (7.5%)", "USD 900.00", "USD 12,900.00", "USD 4,500.00", "USD 675.00"]:
            self.assertIn(expected, text)
