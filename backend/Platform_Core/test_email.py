from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from Platform_Core.email import get_tenant_smtp_connection


class TenantSmtpConnectionTests(SimpleTestCase):
    def _settings(self, **overrides):
        values = {
            "smtp_host": "mail.example.com",
            "smtp_port": 587,
            "smtp_user": "sender@example.com",
            "smtp_password": "secret",
            "smtp_use_tls": True,
            "smtp_use_ssl": False,
            "smtp_allow_insecure_ssl": False,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    @patch("Platform_Core.email.get_connection")
    def test_port_465_can_use_implicit_ssl(self, get_connection):
        settings_obj = self._settings(smtp_port=465, smtp_use_tls=False, smtp_use_ssl=True)

        get_tenant_smtp_connection(settings_obj)

        self.assertTrue(get_connection.call_args.kwargs["use_ssl"])
        self.assertFalse(get_connection.call_args.kwargs["use_tls"])

    @patch("Platform_Core.email.get_connection")
    def test_starttls_remains_available_for_port_587(self, get_connection):
        get_tenant_smtp_connection(self._settings())

        self.assertFalse(get_connection.call_args.kwargs["use_ssl"])
        self.assertTrue(get_connection.call_args.kwargs["use_tls"])

    @patch("Platform_Core.email.get_connection")
    def test_ssl_wins_for_defensive_legacy_rows(self, get_connection):
        settings_obj = self._settings(smtp_port=465, smtp_use_tls=True, smtp_use_ssl=True)

        get_tenant_smtp_connection(settings_obj)

        self.assertTrue(get_connection.call_args.kwargs["use_ssl"])
        self.assertFalse(get_connection.call_args.kwargs["use_tls"])

    @patch("Platform_Core.email.get_connection")
    def test_self_signed_certificate_support_is_explicitly_opt_in(self, get_connection):
        settings_obj = self._settings(
            smtp_port=465,
            smtp_use_tls=False,
            smtp_use_ssl=True,
            smtp_allow_insecure_ssl=True,
        )

        connection = get_tenant_smtp_connection(settings_obj)

        self.assertFalse(connection.ssl_context.check_hostname)
        self.assertEqual(connection.ssl_context.verify_mode, 0)
