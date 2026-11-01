# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
import smtplib
import ssl
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_API.modules.platform.views import _smtp_delivery_error
from Platform_Core.models import Tenant, TenantSettings, TenantUserProfile


class SmtpErrorMessageTests(SimpleTestCase):
    def test_self_signed_certificate_has_specific_remediation(self):
        message = _smtp_delivery_error(ssl.SSLCertVerificationError(1, "certificate verify failed: self-signed certificate"))
        self.assertIn("self-signed", message)
        self.assertIn("trusted certificate", message)
        self.assertNotIn("disable", message)

    def test_hostname_mismatch_is_distinguished_from_expired_certificate(self):
        mismatch = _smtp_delivery_error(ssl.SSLCertVerificationError(1, "Hostname mismatch, certificate is not valid"))
        expired = _smtp_delivery_error(ssl.SSLCertVerificationError(1, "certificate has expired"))
        self.assertIn("hostname", mismatch)
        self.assertIn("expired", expired)

    def test_tls_mode_error_explains_port_choices(self):
        message = _smtp_delivery_error(ssl.SSLError(1, "WRONG_VERSION_NUMBER"))
        self.assertIn("465", message)
        self.assertIn("587", message)

    def test_authentication_error_does_not_expose_server_response(self):
        message = _smtp_delivery_error(smtplib.SMTPAuthenticationError(535, b"private-server-response"))
        self.assertIn("authentication failed", message)
        self.assertNotIn("private-server-response", message)

    def test_disabled_recipient_is_not_reported_as_a_network_failure(self):
        error = smtplib.SMTPRecipientsRefused({"sender@example.test": (525, b"5.7.13 Disabled recipient address")})
        message = _smtp_delivery_error(error)
        self.assertIn("incoming email disabled", message)
        self.assertNotIn("could not be reached", message)

    def test_sender_recipient_and_data_rejections_are_distinguished(self):
        cases = [
            (smtplib.SMTPSenderRefused(550, b"private-response", "sender@example.test"), "From address"),
            (smtplib.SMTPRecipientsRefused({"recipient@example.test": (550, b"private-response")}), "recipient address"),
            (smtplib.SMTPDataError(552, b"private-response"), "rejected the message"),
        ]
        for error, expected in cases:
            with self.subTest(error=type(error).__name__):
                message = _smtp_delivery_error(error)
                self.assertIn(expected, message)
                self.assertNotIn("private-response", message)
                self.assertNotIn("could not be reached", message)


class TenantSmtpSettingsTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="SMTP Regression", code="smtp-regression", is_active=True)
        self.user = User.objects.create_user("smtp-admin", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.settings, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
        self.settings.smtp_host = "smtp.example.test"
        self.settings.smtp_port = 465
        self.settings.smtp_user = "sender@example.test"
        self.settings.smtp_password = "saved-password"
        self.settings.support_email = "sender@example.test"
        self.settings.smtp_use_ssl = True
        self.settings.smtp_use_tls = False
        self.settings.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse("tenant-settings", kwargs={"pk": self.tenant.pk})

    def test_blank_password_update_preserves_saved_password(self):
        response = self.client.put(self.url, {"smtp_host": "new-host.example.test", "smtp_password": ""}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.smtp_host, "new-host.example.test")
        self.assertEqual(self.settings.smtp_password, "saved-password")
        self.assertTrue(response.data["data"]["smtp_password_configured"])
        self.assertNotIn("smtp_password", response.data["data"])

    def test_conflicting_encryption_modes_are_rejected(self):
        response = self.client.put(self.url, {"smtp_use_ssl": True, "smtp_use_tls": True}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.settings.refresh_from_db()
        self.assertFalse(self.settings.smtp_use_tls)

    def test_password_can_be_replaced_without_appearing_in_response(self):
        response = self.client.put(self.url, {"smtp_password": "replacement-password"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.smtp_password, "replacement-password")
        self.assertNotIn("smtp_password", response.data["data"])

    @patch("Platform_API.modules.platform.views.get_tenant_smtp_connection")
    @patch("django.core.mail.EmailMessage")
    def test_certificate_failure_is_actionable_without_leaking_credentials(self, email_message, connection):
        email_message.return_value.send.side_effect = ssl.SSLCertVerificationError(1, "self-signed certificate")
        response = self.client.post(reverse("tenant-settings-test-smtp", kwargs={"pk": self.tenant.pk}))
        self.assertEqual(response.status_code, 502, response.data)
        self.assertIn("self-signed", str(response.data))
        self.assertNotIn("saved-password", str(response.data))

    @patch("Platform_API.modules.platform.views.get_tenant_smtp_connection")
    @patch("django.core.mail.EmailMessage")
    def test_smtp_test_reports_success_with_configured_mailbox(self, email_message, connection):
        email_message.return_value.send.return_value = 1
        response = self.client.post(reverse("tenant-settings-test-smtp", kwargs={"pk": self.tenant.pk}))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(email_message.call_args.kwargs["to"], ["sender@example.test"])

    @patch("django.core.mail.EmailMessage")
    def test_other_organization_cannot_run_mail_test(self, email_message):
        other = Tenant.objects.create(name="Other SMTP", code="other-smtp")
        TenantSettings.objects.create(tenant=other)
        response = self.client.post(reverse("tenant-settings-test-smtp", kwargs={"pk": other.pk}))
        self.assertEqual(response.status_code, 403, response.data)
        email_message.assert_not_called()

    @patch("Platform_API.modules.platform.views.get_tenant_smtp_connection")
    @patch("django.core.mail.EmailMessage")
    def test_separate_test_recipient_does_not_change_sender_or_saved_settings(self, email_message, connection):
        email_message.return_value.send.return_value = 1
        response = self.client.post(reverse("tenant-settings-test-smtp", kwargs={"pk": self.tenant.pk}), {"recipient": "working-inbox@example.test"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(email_message.call_args.kwargs["to"], ["working-inbox@example.test"])
        self.assertEqual(email_message.call_args.kwargs["from_email"], "sender@example.test")
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.smtp_user, "sender@example.test")
        self.assertEqual(self.settings.support_email, "sender@example.test")

    @patch("django.core.mail.EmailMessage")
    def test_invalid_test_recipient_is_rejected_before_sending(self, email_message):
        for recipient in ["not-an-address", "", None, "recipient@example.test\r\nBcc: other@example.test"]:
            with self.subTest(recipient=recipient):
                response = self.client.post(reverse("tenant-settings-test-smtp", kwargs={"pk": self.tenant.pk}), {"recipient": recipient}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
        email_message.assert_not_called()

    @patch("Platform_API.modules.platform.views.get_tenant_smtp_connection")
    @patch("django.core.mail.EmailMessage")
    def test_disabled_recipient_api_message_explains_the_real_failure(self, email_message, connection):
        email_message.return_value.send.side_effect = smtplib.SMTPRecipientsRefused({"sender@example.test": (525, b"5.7.13 Disabled recipient address")})
        response = self.client.post(reverse("tenant-settings-test-smtp", kwargs={"pk": self.tenant.pk}))
        self.assertEqual(response.status_code, 502, response.data)
        self.assertIn("incoming email disabled", response.data["message"])
        self.assertNotIn("could not be reached", response.data["message"])
