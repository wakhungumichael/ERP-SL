from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import IntegrationEndpoint, Tenant, TenantUserProfile


class IntegrationTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = Tenant.objects.create(
            name="Integration Tenant A",
            code="integration-a",
            is_active=True,
            status="active",
        )
        self.tenant_b = Tenant.objects.create(
            name="Integration Tenant B",
            code="integration-b",
            is_active=True,
            status="active",
        )
        self.user_a = User.objects.create_user("integration_admin_a", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user_a, tenant=self.tenant_a, is_tenant_admin=True)
        self.client.force_authenticate(self.user_a)

        self.endpoint_a = IntegrationEndpoint.objects.create(
            tenant=self.tenant_a,
            name="Tenant A Gateway",
            integration_type="payment",
            transport="http",
            provider="mpesa",
            base_url="https://tenant-a.example/api",
            connection_settings={"payment_scope": "tenant_operations"},
        )

    def test_tenant_admin_cannot_create_integration_for_other_tenant(self):
        response = self.client.post(
            reverse("integration-list"),
            {
                "tenant_id": self.tenant_b.id,
                "name": "Cross Tenant Gateway",
                "integration_type": "payment",
                "transport": "http",
                "provider": "mpesa",
                "base_url": "https://tenant-b.example/api",
                "connection_settings": {"payment_scope": "tenant_operations"},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)

    def test_tenant_admin_cannot_reassign_integration_to_other_tenant(self):
        response = self.client.patch(
            reverse("integration-detail", kwargs={"pk": self.endpoint_a.id}),
            {"tenant_id": self.tenant_b.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.endpoint_a.refresh_from_db()
        self.assertEqual(self.endpoint_a.tenant_id, self.tenant_a.id)
