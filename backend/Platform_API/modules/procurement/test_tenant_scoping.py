from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Account, Tenant, TenantUserProfile
from SL_Procurement.models import PurchaseOrder, Requisition
from SL_Weighbridge.models import Branch, Company


def _make_tenant(name, code):
    return Tenant.objects.create(name=name, code=code, is_active=True, status="active")


def _make_tenant_user(username, tenant):
    user = User.objects.create_user(username=username, password="pass", is_staff=True)
    TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=True)
    return user


def _make_branch(tenant, suffix):
    company = Company.objects.create(
        tenant=tenant,
        name=f"Company {suffix}",
        address="Road 1",
        email=f"{suffix}@company.test",
        phone=f"+2547000{suffix}1",
    )
    return Branch.objects.create(
        tenant=tenant,
        company=company,
        name=f"Branch {suffix}",
        address="Road 1",
        email=f"{suffix}@branch.test",
        phone=f"+2547000{suffix}2",
    )


class ProcurementTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Procurement Tenant A", "procurement-a")
        self.tenant_b = _make_tenant("Procurement Tenant B", "procurement-b")
        self.user_a = _make_tenant_user("procurement_admin_a", self.tenant_a)
        self.client.force_authenticate(self.user_a)

        self.branch_a = _make_branch(self.tenant_a, "a")
        self.branch_b = _make_branch(self.tenant_b, "b")
        self.gl_account_a = Account.objects.create(
            tenant=self.tenant_a,
            code="5100-A",
            name="Tenant A Expense",
            account_type="expense",
        )
        self.gl_account_b = Account.objects.create(
            tenant=self.tenant_b,
            code="5100-B",
            name="Tenant B Expense",
            account_type="expense",
        )
        self.requisition_b = Requisition.objects.create(
            tenant=self.tenant_b,
            branch=self.branch_b,
            requested_by=_make_tenant_user("procurement_owner_b", self.tenant_b),
            title="Other tenant requisition",
            description="Hidden",
            cost_center="OPS-B",
            gl_account=self.gl_account_b,
            currency="KES",
        )
        self.purchase_order_b = PurchaseOrder.objects.create(
            tenant=self.tenant_b,
            branch=self.branch_b,
            requisition=self.requisition_b,
            reference="PO-B-0001",
            supplier_name="Other Supplier",
            status="Draft",
            order_date="2026-08-13",
            gl_account=self.gl_account_b,
            currency="KES",
            created_by=self.requisition_b.requested_by,
        )

    def test_requisition_create_rejects_other_tenant_branch_and_gl_account(self):
        response = self.client.post(
            reverse("procurement-requisitions"),
            {
                "branch": self.branch_b.id,
                "title": "Cross tenant requisition",
                "description": "Should fail",
                "cost_center": "OPS-A",
                "gl_account": self.gl_account_b.id,
                "currency": "KES",
                "lines": [
                    {
                        "description": "Paper",
                        "quantity": "1.000",
                        "unit_price": "100.00",
                        "gl_account": self.gl_account_b.id,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("branch", response.data)
        self.assertIn("gl_account", response.data)
        self.assertIn("lines[0].gl_account", response.data)

    def test_purchase_order_create_rejects_other_tenant_requisition(self):
        response = self.client.post(
            reverse("procurement-orders"),
            {
                "branch": self.branch_a.id,
                "requisition": self.requisition_b.id,
                "supplier_name": "Tenant A Supplier",
                "status": "Draft",
                "order_date": "2026-08-13",
                "gl_account": self.gl_account_a.id,
                "currency": "KES",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("requisition", response.data)

    def test_goods_receipt_create_rejects_other_tenant_purchase_order(self):
        response = self.client.post(
            reverse("procurement-receipts"),
            {
                "branch": self.branch_a.id,
                "purchase_order": self.purchase_order_b.id,
                "received_date": "2026-08-13",
                "status": "received",
                "notes": "Should fail",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("purchase_order", response.data)
