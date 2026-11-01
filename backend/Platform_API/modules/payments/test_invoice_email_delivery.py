# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantSettings, TenantUserProfile
from SL_Weighbridge.models import Customer, Invoice, InvoiceEmailLog


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", DEFAULT_FROM_EMAIL="platform@example.test")
class TenantInvoiceEmailDeliveryTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Invoice Mail", code="invoice-mail", is_active=True)
        self.user = User.objects.create_user("invoice-mail-admin", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Mail Customer", phone_number="+254700128800", email="customer@example.test")
        self.invoice = Invoice.objects.create(tenant=self.tenant, customer=self.customer, total_amount=100, status="draft")
        self.settings, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
        self.settings.smtp_host = "smtp.organization.example.test"
        self.settings.smtp_user = "mailbox@organization.example.test"
        self.settings.smtp_password = "test-only-password"
        self.settings.support_email = "billing@organization.example.test"
        self.settings.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @patch("Platform_API.modules.payments.views.get_tenant_smtp_connection")
    def test_invoice_uses_organization_mailbox_and_connection(self, connection):
        connection.return_value = mail.get_connection()
        response = self.client.post(reverse("invoice-issue", args=[self.invoice.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        connection.assert_called_once_with(self.settings)
        self.assertEqual(mail.outbox[0].from_email, "billing@organization.example.test")
        self.assertEqual(mail.outbox[0].to, ["customer@example.test"])
        self.assertTrue(InvoiceEmailLog.objects.get(invoice=self.invoice).success)

    @patch("Platform_API.modules.payments.views.get_tenant_smtp_connection")
    def test_unconfigured_organization_keeps_platform_delivery_fallback(self, connection):
        self.settings.smtp_host = ""
        self.settings.save()
        response = self.client.post(reverse("invoice-issue", args=[self.invoice.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        connection.assert_not_called()
        self.assertEqual(mail.outbox[0].from_email, "platform@example.test")

    @patch("Platform_API.modules.payments.views.get_tenant_smtp_connection")
    def test_other_organization_mailbox_is_never_selected(self, connection):
        other = Tenant.objects.create(name="Other Mail", code="other-mail", is_active=True)
        TenantSettings.objects.create(tenant=other, smtp_host="other.example.test", smtp_user="other@example.test", smtp_password="other-test-password")
        connection.return_value = mail.get_connection()
        response = self.client.post(reverse("invoice-issue", args=[self.invoice.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(connection.call_args.args[0].tenant_id, self.tenant.pk)
