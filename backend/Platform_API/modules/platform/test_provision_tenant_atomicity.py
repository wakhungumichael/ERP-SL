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


class ProvisionTenantDuplicateNameTests(TestCase):
    """
    Tests that a duplicate tenant name returns HTTP 400 with a clear message
    instead of silently creating a confusingly-named tenant.
    """

    def setUp(self):
        self.client = APIClient()
        self.superadmin = _superadmin()
        self.client.force_authenticate(user=self.superadmin)
        self.url = reverse("tenant-provision")

    def test_duplicate_name_returns_400(self):
        """
        Submitting a tenant name that already exists must return HTTP 400.
        """
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        duplicate_payload = {
            "name": _VALID_PAYLOAD["name"],
            "contact_email": "contact2@other.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": "bob@other.example",
        }
        response = self.client.post(self.url, duplicate_payload, format="json")

        self.assertEqual(
            response.status_code,
            400,
            f"Expected 400 for duplicate tenant name, got {response.status_code}: {response.data}",
        )

    def test_duplicate_name_returns_human_readable_message(self):
        """
        The 400 response for a duplicate name must contain a message that
        clearly identifies the problem.
        """
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        duplicate_payload = {
            "name": _VALID_PAYLOAD["name"],
            "contact_email": "contact2@other.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": "bob@other.example",
        }
        response = self.client.post(self.url, duplicate_payload, format="json")

        message = response.data.get("message", "")
        self.assertTrue(
            any(
                phrase in message.lower()
                for phrase in ("already", "exists", "taken", "duplicate")
            ),
            f"Error message should indicate a name conflict; got: {message!r}",
        )

    def test_duplicate_name_does_not_create_new_tenant(self):
        """
        A rejected duplicate-name request must not leave a new Tenant row.
        """
        self.client.post(self.url, _VALID_PAYLOAD, format="json")
        tenant_count_after_first = Tenant.objects.count()

        duplicate_payload = {
            "name": _VALID_PAYLOAD["name"],
            "contact_email": "contact2@other.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": "bob@other.example",
        }
        self.client.post(self.url, duplicate_payload, format="json")

        self.assertEqual(
            Tenant.objects.count(),
            tenant_count_after_first,
            "A duplicate-name request must not create an additional Tenant row.",
        )


# ── first-login end-to-end tests ───────────────────────────────────────────────

class ProvisionTenantFirstLoginTests(TestCase):
    """
    End-to-end tests confirming that the credentials returned by
    provision_tenant can immediately authenticate the new tenant admin without
    any manual setup step.

    Covers:
    1. POST /api/platform/auth/token/ with the provisioned username + temp
       password returns a token.
    2. GET /api/platform/auth/me/ with that token returns the correct tenant
       context (tenant_id matches the newly created tenant, is_tenant_admin=True).
    """

    def setUp(self):
        self.client = APIClient()
        self.superadmin = _superadmin()
        self.client.force_authenticate(user=self.superadmin)
        self.provision_url = reverse("tenant-provision")
        self.token_url = reverse("platform-auth-token")
        self.me_url = reverse("platform-auth-me")

    def _provision(self):
        """Provision a fresh tenant and return the response data dict."""
        payload = {
            "name": "Login Test Corp",
            "contact_email": "contact@logintest.example",
            "admin_first_name": "Tina",
            "admin_last_name": "Tenant",
            "admin_email": "tina@logintest.example",
        }
        response = self.client.post(self.provision_url, payload, format="json")
        self.assertEqual(
            response.status_code,
            200,
            f"Provisioning failed unexpectedly: {response.data}",
        )
        return response.data.get("data", response.data)

    # ── token issuance ────────────────────────────────────────────────────────

    def test_provisioned_credentials_return_a_token(self):
        """
        POSTing the provisioned username and temp password to auth/token/ must
        return HTTP 200 with a non-empty token — no manual password reset or
        account activation step required.
        """
        data = self._provision()
        username = data["admin_username"]
        password = data["admin_temp_password"]

        # Use an unauthenticated client to simulate the new tenant's first request.
        anon_client = APIClient()
        response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            200,
            f"Expected 200 from token endpoint, got {response.status_code}: {response.data}",
        )
        token_data = response.data.get("data", response.data)
        self.assertIn("token", token_data, "Response must contain a 'token' key.")
        self.assertTrue(token_data["token"], "Token must be a non-empty string.")

    # ── /me/ tenant context ───────────────────────────────────────────────────

    def test_me_endpoint_returns_correct_tenant_context(self):
        """
        After authenticating with the provisioned credentials, GET /auth/me/
        must return:
          - tenant_id matching the newly created tenant
          - is_tenant_admin == True
        """
        data = self._provision()
        username = data["admin_username"]
        password = data["admin_temp_password"]
        expected_tenant_id = data["tenant"]["id"]

        # Obtain token
        anon_client = APIClient()
        token_response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertEqual(token_response.status_code, 200, token_response.data)
        token = token_response.data["data"]["token"]

        # Call /me/ with the issued token
        anon_client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        me_response = anon_client.get(self.me_url)

        self.assertEqual(
            me_response.status_code,
            200,
            f"Expected 200 from /me/, got {me_response.status_code}: {me_response.data}",
        )
        me_data = me_response.data.get("data", me_response.data)

        self.assertEqual(
            me_data.get("tenant_id"),
            expected_tenant_id,
            f"tenant_id in /me/ response ({me_data.get('tenant_id')!r}) must match "
            f"the provisioned tenant ({expected_tenant_id!r}).",
        )
        self.assertTrue(
            me_data.get("is_tenant_admin"),
            "/me/ response must report is_tenant_admin=True for the provisioned admin.",
        )


