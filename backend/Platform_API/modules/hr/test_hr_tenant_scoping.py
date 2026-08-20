from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import OrganizationMembership, Tenant
from SL_HR.models import PayPeriod, PayRecord


def _make_tenant(name, code):
    return Tenant.objects.create(name=name, code=code, is_active=True, status="active")


def _make_org_user(username, tenant, *, admin=False):
    user = User.objects.create_user(username=username, password="pass", is_staff=True)
    OrganizationMembership.objects.create(
        user=user,
        tenant=tenant,
        role="owner" if admin else "member",
        role_group_name="Tenant Admin" if admin else "",
        is_org_admin=admin,
        is_default=True,
        is_active=True,
    )
    return user


class HRTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Tenant A HR", "tenant-a-hr")
        self.tenant_b = _make_tenant("Tenant B HR", "tenant-b-hr")
        self.admin_a = _make_org_user("hr_admin_a", self.tenant_a, admin=True)
        self.user_a = _make_org_user("staff_a", self.tenant_a)
        self.user_b = _make_org_user("staff_b", self.tenant_b)

        self.period_a = PayPeriod.objects.create(
            tenant=self.tenant_a,
            name="July 2026",
            period_start="2026-07-01",
            period_end="2026-07-31",
            status="Draft",
        )
        self.period_b = PayPeriod.objects.create(
            tenant=self.tenant_b,
            name="August 2026",
            period_start="2026-08-01",
            period_end="2026-08-31",
            status="Completed",
        )
        PayRecord.objects.create(period=self.period_a, employee=self.user_a, net_pay=1000)
        PayRecord.objects.create(period=self.period_b, employee=self.user_b, net_pay=2000)

        self.client.force_authenticate(self.admin_a)

    def test_hr_period_list_returns_only_current_tenant_periods(self):
        response = self.client.get(reverse("hr-pay-periods"))

        self.assertEqual(response.status_code, 200, response.data)
        result_ids = {row["id"] for row in response.data["results"]}
        self.assertEqual(result_ids, {self.period_a.id})

    def test_hr_period_detail_excludes_other_tenant_records(self):
        response = self.client.get(reverse("hr-pay-period-detail", kwargs={"pk": self.period_b.pk}))

        self.assertEqual(response.status_code, 404, response.data)

    def test_hr_dashboard_counts_only_current_tenant_members(self):
        response = self.client.get(reverse("hr-dashboard"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["staff"]["total"], 2)
        self.assertEqual(response.data["staff"]["active"], 2)
        self.assertEqual(response.data["payroll"]["total_periods"], 1)
        self.assertEqual(response.data["payroll"]["total_net_last"], 1000.0)

    def test_hr_auto_populate_only_creates_records_for_same_tenant(self):
        response = self.client.post(
            reverse("hr-pay-periods"),
            {
                "name": "September 2026",
                "period_start": "2026-09-01",
                "period_end": "2026-09-30",
                "status": "Draft",
                "auto_populate": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        period = PayPeriod.objects.get(pk=response.data["id"])
        employee_ids = set(period.records.values_list("employee_id", flat=True))
        self.assertEqual(employee_ids, {self.admin_a.id, self.user_a.id})
        self.assertNotIn(self.user_b.id, employee_ids)
