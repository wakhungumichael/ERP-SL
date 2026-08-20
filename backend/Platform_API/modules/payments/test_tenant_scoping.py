from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Weighbridge.models import Customer


class PaymentTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = Tenant.objects.create(
            name="Payments Tenant A",
            code="payments-tenant-a",
            is_active=True,
            status="active",
        )
        self.tenant_b = Tenant.objects.create(
            name="Payments Tenant B",
            code="payments-tenant-b",
            is_active=True,
            status="active",
        )
        self.user_a = User.objects.create_user("payments_admin_a", password="pass")
        TenantUserProfile.objects.create(
            user=self.user_a,
            tenant=self.tenant_a,
            is_tenant_admin=True,
        )
        self.client.force_authenticate(self.user_a)

    def test_customer_list_returns_only_current_tenant_customers(self):
        own_customer = Customer.objects.create(
            tenant=self.tenant_a,
            name="Tenant A Customer",
            phone_number="+254700000111",
            email="tenant-a-customer@test.example",
        )
        Customer.objects.create(
            tenant=self.tenant_b,
            name="Tenant B Customer",
            phone_number="+254700000222",
            email="tenant-b-customer@test.example",
        )

        response = self.client.get(reverse("invoice-customers"))

        self.assertEqual(response.status_code, 200, response.data)
        ids = {row["id"] for row in response.data["results"]}
        self.assertEqual(ids, {own_customer.id})

    def test_provider_capabilities_ignores_other_tenant_query_for_non_superuser(self):
        with patch(
            "Platform_API.modules.payments.views.list_payment_gateway_capabilities",
            return_value=[{"provider": "mock-gateway"}],
        ) as mocked:
            response = self.client.get(
                reverse("payment-provider-capabilities"),
                {"tenant_id": self.tenant_b.id},
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["tenant"]["id"], self.tenant_a.id)
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["tenant"].id, self.tenant_a.id)
