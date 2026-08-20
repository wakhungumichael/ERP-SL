from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Ticketing.models import Ticket, TicketingApiKey, TicketingInboxConfig


class TicketingPublicFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(
            name="Support Tenant",
            code="support-tenant",
            is_active=True,
            status="active",
        )
        self.other_tenant = Tenant.objects.create(
            name="Other Support Tenant",
            code="other-support-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("support_admin", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        self.config = TicketingInboxConfig.objects.create(
            tenant=self.tenant,
            allowed_domains=["https://support.example.com"],
            require_cors_origin=True,
            portal_access_policy="email_match",
        )
        self.public_key, self.public_raw_token = TicketingApiKey.issue_token(
            tenant=self.tenant,
            name="Public Intake",
            key_type="public",
        )
        self.secret_key, self.secret_raw_token = TicketingApiKey.issue_token(
            tenant=self.tenant,
            name="Secret Export",
            key_type="secret",
        )

    def test_public_ticket_creation_requires_valid_tenant_and_origin(self):
        response = self.client.post(
            reverse("public-ticket-create-list"),
            {
                "requester_name": "Jane Support",
                "requester_email": "jane@example.com",
                "subject": "Checkout error",
                "description": "Customer cannot complete payment.",
                "category": "billing",
                "priority": "urgent",
                "source_page": "/checkout",
            },
            format="json",
            HTTP_X_TENANT_ID=self.tenant.code,
            HTTP_AUTHORIZATION=f"Bearer {self.public_raw_token}",
            HTTP_ORIGIN="https://support.example.com",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(Ticket.objects.filter(tenant=self.tenant, requester_email="jane@example.com").exists())
        self.assertEqual(response.data["status"], "new")
        self.assertTrue(response.data["tracking_token"])

    def test_public_ticket_creation_rejects_cross_tenant_token_usage(self):
        response = self.client.post(
            reverse("public-ticket-create-list"),
            {
                "requester_email": "blocked@example.com",
                "subject": "Cross-tenant attempt",
            },
            format="json",
            HTTP_X_TENANT_ID=self.other_tenant.code,
            HTTP_AUTHORIZATION=f"Bearer {self.public_raw_token}",
            HTTP_ORIGIN="https://support.example.com",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Ticket.objects.filter(requester_email="blocked@example.com").exists())

    def test_tracking_endpoint_requires_matching_email(self):
        ticket = Ticket.objects.create(
            tenant=self.tenant,
            requester_name="Jane Support",
            requester_email="jane@example.com",
            subject="Checkout error",
            description="Customer cannot complete payment.",
        )

        allowed = self.client.get(
            reverse("public-ticket-track"),
            {"ticket_id": ticket.public_id, "email": "jane@example.com"},
        )
        self.assertEqual(allowed.status_code, 200, allowed.data)
        self.assertEqual(allowed.data["public_id"], ticket.public_id)

        denied = self.client.get(
            reverse("public-ticket-track"),
            {"ticket_id": ticket.public_id, "email": "wrong@example.com"},
        )
        self.assertEqual(denied.status_code, 403, denied.data)


class TicketingAdminApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(
            name="Admin Tenant",
            code="admin-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("ticketing_admin", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        self.client.force_authenticate(self.user)

    def test_key_generation_returns_one_time_raw_token(self):
        response = self.client.post(
            reverse("ticketing-keys"),
            {"name": "Widget Key", "key_type": "public"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn("raw_token", response.data)
        self.assertEqual(response.data["key"]["name"], "Widget Key")
