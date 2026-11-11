from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from Platform_API.modules.shared_serializers import TenantSerializer
from Platform_Core.documents import render_business_document
from Platform_Core.models import DocumentTemplate, OrganizationMembership, Tenant, TenantSettings
from Platform_Core.template_library import DOCUMENTS, VARIANTS, _body, _stylesheet, ensure_shared_document_template_library


class OrganizationContactDetailsTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Contact Company", code="contact-company")
        self.foreign = Tenant.objects.create(name="Other Company", code="other-contact-company")
        self.user = User.objects.create_user("contact-admin")
        OrganizationMembership.objects.create(user=self.user, tenant=self.tenant, is_default=True, is_org_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.details = {"postal_address": "Westlands Office Park\nP.O. Box 12345 - 00100, Nairobi, Kenya", "website": "https://contact.example.com", "tax_number": "P012345678X"}

    def test_profile_save_and_settings_share_one_source_without_changing_other_settings(self):
        TenantSettings.objects.create(tenant=self.tenant, invoice_address="Old address", invoice_prefix="PC", smtp_host="mail.example.com")
        response = self.client.patch("/api/platform/tenants/self/", {"name": "Updated Company", **self.details}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        for key, value in self.details.items():
            self.assertEqual(response.data["data"][key], value)
        saved = TenantSettings.objects.get(tenant=self.tenant)
        self.assertEqual(saved.invoice_address, self.details["postal_address"])
        self.assertEqual(saved.invoice_website, self.details["website"])
        self.assertEqual(saved.invoice_tax_number, self.details["tax_number"])
        self.assertEqual(saved.invoice_prefix, "PC")
        self.assertEqual(saved.smtp_host, "mail.example.com")
        self.assertFalse(TenantSettings.objects.filter(tenant=self.foreign).exists())
        response = self.client.put(f"/api/platform/tenants/{self.tenant.pk}/settings/", {"invoice_address": "New invoice address", "invoice_website": "https://new.example.com"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        profile = self.client.get("/api/platform/tenants/self/").data["data"]
        self.assertEqual(profile["postal_address"], "New invoice address")
        self.assertEqual(profile["website"], "https://new.example.com")

    def test_blank_optional_fields_and_existing_profiles_without_settings(self):
        profile = self.client.get("/api/platform/tenants/self/").data["data"]
        self.assertEqual(profile["postal_address"], "")
        self.assertEqual(profile["website"], "")
        self.client.patch("/api/platform/tenants/self/", self.details, format="json")
        response = self.client.patch("/api/platform/tenants/self/", {key: "" for key in self.details}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["website"], "")
        self.assertEqual(TenantSettings.objects.get(tenant=self.tenant).invoice_address, "")

    def test_creating_profile_accepts_issuer_details_and_unrelated_updates_preserve_them(self):
        serializer = TenantSerializer(data={"name": "New Organization", **self.details})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        tenant = serializer.save()
        self.assertEqual(tenant.settings.invoice_website, self.details["website"])
        for partial in (True, False):
            serializer = TenantSerializer(tenant, data={"name": "Renamed Organization"}, partial=partial)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            serializer.save()
            tenant.refresh_from_db()
            self.assertEqual(tenant.settings.invoice_address, self.details["postal_address"])
            self.assertEqual(tenant.settings.invoice_website, self.details["website"])

    def test_invalid_website_rejects_entire_profile_save(self):
        response = self.client.patch("/api/platform/tenants/self/", {"name": "Should not save", "website": "not a website"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.name, "Contact Company")
        self.assertFalse(TenantSettings.objects.filter(tenant=self.tenant).exists())

    def test_member_cannot_change_profile_and_issuer_details(self):
        OrganizationMembership.objects.filter(user=self.user).update(is_org_admin=False)
        response = self.client.patch("/api/platform/tenants/self/", self.details, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(TenantSettings.objects.filter(tenant=self.tenant).exists())

    def test_profile_and_issuer_updates_are_atomic(self):
        serializer = TenantSerializer(self.tenant, data={"name": "Must roll back", **self.details}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        with patch.object(TenantSettings.objects, "update_or_create", side_effect=IntegrityError("Simulated settings failure")):
            with self.assertRaises(IntegrityError):
                serializer.save()
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.name, "Contact Company")

    def test_previous_standard_templates_upgrade_but_custom_edits_are_preserved(self):
        originals = []
        for kind, label in DOCUMENTS:
            for variant, title in VARIANTS:
                originals.append(DocumentTemplate.objects.create(name=f"{label} {title}", document_type=kind, body_template=_body(label, variant, include_contact_details=False), stylesheet=_stylesheet(variant, kind)))
        custom = DocumentTemplate.objects.create(tenant=self.tenant, name="Our quotation", document_type="quotation", body_template="<p>Our own letterhead</p>")
        ensure_shared_document_template_library()
        for original in originals:
            original.refresh_from_db()
            self.assertIn("company.website", original.body_template)
            self.assertIn("company.address", original.body_template)
        custom.refresh_from_db()
        self.assertEqual(custom.body_template, "<p>Our own letterhead</p>")

    def test_all_standard_business_headers_use_the_organization_details(self):
        TenantSettings.objects.create(tenant=self.tenant, invoice_address=self.details["postal_address"], invoice_website=self.details["website"], invoice_tax_number=self.details["tax_number"])
        ensure_shared_document_template_library()
        for kind, label in DOCUMENTS:
            with self.subTest(document_type=kind):
                rendered = render_business_document(tenant=self.tenant, document_type=kind, context={"company": {"name": self.tenant.name}, "document": {"number": "DEMO-001"}, "branding": {}, "lines": [], "totals": {}, "report": {"columns": [], "display_rows": []}})
                for value in ["Westlands Office Park", "P.O. Box 12345", self.details["website"], self.details["tax_number"]]:
                    self.assertIn(value, rendered.html)
                self.assertIn("<br", rendered.html)
