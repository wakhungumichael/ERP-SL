from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch

from Platform_Core.models import ModuleDefinition, Tenant, TenantModuleActivation, TenantSettings, TenantUserProfile
from Platform_API.modules.platform.views import (
    PROTECTED_PERMISSION_APP_LABELS,
    TENANT_MANAGEABLE_PLATFORM_CORE_MODELS,
    TENANT_PERMISSION_MODULE_SLUGS,
)
from Platform_API.modules.shared_serializers import tenant_role_prefix


def _make_tenant(name, code):
    return Tenant.objects.create(name=name, code=code, is_active=True, status="active")


def _make_tenant_admin(username, tenant):
    user = User.objects.create_user(username=username, password="pass", is_staff=True)
    TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=True)
    tenant_admin_group, _ = Group.objects.get_or_create(name="Tenant Admin")
    user.groups.add(tenant_admin_group)
    return user


def _make_tenant_user(username, tenant):
    user = User.objects.create_user(username=username, password="pass", is_staff=True)
    TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=False)
    return user


def _first_tenant_permission():
    return Permission.objects.exclude(
        content_type__app_label__in=PROTECTED_PERMISSION_APP_LABELS
    ).order_by("id").first()


def _first_protected_permission():
    return Permission.objects.filter(content_type__app_label__in=PROTECTED_PERMISSION_APP_LABELS).exclude(
        content_type__app_label="Platform_Core",
        content_type__model__in=TENANT_MANAGEABLE_PLATFORM_CORE_MODELS,
    ).order_by("id").first()


class TenantRoleManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Tenant A", "tenant-a")
        self.tenant_b = _make_tenant("Tenant B", "tenant-b")
        for module_slug in sorted({slug for slugs in TENANT_PERMISSION_MODULE_SLUGS.values() for slug in slugs}):
            module, _ = ModuleDefinition.objects.get_or_create(
                slug=module_slug,
                defaults={"name": module_slug.replace("-", " ").title(), "is_active": True},
            )
            TenantModuleActivation.objects.get_or_create(tenant=self.tenant_a, module=module, defaults={"status": "enabled"})
        self.tenant_admin_a = _make_tenant_admin("tenant_admin_a", self.tenant_a)
        self.tenant_admin_b = _make_tenant_admin("tenant_admin_b", self.tenant_b)
        self.regular_user_a = _make_tenant_user("user_a", self.tenant_a)
        self.other_user_b = _make_tenant_user("user_b", self.tenant_b)
        self.finance_group, _ = Group.objects.get_or_create(name="Finance")
        self.operator_group, _ = Group.objects.get_or_create(name="Operator")
        self.custom_role_a = Group.objects.create(name=f"{tenant_role_prefix(self.tenant_a.id)}Dispatch Supervisor")
        self.custom_role_b = Group.objects.create(name=f"{tenant_role_prefix(self.tenant_b.id)}Yard Lead")

    def test_tenant_admin_sees_shared_and_own_custom_roles_only(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.get(reverse("platform-role-list"))

        self.assertEqual(response.status_code, 200, response.data)
        results = response.data.get("results", response.data)
        returned_names = {item["name"] for item in results}
        returned_display_names = {item["display_name"] for item in results}

        self.assertIn("Finance", returned_names)
        self.assertIn("Operator", returned_names)
        self.assertIn(self.custom_role_a.name, returned_names)
        self.assertNotIn("Tenant Admin", returned_names)
        self.assertNotIn(self.custom_role_b.name, returned_names)
        self.assertIn("Dispatch Supervisor", returned_display_names)

    def test_tenant_admin_can_create_tenant_scoped_custom_role(self):
        self.client.force_authenticate(user=self.tenant_admin_a)
        permission = _first_tenant_permission()
        self.assertIsNotNone(permission, "Expected at least one tenant-manageable permission to exist.")

        response = self.client.post(
            reverse("platform-role-list"),
            {"name": "Inventory Clerk", "permission_ids": [permission.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        role = Group.objects.get(pk=response.data["id"])
        self.assertEqual(role.name, f"{tenant_role_prefix(self.tenant_a.id)}Inventory Clerk")
        self.assertEqual(response.data["display_name"], "Inventory Clerk")
        self.assertIn(permission.id, list(role.permissions.values_list("id", flat=True)))

    def test_tenant_admin_cannot_change_shared_role_permissions(self):
        self.client.force_authenticate(user=self.tenant_admin_a)
        permission = _first_tenant_permission()
        self.assertIsNotNone(permission, "Expected at least one tenant-manageable permission to exist.")

        response = self.client.patch(
            reverse("platform-role-detail", kwargs={"pk": self.finance_group.pk}),
            {"permission_ids": [permission.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("Only platform administrators may modify", str(response.data))

    def test_tenant_admin_cannot_assign_or_edit_tenant_admin_roles(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.post(
            reverse("platform-user-assign-roles", kwargs={"pk": self.tenant_admin_a.pk}),
            {"group_ids": [self.finance_group.pk], "replace_existing": True},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("Only platform administrators may change a tenant administrator's roles", str(response.data))

    def test_tenant_admin_can_assign_only_own_tenant_roles_to_regular_user(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.post(
            reverse("platform-user-assign-roles", kwargs={"pk": self.regular_user_a.pk}),
            {"group_ids": [self.finance_group.pk, self.custom_role_a.pk], "replace_existing": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.regular_user_a.refresh_from_db()
        assigned_ids = set(self.regular_user_a.groups.values_list("id", flat=True))
        self.assertEqual(assigned_ids, {self.finance_group.pk, self.custom_role_a.pk})

    def test_tenant_admin_cannot_assign_other_tenant_custom_role(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.post(
            reverse("platform-user-assign-roles", kwargs={"pk": self.regular_user_a.pk}),
            {"group_ids": [self.custom_role_b.pk], "replace_existing": True},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("do not have permission to assign", str(response.data))

    def test_invite_assigns_existing_tenant_custom_role(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.post(
            reverse("tenant-user-invite", kwargs={"pk": self.tenant_a.pk}),
            {
                "first_name": "New",
                "last_name": "Dispatcher",
                "email": "new.dispatcher@example.com",
                "role_group": self.custom_role_a.name,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        invited = User.objects.get(email="new.dispatcher@example.com")
        self.assertEqual(list(invited.groups.values_list("id", flat=True)), [self.custom_role_a.id])
        self.assertFalse(response.data["data"]["email_sent"])

    def test_invite_sends_credentials_using_tenant_smtp(self):
        self.client.force_authenticate(user=self.tenant_admin_a)
        TenantSettings.objects.create(
            tenant=self.tenant_a,
            support_email="support@tenant-a.example",
            smtp_host="mail.tenant-a.example",
            smtp_port=465,
            smtp_user="support@tenant-a.example",
            smtp_password="mail-secret",
            smtp_use_tls=False,
            smtp_use_ssl=True,
        )

        with patch("django.core.mail.message.EmailMessage.send", return_value=1) as send:
            response = self.client.post(
                reverse("tenant-user-invite", kwargs={"pk": self.tenant_a.pk}),
                {
                    "first_name": "Emailed",
                    "last_name": "User",
                    "email": "emailed.user@example.com",
                    "role_group": self.custom_role_a.name,
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["data"]["email_sent"])
        self.assertEqual(response.data["data"]["email_error"], "")
        send.assert_called_once_with(fail_silently=False)

    def test_invite_rejects_role_owned_by_another_tenant(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.post(
            reverse("tenant-user-invite", kwargs={"pk": self.tenant_a.pk}),
            {
                "first_name": "Wrong",
                "email": "wrong.role@example.com",
                "role_group": self.custom_role_b.name,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(User.objects.filter(email="wrong.role@example.com").exists())

    def test_tenant_admin_permission_catalog_excludes_protected_apps(self):
        self.client.force_authenticate(user=self.tenant_admin_a)
        protected_permission = _first_protected_permission()
        allowed_permission = _first_tenant_permission()
        self.assertIsNotNone(protected_permission, "Expected a protected permission to exist.")
        self.assertIsNotNone(allowed_permission, "Expected an allowed permission to exist.")

        response = self.client.get(reverse("platform-permission-list"))

        self.assertEqual(response.status_code, 200, response.data)
        permission_ids = {item["id"] for item in response.data}
        self.assertIn(allowed_permission.id, permission_ids)
        self.assertNotIn(protected_permission.id, permission_ids)

    def test_permission_catalog_includes_unlicensed_tenant_modules_for_role_templates(self):
        self.client.force_authenticate(user=self.tenant_admin_b)

        response = self.client.get(reverse("platform-permission-list"))

        self.assertEqual(response.status_code, 200, response.data)
        app_labels = {item["content_type"]["app_label"] for item in response.data}
        self.assertTrue({"SL_CRM", "SL_HR", "SL_Inventory", "SL_Procurement", "SL_Sales", "SL_Ticketing"}.issubset(app_labels))

    def test_permission_catalog_includes_tenant_accounting_but_not_saas_control(self):
        self.client.force_authenticate(user=self.tenant_admin_a)

        response = self.client.get(reverse("platform-permission-list"))

        self.assertEqual(response.status_code, 200, response.data)
        core_models = {
            item["content_type"]["model"]
            for item in response.data
            if item["content_type"]["app_label"] == "Platform_Core"
        }
        self.assertIn("journalentry", core_models)
        self.assertNotIn("tenant", core_models)
        self.assertNotIn("subscriptionplan", core_models)
        codenames = {item["codename"] for item in response.data}
        self.assertIn("can_access_finance_workspace", codenames)
        self.assertIn("can_view_erp_reports", codenames)
        self.assertIn("can_view_weighbridge_overview", codenames)
        self.assertIn("can_view_crm_overview", codenames)
