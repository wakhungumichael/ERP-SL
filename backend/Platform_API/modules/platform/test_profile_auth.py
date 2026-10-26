# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import OrganizationMembership, Tenant, TenantSettings, TenantUserProfile


class ProfileAuthenticationTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Profile Tenant",
            code="profile-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(
            username="profile-user",
            email="profile@example.test",
            first_name="Old",
            last_name="Name",
            password="CurrentPass123",
        )
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_user_can_update_own_profile_details(self):
        response = self.client.patch(
            reverse("platform-auth-me"),
            {
                "first_name": "New",
                "last_name": "Name",
                "email": "new-profile@example.test",
                "username": "new-profile-user",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "New")
        self.assertEqual(self.user.email, "new-profile@example.test")
        self.assertEqual(self.user.username, "new-profile-user")

    def test_user_can_change_password_only_with_current_password(self):
        denied = self.client.post(
            reverse("platform-auth-change-password"),
            {
                "current_password": "wrong-password",
                "new_password": "NewSecurePass123",
                "new_password_confirmation": "NewSecurePass123",
            },
            format="json",
        )
        self.assertEqual(denied.status_code, 400)

        allowed = self.client.post(
            reverse("platform-auth-change-password"),
            {
                "current_password": "CurrentPass123",
                "new_password": "NewSecurePass123",
                "new_password_confirmation": "NewSecurePass123",
            },
            format="json",
        )
        self.assertEqual(allowed.status_code, 200, allowed.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewSecurePass123"))

    def test_failed_reset_email_does_not_change_the_password(self):
        TenantSettings.objects.create(
            tenant=self.tenant,
            smtp_host="smtp.example.test",
            smtp_user="mailer@example.test",
        )
        self.client.force_authenticate(user=None)

        with patch("django.core.mail.EmailMessage.send", side_effect=RuntimeError("SMTP unavailable")):
            response = self.client.post(
                reverse("platform-auth-forgot-password"),
                {"identifier": self.user.email, "tenant_code": self.tenant.code},
                format="json",
            )

        self.assertEqual(response.status_code, 502)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("CurrentPass123"))

    def test_tenant_login_selects_the_organization_from_the_login_url(self):
        second_tenant = Tenant.objects.create(
            name="Second Tenant",
            code="second-tenant",
            is_active=True,
            status="active",
        )
        OrganizationMembership.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_default=True,
            is_active=True,
        )
        selected_membership = OrganizationMembership.objects.create(
            user=self.user,
            tenant=second_tenant,
            is_default=False,
            is_active=True,
        )
        self.client.force_authenticate(user=None)

        response = self.client.post(
            reverse("platform-auth-token"),
            {
                "username": self.user.username,
                "password": "CurrentPass123",
                "tenant_code": second_tenant.code,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"]["user"]["tenant_id"], second_tenant.id)
        self.assertEqual(response.data["data"]["user"]["active_membership_id"], selected_membership.id)
        selected_membership.refresh_from_db()
        self.assertTrue(selected_membership.is_default)
        self.assertFalse(OrganizationMembership.objects.get(user=self.user, tenant=self.tenant).is_default)
        self.user.tenant_profile.refresh_from_db()
        self.assertEqual(self.user.tenant_profile.tenant_id, second_tenant.id)

    def test_tenant_login_rejects_an_organization_not_assigned_to_user(self):
        other_tenant = Tenant.objects.create(
            name="Other Tenant",
            code="other-tenant",
            is_active=True,
            status="active",
        )
        self.client.force_authenticate(user=None)

        response = self.client.post(
            reverse("platform-auth-token"),
            {
                "username": self.user.username,
                "password": "CurrentPass123",
                "tenant_code": other_tenant.code,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("tenant_code", response.data)
