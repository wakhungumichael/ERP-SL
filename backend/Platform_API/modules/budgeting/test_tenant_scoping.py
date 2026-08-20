import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Account, FinancialYear, Tenant, TenantBranch, TenantUserProfile


class BudgetingTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = Tenant.objects.create(
            name="Budget Tenant A",
            code="budget-a",
            is_active=True,
            status="active",
        )
        self.tenant_b = Tenant.objects.create(
            name="Budget Tenant B",
            code="budget-b",
            is_active=True,
            status="active",
        )
        self.user_a = User.objects.create_user("budget_admin_a", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user_a, tenant=self.tenant_a, is_tenant_admin=True)
        self.client.force_authenticate(self.user_a)

        self.branch_a = TenantBranch.objects.create(tenant=self.tenant_a, name="Branch A")
        self.branch_b = TenantBranch.objects.create(tenant=self.tenant_b, name="Branch B")
        self.year_a = FinancialYear.objects.create(
            tenant=self.tenant_a,
            name="FY A",
            code="FYA",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status="open",
        )
        self.year_b = FinancialYear.objects.create(
            tenant=self.tenant_b,
            name="FY B",
            code="FYB",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status="open",
        )
        self.account_a = Account.objects.create(
            tenant=self.tenant_a,
            code="5100-A",
            name="Tenant A Budget Account",
            account_type="expense",
        )
        self.account_b = Account.objects.create(
            tenant=self.tenant_b,
            code="5100-B",
            name="Tenant B Budget Account",
            account_type="expense",
        )

    def test_budget_create_rejects_other_tenant_relations(self):
        response = self.client.post(
            reverse("budget-list"),
            {
                "branch": self.branch_b.id,
                "financial_year": self.year_b.id,
                "name": "Cross Tenant Budget",
                "code": "BUD-X",
                "period_type": "annual",
                "status": "draft",
                "control_mode": "hard",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
                "currency": "KES",
                "lines": [
                    {
                        "account": self.account_b.id,
                        "cost_center": "OPS",
                        "period_year": 2026,
                        "allocated_amount": "1000.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("branch", response.data)
        self.assertIn("financial_year", response.data)
        self.assertIn("lines[0].account", response.data)