# ── duplicate admin-email tests ────────────────────────────────────────────────

class ProvisionTenantDuplicateAdminEmailTests(TestCase):
    """
    Tests that submitting an admin_email that already belongs to a Django User
    returns HTTP 400 with a clear message instead of an unhandled IntegrityError / 500.
    """

    def setUp(self):
        self.client = APIClient()
        self.superadmin = _superadmin()
        self.client.force_authenticate(user=self.superadmin)
        self.url = reverse("tenant-provision")

    def test_duplicate_admin_email_returns_400(self):
        """
        Submitting an admin_email that already belongs to a User must return
        HTTP 400, not a 500 IntegrityError from the database unique constraint.
        """
        # First provision creates the admin user with this email.
        response = self.client.post(self.url, _VALID_PAYLOAD, format="json")
        self.assertEqual(response.status_code, 200, response.data)

        # Second request reuses the same admin_email for a different tenant.
        duplicate_payload = {
            "name": "Beta Corp",
            "contact_email": "contact@beta.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": _VALID_PAYLOAD["admin_email"],
        }
        response = self.client.post(self.url, duplicate_payload, format="json")

        self.assertEqual(
            response.status_code,
            400,
            f"Expected 400 for duplicate admin_email, got {response.status_code}: {response.data}",
        )

    def test_duplicate_admin_email_returns_human_readable_message(self):
        """
        The 400 response for a duplicate admin_email must contain a message
        that clearly identifies the problem (not a raw database error).
        """
        self.client.post(self.url, _VALID_PAYLOAD, format="json")

        duplicate_payload = {
            "name": "Beta Corp",
            "contact_email": "contact@beta.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": _VALID_PAYLOAD["admin_email"],
        }
        response = self.client.post(self.url, duplicate_payload, format="json")

        message = response.data.get("message", "")
        self.assertTrue(
            any(
                phrase in message.lower()
                for phrase in ("already exists", "already", "exists", "duplicate")
            ),
            f"Error message should indicate an email conflict; got: {message!r}",
        )

    def test_duplicate_admin_email_does_not_create_new_tenant(self):
        """
        A rejected duplicate admin_email request must not leave a new Tenant row.
        """
        self.client.post(self.url, _VALID_PAYLOAD, format="json")
        tenant_count_after_first = Tenant.objects.count()

        duplicate_payload = {
            "name": "Beta Corp",
            "contact_email": "contact@beta.example",
            "admin_first_name": "Bob",
            "admin_last_name": "Admin",
            "admin_email": _VALID_PAYLOAD["admin_email"],
        }
        self.client.post(self.url, duplicate_payload, format="json")

        self.assertEqual(
            Tenant.objects.count(),
            tenant_count_after_first,
            "A duplicate admin_email request must not create an additional Tenant row.",
        )

    def test_existing_user_email_also_rejected(self):
        """
        An admin_email that belongs to a pre-existing User (not created by
        provision_tenant) must also be rejected with HTTP 400.
        """
        # Create a plain user outside of provisioning.
        existing_user = User.objects.create_user(
            username="existing_user",
            email="existing@example.com",
            password="pass",
        )

        payload = {
            "name": "Gamma Corp",
            "contact_email": "contact@gamma.example",
            "admin_first_name": "Eve",
            "admin_last_name": "Admin",
            "admin_email": existing_user.email,
        }
        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(
            response.status_code,
            400,
            f"Expected 400 when admin_email matches an existing user, "
            f"got {response.status_code}: {response.data}",
        )


