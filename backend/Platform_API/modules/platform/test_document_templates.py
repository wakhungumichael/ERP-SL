from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import DocumentTemplate, Tenant, TenantSettings, TenantUserProfile


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

    def test_template_library_is_seeded_for_tenant_admin(self):
        response = self.client.get(reverse("document-template-list"))
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.data
        results = payload.get("results", payload.get("data", payload))
        purchase_order_templates = [t for t in results if t.get("document_type") == "purchase_order"]
        invoice_templates = [t for t in results if t.get("document_type") == "invoice"]
        self.assertGreaterEqual(len(purchase_order_templates), 3)
        self.assertGreaterEqual(len(invoice_templates), 3)

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
