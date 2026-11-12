# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import DocumentTemplate, Tenant, TenantSettings, TenantUserProfile
from Platform_Core.template_library import ensure_shared_document_template_library


class TenantDocumentTemplateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Template Tenant", code="template-tenant", is_active=True, status="active")
        self.user = User.objects.create_user("tenantadmin", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.client.force_authenticate(self.user)

    def test_tenant_admin_can_create_document_template(self):
        response = self.client.post(
            reverse("document-template-list"),
            {
                "name": "Tenant Invoice Template",
                "document_type": "invoice",
                "engine": "html",
                "is_default": True,
                "body_template": "<h1>Invoice</h1>",
                "stylesheet": "h1{color:#000;}",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        template = DocumentTemplate.objects.get(pk=response.data["id"])
        self.assertEqual(template.tenant_id, self.tenant.id)

    def test_tenant_admin_can_assign_own_template_to_settings(self):
        template = DocumentTemplate.objects.create(
            tenant=self.tenant,
            name="Receipt Template",
            document_type="receipt",
            engine="html",
            body_template="<p>Receipt</p>",
        )
        settings_obj, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
        response = self.client.put(
            reverse("tenant-settings", kwargs={"pk": self.tenant.id}),
            {
                "primary_color": "#112233",
                "receipt_template_id": template.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        settings_obj.refresh_from_db()
        self.assertEqual(settings_obj.receipt_template_id, template.id)

    def test_tenant_admin_smtp_settings_persist_after_reload(self):
        response = self.client.put(
            reverse("tenant-settings", kwargs={"pk": self.tenant.id}),
            {
                "support_email": "receipts@template-tenant.example",
                "smtp_host": "mail.template-tenant.example",
                "smtp_port": 465,
                "smtp_user": "receipts@template-tenant.example",
                "smtp_password": "test-mailbox-password",
                "smtp_use_tls": False,
                "smtp_use_ssl": True,
                "smtp_allow_insecure_ssl": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        reloaded = self.client.get(
            reverse("tenant-settings", kwargs={"pk": self.tenant.id})
        )
        self.assertEqual(reloaded.status_code, 200, reloaded.data)
        settings_data = reloaded.data["data"]
        self.assertEqual(settings_data["support_email"], "receipts@template-tenant.example")
        self.assertEqual(settings_data["smtp_host"], "mail.template-tenant.example")
        self.assertEqual(settings_data["smtp_port"], 465)
        self.assertEqual(settings_data["smtp_user"], "receipts@template-tenant.example")
        self.assertTrue(settings_data["smtp_password_configured"])
        self.assertNotIn("smtp_password", settings_data)

    def test_template_library_is_seeded_for_tenant_admin(self):
        response = self.client.get(reverse("document-template-list"))
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.data
        results = payload.get("results", payload.get("data", payload))
        purchase_order_templates = [t for t in results if t.get("document_type") == "purchase_order"]
        invoice_templates = [t for t in results if t.get("document_type") == "invoice"]
        self.assertGreaterEqual(len(purchase_order_templates), 3)
        self.assertGreaterEqual(len(invoice_templates), 3)

    def test_duplicate_legacy_shared_template_does_not_break_settings(self):
        DocumentTemplate.objects.create(
            tenant=None,
            name="Invoice Modern",
            document_type="invoice",
            engine="html",
        )
        DocumentTemplate.objects.create(
            tenant=None,
            name="Invoice Modern",
            document_type="invoice",
            engine="html",
        )

        ensure_shared_document_template_library()
        response = self.client.get(reverse("tenant-settings", kwargs={"pk": self.tenant.id}))

        self.assertEqual(response.status_code, 200, response.data)

    def test_tenant_admin_can_preview_shared_template_with_tenant_branding(self):
        response = self.client.get(reverse("document-template-list"))
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.data
        results = payload.get("results", payload.get("data", payload))
        shared_invoice = next(t for t in results if t.get("document_type") == "invoice" and not t.get("tenant"))

        TenantSettings.objects.create(
            tenant=self.tenant,
            primary_color="#224466",
            footer_text="Tenant preview footer",
        )

        preview = self.client.get(reverse("document-template-preview", kwargs={"pk": shared_invoice["id"]}))
        self.assertEqual(preview.status_code, 200)
        html = preview.content.decode()
        self.assertIn("Template Tenant", html)
        self.assertIn("#224466", html)
        self.assertIn("Tenant preview footer", html)

    def test_tenant_admin_cannot_reassign_template_to_another_tenant(self):
        other_tenant = Tenant.objects.create(
            name="Other Template Tenant",
            code="other-template-tenant",
            is_active=True,
            status="active",
        )
        template = DocumentTemplate.objects.create(
            tenant=self.tenant,
            name="Tenant Owned Template",
            document_type="invoice",
            engine="html",
            body_template="<p>Owned</p>",
        )

        response = self.client.patch(
            reverse("document-template-detail", kwargs={"pk": template.id}),
            {"tenant_id": other_tenant.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        template.refresh_from_db()
        self.assertEqual(template.tenant_id, self.tenant.id)

    def test_each_document_has_five_styles_and_idempotent_library(self):
        from Platform_Core.template_library import DOCUMENTS, VARIANTS
        ensure_shared_document_template_library()
        self.assertEqual(ensure_shared_document_template_library(), 0)
        for kind, label in DOCUMENTS:
            with self.subTest(document=kind):
                layouts = DocumentTemplate.objects.filter(tenant=None, document_type=kind)
                self.assertEqual(layouts.count(), 5)
                self.assertEqual(layouts.filter(is_default=True).count(), 1)
                for key, title in VARIANTS:
                    layout = layouts.get(name=f"{label} {title}")
                    self.assertIn(f"style-{key}", layout.body_template)

    def test_selection_persists_per_document_and_is_used_by_shared_renderer(self):
        from Platform_Core.documents import DOCUMENT_SETTINGS_FIELD_MAP, render_business_document, resolve_document_template
        from Platform_Core.template_library import DOCUMENTS
        ensure_shared_document_template_library()
        url = reverse("tenant-settings", kwargs={"pk": self.tenant.id})
        for kind, label in DOCUMENTS:
            with self.subTest(document=kind):
                layout = DocumentTemplate.objects.get(tenant=None, name=f"{label} Executive")
                field = DOCUMENT_SETTINGS_FIELD_MAP[kind]
                response = self.client.put(url, {field + "_id": layout.id}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                reloaded = self.client.get(url).data["data"]
                self.assertEqual(reloaded[field]["id"], layout.id)
                selected, _ = resolve_document_template(tenant=self.tenant, document_type=kind)
                self.assertEqual(selected.pk, layout.pk)
                rendered = render_business_document(tenant=self.tenant, document_type=kind, context={"document": {"number": "CHOICE-001"}, "company": {"name": "Template Tenant"}, "branding": {"primary_color": "#224466"}})
                self.assertEqual(rendered.template.pk, layout.pk)
                self.assertIn("style-executive", rendered.html)
        # Changing only one selection must preserve the other modules' choices.
        modern = DocumentTemplate.objects.get(tenant=None, name="Invoice Modern")
        response = self.client.put(url, {"invoice_template_id": modern.id}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["estimate_template"]["name"], "Estimate Executive")
        self.assertEqual(response.data["data"]["report_template"]["name"], "Report Executive")
        response = self.client.put(url, {"invoice_template_id": None}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["data"]["invoice_template"])
        selected, _ = resolve_document_template(tenant=self.tenant, document_type="invoice")
        self.assertEqual(selected.name, "Invoice Classic")

    def test_invalid_inactive_and_foreign_layout_selections_are_rejected(self):
        other = Tenant.objects.create(name="Foreign Template", code="foreign-template")
        foreign = DocumentTemplate.objects.create(tenant=other, document_type="invoice", name="Private invoice")
        inactive = DocumentTemplate.objects.create(document_type="invoice", name="Inactive invoice", is_active=False)
        wrong_type = DocumentTemplate.objects.create(document_type="quotation", name="Wrong type")
        url = reverse("tenant-settings", kwargs={"pk": self.tenant.pk})
        for layout in [foreign, inactive, wrong_type]:
            with self.subTest(layout=layout.name):
                response = self.client.put(url, {"invoice_template_id": layout.pk}, format="json")
                self.assertEqual(response.status_code, 400, response.data)

    def test_existing_generated_layouts_upgrade_but_customized_templates_stay(self):
        from Platform_Core.invoice_templates import body, stylesheet
        old = DocumentTemplate.objects.create(name="Invoice Modern", document_type="invoice", body_template=body("modern"), stylesheet=stylesheet("modern"))
        custom = DocumentTemplate.objects.create(name="Estimate Modern", document_type="quotation", body_template="<h1>Custom shared estimate</h1>", stylesheet="h1 {color:red;}")
        ensure_shared_document_template_library()
        old.refresh_from_db()
        custom.refresh_from_db()
        self.assertIn("banner-heading", old.body_template)
        self.assertEqual(custom.body_template, "<h1>Custom shared estimate</h1>")
        self.assertEqual(custom.stylesheet, "h1 {color:red;}")

    def test_all_library_layouts_export_pdf_with_document_content(self):
        from io import BytesIO
        from pypdf import PdfReader
        from Platform_Core.document_pdf import document_pdf_bytes
        from Platform_Core.documents import render_document_template_preview
        ensure_shared_document_template_library()
        TenantSettings.objects.create(tenant=self.tenant, primary_color="#224466", footer_text="Template export footer", default_tax_name="VAT", default_tax_rate=16)
        for layout in DocumentTemplate.objects.filter(tenant=None):
            with self.subTest(layout=layout.name):
                rendered = render_document_template_preview(layout, tenant=self.tenant)
                self.assertNotIn("{{", rendered.html)
                pdf = PdfReader(BytesIO(document_pdf_bytes(rendered.html)))
                self.assertEqual(len(pdf.pages), 1, "Short sample should not spill onto an extra page")
                text = " ".join(" ".join(page.extract_text() for page in pdf.pages).split())
                self.assertIn("Template Tenant", text)
                self.assertIn("Template export footer", text)
                if layout.document_type == "report":
                    self.assertIn("RPT-PREVIEW-001", text)
                    self.assertIn("Net Weight", text)
                elif layout.document_type == "receipt":
                    self.assertIn("RCT-PREVIEW-001", text)
                    self.assertIn("KES 1,800.00", text)
                elif layout.document_type == "statement":
                    self.assertIn("INV-PREVIEW-001", text)
                    self.assertIn("Aging Summary", text)
                    self.assertIn("KES 13,920.00", text)
                else:
                    self.assertIn("Premium service subscription", text)
                    self.assertIn("KES 13,920.00", text)


class SharedInvoiceLayoutUpgradeTests(SimpleTestCase):
    def test_previous_invoice_print_layouts_receive_distinct_styles(self):
        from unittest.mock import patch
        from Platform_Core.invoice_templates import previous_print_layout
        from Platform_Core.template_library import upgrade_shared_template
        for key, title in [("classic", "Classic"), ("modern", "Modern"), ("compact", "Compact")]:
            with self.subTest(layout=title):
                body, css = previous_print_layout(key)
                layout = DocumentTemplate(name=f"Invoice {title}", document_type="invoice", body_template=body, stylesheet=css)
                with patch.object(layout, "save") as save:
                    upgrade_shared_template(layout)
                self.assertIn(f"style-{key}", layout.body_template)
                save.assert_called_once()

    def test_modified_previous_layout_is_preserved(self):
        from unittest.mock import patch
        from Platform_Core.invoice_templates import previous_print_layout
        from Platform_Core.template_library import upgrade_shared_template
        body, css = previous_print_layout("modern")
        body += "<p>Customer-specific billing terms</p>"
        layout = DocumentTemplate(name="Invoice Modern", document_type="invoice", body_template=body, stylesheet=css)
        with patch.object(layout, "save") as save:
            upgrade_shared_template(layout)
        self.assertEqual(layout.body_template, body)
        save.assert_not_called()
