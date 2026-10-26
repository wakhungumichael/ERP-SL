# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import PlatformBrandingSettings, Tenant, TenantSettings, TenantUserProfile


class PlatformBrandingIsolationTests(TestCase):
    def setUp(self):
        self.superadmin = User.objects.create_superuser("branding-admin", "admin@example.test", "pass")
        self.superadmin_client = APIClient()
        self.superadmin_client.force_authenticate(self.superadmin)
        self.tenant_a = Tenant.objects.create(name="Tenant A", code="tenant-a", is_active=True)
        self.tenant_b = Tenant.objects.create(name="Tenant B", code="tenant-b", is_active=True)
        TenantSettings.objects.create(tenant=self.tenant_a, workspace_name="Tenant A Workspace", primary_color="#AA1111")
        TenantSettings.objects.create(tenant=self.tenant_b, workspace_name="Tenant B Workspace", primary_color="#2222BB")
        self.platform_url = reverse("platform-branding-settings")
        self.public_url = reverse("platform-public-site")

    def test_saas_public_site_uses_platform_profile_not_a_tenant(self):
        response = self.superadmin_client.put(
            self.platform_url,
            {"branding_mode": "saas", "platform_name": "SL ERP Cloud", "primary_color": "#009966"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        public = APIClient().get(self.public_url)
        self.assertEqual(public.status_code, 200, public.data)
        self.assertEqual(public.data["data"]["site_scope"], "platform")
        self.assertEqual(public.data["data"]["branding"]["primary_color"], "#009966")

        tenant_public = APIClient().get(self.public_url, {"tenant_code": self.tenant_a.code})
        self.assertEqual(tenant_public.status_code, 200, tenant_public.data)
        self.assertEqual(tenant_public.data["data"]["site_scope"], "tenant")
        self.assertEqual(tenant_public.data["data"]["branding"]["primary_color"], "#AA1111")

    def test_dedicated_mode_uses_the_selected_tenant_brand(self):
        response = self.superadmin_client.put(
            self.platform_url,
            {"branding_mode": "dedicated", "dedicated_tenant": self.tenant_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        public = APIClient().get(self.public_url)
        self.assertEqual(public.status_code, 200, public.data)
        self.assertEqual(public.data["data"]["site_scope"], "dedicated")
        self.assertEqual(public.data["data"]["branding"]["primary_color"], "#2222BB")

    def test_tenant_user_cannot_change_platform_branding(self):
        tenant_user = User.objects.create_user("tenant-branding-user", "tenant@example.test", "pass")
        client = APIClient()
        client.force_authenticate(tenant_user)
        response = client.put(self.platform_url, {"platform_name": "Attempted takeover"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(PlatformBrandingSettings.objects.filter(platform_name="Attempted takeover").exists())


class TenantThemeTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Theme tenant", code="theme-tenant")
        self.admin = User.objects.create_user("theme-admin")
        TenantUserProfile.objects.create(user=self.admin, tenant=self.tenant, is_tenant_admin=True)
        self.member = User.objects.create_user("theme-member")
        TenantUserProfile.objects.create(user=self.member, tenant=self.tenant)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = reverse("tenant-settings", args=[self.tenant.pk])

    def test_palette_persists_and_is_available_to_workspace_members(self):
        palette = {"primary_color": "#000000", "secondary_color": "#ffffff", "accent_color": "#00ff00", "sidebar_color": "#123456"}
        response = self.client.put(self.url, palette, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.client.force_authenticate(self.member)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        for field, value in palette.items():
            self.assertEqual(response.data["data"][field], value)
            self.assertEqual(getattr(TenantSettings.objects.get(tenant=self.tenant), field), value)
        self.assertNotIn("smtp_password", response.data["data"])
        denied = self.client.put(self.url, {"primary_color": "#ffffff"}, format="json")
        self.assertEqual(denied.status_code, 403)

    def test_invalid_colors_are_rejected(self):
        for field in ("primary_color", "secondary_color", "accent_color", "sidebar_color"):
            with self.subTest(field=field):
                response = self.client.put(self.url, {field: "not-a-color"}, format="json")
                self.assertEqual(response.status_code, 400, response.data)

    def test_optional_colors_can_be_reset(self):
        response = self.client.put(self.url, {"secondary_color": "#fff"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.put(self.url, {"secondary_color": "", "accent_color": "", "sidebar_color": ""}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TenantSettings.objects.get(tenant=self.tenant).secondary_color, "")
