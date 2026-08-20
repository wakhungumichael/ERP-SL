from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant


class TenantOffboardingGuardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.superuser = User.objects.create_superuser(
            username="tenant_guard_superuser",
            email="tenant-guard@example.com",
            password="pass",
        )
        self.client.force_authenticate(self.superuser)
        self.tenant = Tenant.objects.create(
            name="Guarded Tenant",
            code="guarded-tenant",
            is_active=True,
            status="active",
        )

    def test_tenant_delete_is_blocked_until_offboarding_exists(self):
        response = self.client.delete(reverse("tenant-detail", kwargs={"pk": self.tenant.id}))

        self.assertEqual(response.status_code, 405, response.data)
        self.tenant.refresh_from_db()
        self.assertTrue(Tenant.objects.filter(pk=self.tenant.id).exists())

    def test_suspend_tenant_remains_supported(self):
        response = self.client.post(reverse("tenant-suspend", kwargs={"pk": self.tenant.id}))

        self.assertEqual(response.status_code, 200, response.data)
        self.tenant.refresh_from_db()
        self.assertFalse(self.tenant.is_active)
        self.assertEqual(self.tenant.status, "suspended")