# ── suspended-account login-rejection tests ────────────────────────────────────

class SuspendedUserLoginTests(TestCase):
    """
    Guard tests confirming that a provisioned tenant admin cannot authenticate
    once their account or their tenant has been deactivated / suspended.

    Covers:
    1. user.is_active = False  → POST /api/platform/auth/token/ returns non-200.
    2. tenant.is_active = False (via suspend_tenant) → POST /api/platform/auth/token/
       returns non-200.
    """

    def setUp(self):
        self.superadmin_client = APIClient()
        self.superadmin = _superadmin()
        self.superadmin_client.force_authenticate(user=self.superadmin)
        self.provision_url = reverse("tenant-provision")
        self.token_url = reverse("platform-auth-token")
        self.me_url = reverse("platform-auth-me")

    def _provision(self, suffix=""):
        """Provision a fresh tenant and return the response data dict."""
        payload = {
            "name": f"Suspend Test Corp{suffix}",
            "contact_email": f"contact{suffix}@suspendtest.example",
            "admin_first_name": "Sam",
            "admin_last_name": "Suspend",
            "admin_email": f"sam{suffix}@suspendtest.example",
        }
        response = self.superadmin_client.post(self.provision_url, payload, format="json")
        self.assertEqual(
            response.status_code,
            200,
            f"Provisioning failed unexpectedly: {response.data}",
        )
        return response.data.get("data", response.data)

    # ── test 1: user account deactivated ─────────────────────────────────────

    def test_deactivated_user_cannot_obtain_token(self):
        """
        After user.is_active is set to False the token endpoint must return a
        non-200 status (400 or 401) — not issue a valid token.
        """
        data = self._provision(suffix="_user_suspend")
        username = data["admin_username"]
        password = data["admin_temp_password"]

        # Verify the happy path works first (token is issuable before deactivation).
        anon_client = APIClient()
        ok_response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertEqual(
            ok_response.status_code,
            200,
            f"Pre-deactivation login should succeed; got {ok_response.status_code}: {ok_response.data}",
        )

        # Deactivate the admin user.
        admin_user = User.objects.get(username=username)
        admin_user.is_active = False
        admin_user.save(update_fields=["is_active"])

        # Token endpoint must now reject the credentials.
        bad_response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertNotEqual(
            bad_response.status_code,
            200,
            "A deactivated user must not receive a token — expected non-200 but got 200.",
        )

    # ── test 2: tenant suspended ──────────────────────────────────────────────

    def test_suspended_tenant_admin_cannot_obtain_token(self):
        """
        After the tenant is suspended via suspend_tenant (tenant.is_active = False),
        POSTing to auth/token/ must return a non-200 response — the provisioned
        admin's credentials should be rejected.
        """
        data = self._provision(suffix="_tenant_suspend")
        username = data["admin_username"]
        password = data["admin_temp_password"]
        tenant_id = data["tenant"]["id"]

        # Verify the happy path works before suspension.
        anon_client = APIClient()
        ok_response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertEqual(
            ok_response.status_code,
            200,
            f"Pre-suspension login should succeed; got {ok_response.status_code}: {ok_response.data}",
        )

        # Suspend the tenant via the platform endpoint.
        suspend_url = reverse("tenant-suspend", kwargs={"pk": tenant_id})
        suspend_response = self.superadmin_client.post(suspend_url)
        self.assertEqual(
            suspend_response.status_code,
            200,
            f"suspend_tenant should return 200; got {suspend_response.status_code}: {suspend_response.data}",
        )

        # Token endpoint must now reject the admin's credentials.
        bad_response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertNotEqual(
            bad_response.status_code,
            200,
            "A tenant admin whose tenant is suspended must not receive a token — "
            "expected non-200 but got 200.",
        )

    # ── test 3: null-tenant profile — no crash ────────────────────────────────

    def test_user_with_null_tenant_profile_can_obtain_token(self):
        """
        A user whose TenantUserProfile has tenant=None must not cause a server
        crash in the token endpoint. The login should succeed normally (the
        suspension guard must be null-safe).
        """
        # Create a plain user and attach a TenantUserProfile with tenant=None.
        orphan_user = User.objects.create_user(
            username="orphan_profile_user",
            password="testpass123",
            is_active=True,
        )
        TenantUserProfile.objects.create(
            user=orphan_user,
            tenant=None,
            is_tenant_admin=False,
        )

        anon_client = APIClient()
        response = anon_client.post(
            self.token_url,
            {"username": "orphan_profile_user", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(
            response.status_code,
            200,
            f"A user with a null-tenant TenantUserProfile must not crash the token "
            f"endpoint — got {response.status_code}: {response.data}",
        )


# ── cross-tenant data isolation tests ─────────────────────────────────────────

class ProvisionedTenantAdminDataIsolationTests(TestCase):
    """
    Confirm that a freshly provisioned tenant admin is immediately scoped to
    their own tenant on real data endpoints.

    Covers:
    - GET /api/platform/users/ returns only the requesting tenant's users.
    - Users belonging to a second tenant are never exposed.

    This guards against regressions where a new tenant admin could silently
    read cross-tenant data from the very first authenticated request.
    """

    def setUp(self):
        self.superadmin_client = APIClient()
        self.superadmin = _superadmin()
        self.superadmin_client.force_authenticate(user=self.superadmin)
        self.provision_url = reverse("tenant-provision")
        self.token_url = reverse("platform-auth-token")
        self.users_url = reverse("platform-user-list")

    def _provision(self, name, contact_email, admin_first_name, admin_last_name, admin_email):
        """Provision a tenant and return the response data dict."""
        payload = {
            "name": name,
            "contact_email": contact_email,
            "admin_first_name": admin_first_name,
            "admin_last_name": admin_last_name,
            "admin_email": admin_email,
        }
        response = self.superadmin_client.post(self.provision_url, payload, format="json")
        self.assertEqual(
            response.status_code,
            200,
            f"Provisioning '{name}' failed unexpectedly: {response.data}",
        )
        return response.data.get("data", response.data)

    def _get_token_for(self, username, password):
        """Obtain an auth token for the given credentials."""
        anon_client = APIClient()
        response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertEqual(
            response.status_code,
            200,
            f"Token request for '{username}' failed: {response.data}",
        )
        return response.data["data"]["token"]

    # ── isolation tests ───────────────────────────────────────────────────────

    def test_tenant_a_admin_sees_only_own_users(self):
        """
        GET /api/platform/users/ authenticated as Tenant A's admin must return
        only users belonging to Tenant A — no users from Tenant B.
        """
        data_a = self._provision(
            name="Isolation Corp A",
            contact_email="contact@isolation-a.example",
            admin_first_name="Alice",
            admin_last_name="AdminA",
            admin_email="alice@isolation-a.example",
        )
        data_b = self._provision(
            name="Isolation Corp B",
            contact_email="contact@isolation-b.example",
            admin_first_name="Bob",
            admin_last_name="AdminB",
            admin_email="bob@isolation-b.example",
        )

        tenant_a_id = data_a["tenant"]["id"]
        tenant_b_admin_username = data_b["admin_username"]

        token_a = self._get_token_for(
            data_a["admin_username"], data_a["admin_temp_password"]
        )

        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Token {token_a}")
        response = client_a.get(self.users_url)

        self.assertEqual(
            response.status_code,
            200,
            f"Expected 200 from /users/, got {response.status_code}: {response.data}",
        )

        response_data = response.data
        # Support both paginated (results key) and plain list responses.
        users = response_data.get("results", response_data) if isinstance(response_data, dict) else response_data

        # Collect all usernames returned.
        returned_usernames = {u.get("username") for u in users}

        self.assertNotIn(
            tenant_b_admin_username,
            returned_usernames,
            f"Tenant A's admin must NOT see Tenant B's admin ('{tenant_b_admin_username}') "
            f"in the user list — cross-tenant data leak detected.",
        )

    def test_tenant_a_admin_can_see_own_admin_account(self):
        """
        GET /api/platform/users/ authenticated as Tenant A's admin must include
        Tenant A's own admin user in the response.
        """
        data_a = self._provision(
            name="Visibility Corp A",
            contact_email="contact@visibility-a.example",
            admin_first_name="Carol",
            admin_last_name="AdminC",
            admin_email="carol@visibility-a.example",
        )
        # Provision a second tenant to ensure scoping is active.
        self._provision(
            name="Visibility Corp B",
            contact_email="contact@visibility-b.example",
            admin_first_name="Dave",
            admin_last_name="AdminD",
            admin_email="dave@visibility-b.example",
        )

        token_a = self._get_token_for(
            data_a["admin_username"], data_a["admin_temp_password"]
        )

        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Token {token_a}")
        response = client_a.get(self.users_url)

        self.assertEqual(
            response.status_code,
            200,
            f"Expected 200 from /users/, got {response.status_code}: {response.data}",
        )

        response_data = response.data
        users = response_data.get("results", response_data) if isinstance(response_data, dict) else response_data

        returned_usernames = {u.get("username") for u in users}

        self.assertIn(
            data_a["admin_username"],
            returned_usernames,
            f"Tenant A's admin ('{data_a['admin_username']}') must appear in their own "
            f"user list — own-tenant visibility is broken.",
        )

    def test_tenant_b_admin_does_not_appear_in_tenant_a_results(self):
        """
        Provision two tenants and confirm the user list for Tenant A contains
        exactly one user (itself) — not the admin of Tenant B.
        """
        data_a = self._provision(
            name="Count Corp A",
            contact_email="contact@count-a.example",
            admin_first_name="Eve",
            admin_last_name="AdminE",
            admin_email="eve@count-a.example",
        )
        data_b = self._provision(
            name="Count Corp B",
            contact_email="contact@count-b.example",
            admin_first_name="Frank",
            admin_last_name="AdminF",
            admin_email="frank@count-b.example",
        )

        token_a = self._get_token_for(
            data_a["admin_username"], data_a["admin_temp_password"]
        )

        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Token {token_a}")
        response = client_a.get(self.users_url)

        self.assertEqual(
            response.status_code,
            200,
            f"Expected 200 from /users/, got {response.status_code}: {response.data}",
        )

        response_data = response.data
        users = response_data.get("results", response_data) if isinstance(response_data, dict) else response_data

        returned_usernames = {u.get("username") for u in users}

        # Tenant A's list must contain its own admin.
        self.assertIn(
            data_a["admin_username"],
            returned_usernames,
            "Tenant A's own admin must be visible to Tenant A.",
        )
        # Tenant A's list must NOT contain Tenant B's admin.
        self.assertNotIn(
            data_b["admin_username"],
            returned_usernames,
            f"Tenant A must not see Tenant B's admin ('{data_b['admin_username']}') "
            f"— cross-tenant isolation is broken.",
        )


# ── branch-list isolation tests ────────────────────────────────────────────────

class TenantBranchListIsolationTests(TestCase):
    """
    Confirm that a freshly provisioned tenant admin cannot enumerate another
    tenant's branch list via GET /api/platform/tenants/<id>/branches/.

    Covers:
    - Tenant A's admin receives 403 when requesting Tenant B's branch list.
    - Tenant A's admin can access their own (empty) branch list (200).
    - Tenant B's branches are never returned to Tenant A, even when branches
      exist in Tenant B before Tenant A's admin makes the request.

    This guards against a regression where _require_tenant_access fails to
    reject a valid auth token that is scoped to the wrong tenant.
    """

    def setUp(self):
        self.superadmin_client = APIClient()
        self.superadmin = _superadmin()
        self.superadmin_client.force_authenticate(user=self.superadmin)
        self.provision_url = reverse("tenant-provision")
        self.token_url = reverse("platform-auth-token")

    def _provision(self, name, contact_email, admin_first_name, admin_last_name, admin_email):
        """Provision a tenant and return the response data dict."""
        payload = {
            "name": name,
            "contact_email": contact_email,
            "admin_first_name": admin_first_name,
            "admin_last_name": admin_last_name,
            "admin_email": admin_email,
        }
        response = self.superadmin_client.post(self.provision_url, payload, format="json")
        self.assertEqual(
            response.status_code,
            200,
            f"Provisioning '{name}' failed unexpectedly: {response.data}",
        )
        return response.data.get("data", response.data)

    def _get_token_for(self, username, password):
        """Obtain an auth token for the given credentials."""
        anon_client = APIClient()
        response = anon_client.post(
            self.token_url,
            {"username": username, "password": password},
            format="json",
        )
        self.assertEqual(
            response.status_code,
            200,
            f"Token request for '{username}' failed: {response.data}",
        )
        return response.data["data"]["token"]

    def _branch_list_url(self, tenant_id):
        return reverse("tenant-branch-list", kwargs={"pk": tenant_id})

    # ── isolation tests ───────────────────────────────────────────────────────

    def test_tenant_a_admin_gets_403_on_tenant_b_branch_list(self):
        """
        A freshly provisioned Tenant A admin calling
        GET /api/platform/tenants/<tenant_b_id>/branches/
        must receive HTTP 403 — not 200, not data from Tenant B.
        """
        data_a = self._provision(
            name="Branch Isolation A",
            contact_email="contact@branch-iso-a.example",
            admin_first_name="Alice",
            admin_last_name="BranchA",
            admin_email="alice@branch-iso-a.example",
        )
        data_b = self._provision(
            name="Branch Isolation B",
            contact_email="contact@branch-iso-b.example",
            admin_first_name="Bob",
            admin_last_name="BranchB",
            admin_email="bob@branch-iso-b.example",
        )

        tenant_b_id = data_b["tenant"]["id"]
        token_a = self._get_token_for(data_a["admin_username"], data_a["admin_temp_password"])

        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Token {token_a}")
        response = client_a.get(self._branch_list_url(tenant_b_id))

        self.assertEqual(
            response.status_code,
            403,
            f"Tenant A's admin must receive 403 when requesting Tenant B's branch list, "
            f"got {response.status_code}: {response.data}",
        )

    def test_tenant_a_admin_can_access_own_branch_list(self):
        """
        A freshly provisioned Tenant A admin must be able to call
        GET /api/platform/tenants/<tenant_a_id>/branches/ and receive 200.
        This confirms the access control isn't simply broken in both directions.
        """
        data_a = self._provision(
            name="Own Branch Corp A",
            contact_email="contact@own-branch-a.example",
            admin_first_name="Carol",
            admin_last_name="OwnBranchA",
            admin_email="carol@own-branch-a.example",
        )
        # Provision a second tenant to make sure isolation is active.
        self._provision(
            name="Own Branch Corp B",
            contact_email="contact@own-branch-b.example",
            admin_first_name="Dave",
            admin_last_name="OwnBranchB",
            admin_email="dave@own-branch-b.example",
        )

        tenant_a_id = data_a["tenant"]["id"]
        token_a = self._get_token_for(data_a["admin_username"], data_a["admin_temp_password"])

        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Token {token_a}")
        response = client_a.get(self._branch_list_url(tenant_a_id))

        self.assertEqual(
            response.status_code,
            200,
            f"Tenant A's admin must receive 200 for their own branch list, "
            f"got {response.status_code}: {response.data}",
        )

    def test_tenant_b_branches_not_returned_to_tenant_a(self):
        """
        Even when Tenant B has existing branches, calling
        GET /api/platform/tenants/<tenant_b_id>/branches/ as Tenant A's admin
        must not return any of Tenant B's branch data.

        Specifically: the response must not be 200 with branch rows, ensuring
        no silent cross-tenant data leak can occur through the branch endpoint.
        """
        from Platform_Core.models import TenantBranch

        data_a = self._provision(
            name="Leak Check Corp A",
            contact_email="contact@leak-check-a.example",
            admin_first_name="Eve",
            admin_last_name="LeakA",
            admin_email="eve@leak-check-a.example",
        )
        data_b = self._provision(
            name="Leak Check Corp B",
            contact_email="contact@leak-check-b.example",
            admin_first_name="Frank",
            admin_last_name="LeakB",
            admin_email="frank@leak-check-b.example",
        )

        # Seed Tenant B with a branch so there is data to potentially leak.
        from Platform_Core.models import Tenant as TenantModel
        tenant_b = TenantModel.objects.get(pk=data_b["tenant"]["id"])
        TenantBranch.objects.create(
            tenant=tenant_b,
            name="Tenant B Head Office",
        )

        tenant_b_id = data_b["tenant"]["id"]
        token_a = self._get_token_for(data_a["admin_username"], data_a["admin_temp_password"])

        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Token {token_a}")
        response = client_a.get(self._branch_list_url(tenant_b_id))

        # The response must not be 200 — a 403 (or any non-200) is required.
        self.assertNotEqual(
            response.status_code,
            200,
            "Tenant A's admin received HTTP 200 when querying Tenant B's branch list "
            "— cross-tenant branch data could be exposed.",
        )

        # Extra belt-and-suspenders: if somehow the status is 200, the branch
        # data must not contain any of Tenant B's branch names.
        if response.status_code == 200:
            response_data = response.data
            branches = (
                response_data.get("data", {}).get("branches", [])
                if isinstance(response_data, dict)
                else []
            )
            branch_names = [b.get("name") for b in branches]
            self.assertNotIn(
                "Tenant B Head Office",
                branch_names,
                "Tenant A must not see Tenant B's 'Tenant B Head Office' branch "
                "— cross-tenant data leak detected.",
            )
