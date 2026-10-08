from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantSettings, TenantUserProfile


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
