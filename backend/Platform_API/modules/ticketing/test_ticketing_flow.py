from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Ticketing.models import Ticket, TicketMessage, TicketingApiKey, TicketingInboxConfig


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


class TicketingChannelFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(
            name="Channel Tenant",
            code="channel-tenant",
            is_active=True,
            status="active",
        )
        self.other_tenant = Tenant.objects.create(
            name="Other Channel Tenant",
            code="other-channel-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("channel_admin", password="pass", email="agent@example.com")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        self.client.force_authenticate(self.user)
        TicketingInboxConfig.objects.create(
            tenant=self.tenant,
            channel_settings={
                "email": {
                    "enabled": True,
                    "inbound_secret": "email-secret",
                    "from_name": "Channel Support",
                    "reply_subject_prefix": "[Channel]",
                    "allow_new_tickets": True,
                },
                "whatsapp": {
                    "enabled": True,
                    "provider": "meta_cloud_api",
                    "verify_token": "verify-me",
                    "phone_number_id": "123456",
                    "access_token": "token-123",
                    "allow_new_tickets": True,
                },
            },
        )
        TicketingInboxConfig.objects.create(
            tenant=self.other_tenant,
            channel_settings={
                "email": {"enabled": True, "inbound_secret": "other-secret"},
                "whatsapp": {"enabled": True, "verify_token": "other-verify"},
            },
        )

    def test_inbound_email_creates_ticket_for_target_tenant_only(self):
        response = self.client.post(
            reverse("ticketing-inbound-email", args=[self.tenant.code]),
            {
                "from_email": "customer@example.com",
                "from_name": "Customer Example",
                "subject": "Help with billing",
                "text": "I need support with my invoice.",
                "message_id": "mail-001",
            },
            format="json",
            HTTP_X_TICKETING_SECRET="email-secret",
        )

        self.assertEqual(response.status_code, 201, response.data)
        ticket = Ticket.objects.get(tenant=self.tenant, requester_email="customer@example.com")
        self.assertEqual(ticket.source_channel, "email")
        self.assertFalse(Ticket.objects.filter(tenant=self.other_tenant, requester_email="customer@example.com").exists())

    def test_inbound_whatsapp_reply_uses_context_message_without_cross_tenant_leak(self):
        ticket = Ticket.objects.create(
            tenant=self.tenant,
            requester_name="WhatsApp Customer",
            requester_email="254700000001@whatsapp.local",
            requester_phone="254700000001",
            subject="Original ticket",
            source_channel="whatsapp",
        )
        TicketMessage.objects.create(
            ticket=ticket,
            author_type="agent",
            author_name="Agent",
            message="Can you share a screenshot?",
            channel="whatsapp",
            direction="outbound",
            delivery_status="sent",
            external_message_id="wamid.001",
            is_public=True,
        )
        other_ticket = Ticket.objects.create(
            tenant=self.other_tenant,
            requester_name="Other Customer",
            requester_email="254700000001@whatsapp.local",
            requester_phone="254700000001",
            subject="Other tenant ticket",
            source_channel="whatsapp",
        )
        TicketMessage.objects.create(
            ticket=other_ticket,
            author_type="agent",
            author_name="Other Agent",
            message="Other tenant outbound",
            channel="whatsapp",
            direction="outbound",
            delivery_status="sent",
            external_message_id="wamid.001",
            is_public=True,
        )

        response = self.client.post(
            reverse("ticketing-inbound-whatsapp", args=[self.tenant.code]),
            {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "messages": [
                                        {
                                            "id": "wamid.reply.1",
                                            "from": "254700000001",
                                            "text": {"body": "Here is the screenshot."},
                                            "context": {"id": "wamid.001"},
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TicketMessage.objects.filter(ticket=ticket, channel="whatsapp", direction="inbound").count(), 1)
        self.assertEqual(TicketMessage.objects.filter(ticket=other_ticket, channel="whatsapp", direction="inbound").count(), 0)

    @patch("Platform_API.modules.ticketing.views._send_email_message")
    def test_agent_reply_can_flow_back_to_email_channel(self, send_email_mock):
        send_email_mock.return_value = {"to": "customer@example.com", "subject": "[Channel] TKT-001"}
        ticket = Ticket.objects.create(
            tenant=self.tenant,
            requester_name="Email Customer",
            requester_email="customer@example.com",
            subject="Need help",
            source_channel="email",
        )

        response = self.client.post(
            reverse("ticketing-ticket-reply", args=[ticket.id]),
            {"message": "We have fixed it.", "reply_channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        reply = TicketMessage.objects.filter(ticket=ticket, author_type="agent").latest("id")
        self.assertEqual(reply.channel, "email")
        self.assertEqual(reply.direction, "outbound")
        self.assertEqual(reply.delivery_status, "sent")
        send_email_mock.assert_called_once()
