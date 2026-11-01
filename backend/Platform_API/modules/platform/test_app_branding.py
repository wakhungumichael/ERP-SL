"""Regression tests for public PWA identity, icon updates and organization isolation."""
from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from Platform_Core.models import PlatformBrandingSettings, Tenant, TenantSettings


class AppBrandingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tenant_a = Tenant.objects.create(name="Alpha Company", code="app-alpha", is_active=True)
        cls.tenant_b = Tenant.objects.create(name="Beta Company", code="app-beta", is_active=True)
        cls.profile_a = TenantSettings.objects.create(tenant=cls.tenant_a, workspace_name="Alpha Workspace", primary_color="#AA1111")
        cls.profile_b = TenantSettings.objects.create(tenant=cls.tenant_b, workspace_name="Beta Workspace", primary_color="#2222BB")
        PlatformBrandingSettings.objects.update_or_create(pk=1, defaults={"platform_name": "ERP Platform"})

    def setUp(self):
        self.client = APIClient()
        self.manifest_url = reverse("platform-public-manifest")
        self.icon_url = reverse("platform-public-app-icon")
        self.media = TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)

    def upload_logo(self, profile, color):
        output = BytesIO()
        Image.new("RGB", (120, 60), color).save(output, format="PNG")
        profile.logo_file = SimpleUploadedFile("logo.png", output.getvalue(), content_type="image/png")
        profile.save()

    def test_same_manifest_follows_company_cookie_with_stable_app_identity(self):
        self.client.cookies["sl-erp-app-tenant"] = self.tenant_a.code
        alpha = self.client.get(self.manifest_url)
        self.client.cookies["sl-erp-app-tenant"] = self.tenant_b.code
        beta = self.client.get(self.manifest_url)
        self.assertEqual(alpha.json()["name"], "Alpha Workspace")
        self.assertEqual(beta.json()["name"], "Beta Workspace")
        for key in ("id", "scope", "start_url"):
            self.assertEqual(alpha.json()[key], "/")
            self.assertEqual(beta.json()[key], "/")
        self.assertNotEqual(alpha.json()["icons"][0]["src"], beta.json()["icons"][0]["src"])
        self.assertIn("no-store", beta["Cache-Control"])
        self.assertIn("Cookie", beta["Vary"])

    def test_explicit_icon_company_is_not_overridden_by_another_company_cookie(self):
        self.upload_logo(self.profile_a, "red")
        self.client.cookies["sl-erp-app-tenant"] = self.tenant_a.code
        source = self.client.get(self.manifest_url).json()["icons"][0]["src"]
        self.client.cookies["sl-erp-app-tenant"] = self.tenant_b.code
        response = self.client.get(source)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        with Image.open(BytesIO(response.content)) as image:
            self.assertEqual(image.size, (192, 192))
            self.assertEqual(image.getpixel((96, 96)), (255, 0, 0))
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_manifest_provides_raster_icons_in_actual_advertised_sizes(self):
        self.upload_logo(self.profile_a, "green")
        response = self.client.get(self.manifest_url, {"tenant_code": self.tenant_a.code})
        for entry, size in zip(response.json()["icons"], (192, 512)):
            self.assertEqual(entry["sizes"], f"{size}x{size}")
            self.assertEqual(entry["type"], "image/png")
            with Image.open(BytesIO(self.client.get(entry["src"]).content)) as image:
                self.assertEqual(image.size, (size, size))

    def test_icon_url_changes_when_logo_changes(self):
        self.upload_logo(self.profile_a, "red")
        previous = self.client.get(self.manifest_url, {"tenant_code": self.tenant_a.code}).json()["icons"]
        self.upload_logo(self.profile_a, "blue")
        current = self.client.get(self.manifest_url, {"tenant_code": self.tenant_a.code}).json()["icons"]
        self.assertNotEqual(previous, current)

    def test_platform_selection_clears_old_company_and_stale_cookie_falls_back_safely(self):
        self.client.cookies["sl-erp-app-tenant"] = self.tenant_a.code
        platform = self.client.get(self.manifest_url, {"tenant_code": ""})
        self.assertEqual(platform.json()["name"], "ERP Platform")
        self.assertIn("tenant_code=&", platform.json()["icons"][0]["src"])
        self.client.cookies["sl-erp-app-tenant"] = "deleted-company"
        self.assertEqual(self.client.get(self.manifest_url).json()["name"], "ERP Platform")
        self.assertEqual(self.client.get(self.manifest_url, {"tenant_code": "deleted-company"}).status_code, 404)

    def test_branding_cookie_does_not_grant_private_company_access(self):
        self.client.cookies["sl-erp-app-tenant"] = self.tenant_b.code
        response = self.client.get(reverse("tenant-settings", args=[self.tenant_b.pk]))
        self.assertIn(response.status_code, (401, 403))

    def test_unsupported_icon_sizes_are_rejected_and_missing_logo_has_png_fallback(self):
        for size in ("invalid", "0", "8192"):
            self.assertEqual(self.client.get(self.icon_url, {"size": size}).status_code, 400)
        response = self.client.get(self.icon_url, {"tenant_code": self.tenant_b.code, "size": "180"})
        with Image.open(BytesIO(response.content)) as image:
            self.assertEqual(image.size, (180, 180))

    def test_remote_logo_is_referenced_without_server_side_network_fetch(self):
        self.profile_a.logo_url = "https://images.example.test/company.png"
        self.profile_a.save()
        response = self.client.get(self.manifest_url, {"tenant_code": self.tenant_a.code})
        self.assertEqual(response.json()["icons"][0]["src"], self.profile_a.logo_url)
        self.assertEqual(response.json()["icons"][0]["type"], "image/png")

    def test_missing_logo_works_with_legacy_pillow_default_font(self):
        from unittest.mock import patch
        from PIL import ImageFont
        font = ImageFont.load_default()
        # Pillow 9 accepts no keyword arguments here. Keep this regression
        # check meaningful when the local environment uses a newer Pillow.
        with patch('Platform_Core.pwa.ImageFont.load_default', lambda: font):
            response = self.client.get(self.icon_url, {'tenant_code': self.tenant_b.code, 'size': '192'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/png')
        self.assertTrue(response.content.startswith(b'\x89PNG'))
