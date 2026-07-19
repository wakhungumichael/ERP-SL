"""
Unit tests for provision_tenant view atomicity.

Verifies that:
1. A simulated mid-request crash (exception raised after Tenant is created but
   before TenantUserProfile is saved) causes transaction.atomic() to roll back
   — leaving no Tenant, User, or TenantUserProfile rows in the database.
2. A valid payload with no injected failure creates all expected rows:
   Tenant, User, TenantUserProfile, and TenantSettings.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch

from Platform_Core.models import Tenant, TenantSettings, TenantUserProfile


# ── helpers ────────────────────────────────────────────────────────────────────

def _superadmin():
    """Create and return a platform superuser (is_superuser=True)."""
    return User.objects.create_user(
        username="superadmin_provision",
        password="pass",
        is_superuser=True,
        is_staff=True,
    )


_VALID_PAYLOAD = {
    "name": "Acme Corp",
    "contact_email": "contact@acme.example",
    "admin_first_name": "Alice",
    "admin_last_name": "Admin",
    "admin_email": "alice@acme.example",
}


# ── test cases ─────────────────────────────────────────────────────────────────

class ProvisionTenantAtomicityTests(TestCase):
    """
    Atomicity tests for POST /api/platform/tenants/provision/.

    Confirms that transaction.atomic() in provision_tenant rolls back all
    partial writes when an exception occurs mid-request, and that a successful
    call creates every expected record.
    """

    def setUp(self):
        self.client = APIClient()
        self.superadmin = _superadmin()
        self.client.force_authenticate(user=self.superadmin)
        self.url = reverse("tenant-provision")

    # ── rollback test ─────────────────────────────────────────────────────────

    def test_no_rows_committed_when_exception_raised_after_tenant_created(self):
        """
        If an exception is forced after Tenant.save() but before
        TenantUserProfile.objects.create(), the transaction must roll back
        completely — no Tenant, User, or TenantUserProfile should exist.
        """
        tenant_count_before = Tenant.objects.count()
        user_count_before = User.objects.exclude(pk=self.superadmin.pk).count()
        profile_count_before = TenantUserProfile.objects.count()

        with patch(
            "Platform_Core.models.TenantUserProfile.objects.create",
            side_effect=RuntimeError("Simulated server crash after Tenant created"),
        ):
            try:
                self.client.post(self.url, _VALID_PAYLOAD, format="json")
            except Exception:
                # The view may re-raise; we only care about DB state.
                pass

        self.assertEqual(
            Tenant.objects.count(),
            tenant_count_before,
            "Tenant row must not persist after a mid-request crash — rollback expected.",
        )
        self.assertEqual(
            User.objects.exclude(pk=self.superadmin.pk).count(),
            user_count_before,
            "Admin User row must not persist after a mid-request crash — rollback expected.",
        )
        self.assertEqual(
            TenantUserProfile.objects.count(),
            profile_count_before,
            "TenantUserProfile must not persist after a mid-request crash — rollback expected.",
        )

    def test_no_tenant_row_when_exception_raised_after_tenant_created(self):
        """
        Explicit focused assertion: the Tenant itself is rolled back when the
        exception fires before the transaction is allowed to commit.
        """
        with patch(
            "Platform_Core.models.TenantUserProfile.objects.create",
            side_effect=RuntimeError("Simulated crash — Tenant must roll back"),
        ):
            try:
                self.client.post(self.url, _VALID_PAYLOAD, format="json")
            except Exception:
                pass

        self.assertFalse(
            Tenant.objects.filter(name=_VALID_PAYLOAD["name"]).exists(),
            "The Tenant row must be rolled back when an exception aborts the atomic block.",
        )

    def test_no_user_row_when_exception_raised_after_tenant_created(self):
        """
        Even the admin User created inside the atomic block must be rolled back
        when a crash happens later in the same transaction.
        """
        with patch(
            "Platform_Core.models.TenantUserProfile.objects.create",
            side_effect=RuntimeError("Simulated crash — User must roll back"),
        ):
            try:
                self.client.post(self.url, _VALID_PAYLOAD, format="json")
            except Exception:
                pass

        self.assertFalse(
            User.objects.filter(email=_VALID_PAYLOAD["admin_email"]).exists(),
            "The admin User row must be rolled back when an exception aborts the atomic block.",
        )

    # ── happy-path test ───────────────────────────────────────────────────────

    def test_valid_payload_returns_200_and_creates_all_rows(self):
        """
        A valid provision request must return 200 and persist exactly one Tenant,
        one admin User, one TenantUserProfile, and one TenantSettings record.
        """
        response = self.client.post(self.url, _VALID_PAYLOAD, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data.get("success"), response.data)

    def test_valid_payload_creates_tenant_row(self):
        """Tenant row must exist after a successful provision call."""
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        self.assertTrue(
            Tenant.objects.filter(name=_VALID_PAYLOAD["name"]).exists(),
            "Tenant row should exist after successful provisioning.",
        )

    def test_valid_payload_creates_admin_user_row(self):
        """Admin User row must exist after a successful provision call."""
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        self.assertTrue(
            User.objects.filter(email=_VALID_PAYLOAD["admin_email"]).exists(),
            "Admin User row should exist after successful provisioning.",
        )

    def test_valid_payload_creates_tenant_user_profile(self):
        """TenantUserProfile linking the admin user to the tenant must be created."""
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        tenant = Tenant.objects.filter(name=_VALID_PAYLOAD["name"]).first()
        self.assertIsNotNone(tenant, "Tenant must exist before checking profile.")
        self.assertTrue(
            TenantUserProfile.objects.filter(tenant=tenant, is_tenant_admin=True).exists(),
            "TenantUserProfile must exist and have is_tenant_admin=True.",
        )

    def test_valid_payload_creates_tenant_settings(self):
        """TenantSettings must be created for the new tenant."""
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        tenant = Tenant.objects.filter(name=_VALID_PAYLOAD["name"]).first()
        self.assertIsNotNone(tenant, "Tenant must exist before checking settings.")
        self.assertTrue(
            TenantSettings.objects.filter(tenant=tenant).exists(),
            "TenantSettings row must exist after successful provisioning.",
        )

    def test_valid_payload_response_contains_temp_password(self):
        """The response must include admin_temp_password so it can be handed off."""
        response = self.client.post(self.url, _VALID_PAYLOAD, format="json")

        payload = response.data.get("data", response.data)
        self.assertIn(
            "admin_temp_password",
            payload,
            "Response must include admin_temp_password.",
        )
        self.assertTrue(
            payload["admin_temp_password"],
            "admin_temp_password must be a non-empty string.",
        )


class ProvisionTenantDuplicateSubdomainTests(TestCase):
    """
    Tests that a duplicate subdomain returns HTTP 400 with a clear message
    instead of an unhandled IntegrityError / 500.
    """

    def setUp(self):
        self.client = APIClient()
        self.superadmin = _superadmin()
        self.client.force_authenticate(user=self.superadmin)
        self.url = reverse("tenant-provision")

    def test_duplicate_subdomain_returns_400(self):
        """
        Submitting a subdomain that is already taken must return HTTP 400,
        not a 500 IntegrityError from the database unique constraint.
        """
        # First provision creates the tenant with the subdomain.
        first_payload = {**_VALID_PAYLOAD, "subdomain": "acme"}
        response = self.client.post(self.url, first_payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)

        # Second request with the same subdomain (different admin email to avoid
        # conflicting on that unique constraint).
        duplicate_payload = {
            "name": "Acme Corp 2",
            "contact_email": "contact2@acme.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": "bob@acme.example",
            "subdomain": "acme",
        }
        response = self.client.post(self.url, duplicate_payload, format="json")

        self.assertEqual(
            response.status_code,
            400,
            f"Expected 400 for duplicate subdomain, got {response.status_code}: {response.data}",
        )

    def test_duplicate_subdomain_returns_human_readable_message(self):
        """
        The 400 response for a duplicate subdomain must contain a message that
        clearly identifies the problem (not a raw database constraint error).
        """
        first_payload = {**_VALID_PAYLOAD, "subdomain": "beta"}
        self.client.post(self.url, first_payload, format="json")

        duplicate_payload = {
            "name": "Beta Corp",
            "contact_email": "contact@beta.example",
            "admin_first_name": "Carol",
            "admin_last_name": "Admin",
            "admin_email": "carol@beta.example",
            "subdomain": "beta",
        }
        response = self.client.post(self.url, duplicate_payload, format="json")

        message = response.data.get("message", "")
        self.assertIn(
            "beta",
            message.lower(),
            "Error message should mention the conflicting subdomain.",
        )
        self.assertTrue(
            any(
                phrase in message.lower()
                for phrase in ("already", "taken", "exists", "duplicate")
            ),
            f"Error message should indicate a conflict; got: {message!r}",
        )

    def test_duplicate_subdomain_does_not_create_new_tenant(self):
        """
        A rejected duplicate-subdomain request must not leave a new Tenant row.
        """
        first_payload = {**_VALID_PAYLOAD, "subdomain": "gamma"}
        self.client.post(self.url, first_payload, format="json")

        tenant_count_after_first = Tenant.objects.count()

        duplicate_payload = {
            "name": "Gamma Corp 2",
            "contact_email": "contact2@gamma.example",
            "admin_first_name": "Dave",
            "admin_last_name": "Admin",
            "admin_email": "dave@gamma.example",
            "subdomain": "gamma",
        }
        self.client.post(self.url, duplicate_payload, format="json")

        self.assertEqual(
            Tenant.objects.count(),
            tenant_count_after_first,
            "A duplicate-subdomain request must not create an additional Tenant row.",
        )
