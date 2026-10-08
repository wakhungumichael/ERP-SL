from django.contrib.auth.models import Permission, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile


class CustomerStatementPermissionTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Statement Permission Tenant",
            code="statement-permission-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(username="customer_only_user", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=False,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse("customer-statement", kwargs={"customer_id": 999999})

    def test_customer_access_does_not_imply_statement_access(self):
        view_customer = Permission.objects.get(
            content_type__app_label="SL_Weighbridge",
            codename="view_customer",
        )
        self.user.user_permissions.add(view_customer)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403, response.data)

    def test_explicit_statement_permission_allows_endpoint(self):
        permission = Permission.objects.get(
            content_type__app_label="SL_Sales",
            codename="can_view_customer_statements",
        )
        self.user.user_permissions.add(permission)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404, response.data)

    def test_tenant_admin_retains_statement_access(self):
        profile = self.user.tenant_profile
        profile.is_tenant_admin = True
        profile.save(update_fields=["is_tenant_admin", "updated_at"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404, response.data)


class SalesCustomerPermissionTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Sales Customer Permission Tenant",
            code="sales-customer-permission-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(username="sales_customer_user", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=False,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_sales_customer_permission_does_not_grant_weighbridge_access(self):
        permission = Permission.objects.get(
            content_type__app_label="SL_Sales",
            codename="view_salescustomer",
        )
        self.user.user_permissions.add(permission)

        self.assertEqual(self.client.get(reverse("sales-customers")).status_code, 200)
        self.assertEqual(self.client.get(reverse("wb-customers")).status_code, 403)

    def test_weighbridge_customer_permission_does_not_grant_sales_access(self):
        permission = Permission.objects.get(
            content_type__app_label="SL_Weighbridge",
            codename="view_customer",
        )
        self.user.user_permissions.add(permission)

        self.assertEqual(self.client.get(reverse("wb-customers")).status_code, 200)
        self.assertEqual(self.client.get(reverse("sales-customers")).status_code, 403)
