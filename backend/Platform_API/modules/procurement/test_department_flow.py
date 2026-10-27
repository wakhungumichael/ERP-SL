from datetime import date
from decimal import Decimal
from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import Account, OrganizationMembership, Tenant
from SL_Budgeting.models import Budget, BudgetCommitment, BudgetLine
from SL_Procurement.models import ApprovalMatrix, Bill, Department, ProcurementPolicy, PurchaseOrder, Requisition
from SL_Sales.models import SalesOrder


class DepartmentFlowTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='Budget Company', code='dept-test')
        self.worker = User.objects.create_user('requester')
        self.head = User.objects.create_user('head')
        self.approver = User.objects.create_user('finance-approver')
        self.admin = User.objects.create_user('proc-admin')
        for user in [self.worker, self.head, self.approver, self.admin]:
            OrganizationMembership.objects.create(user=user, tenant=self.tenant, is_default=True, is_org_admin=user==self.admin)
        employee_group = Group.objects.create(name='Requester')
        employee_group.permissions.set(Permission.objects.filter(content_type__app_label='SL_Procurement', codename__in=['add_requisition', 'change_requisition']))
        self.worker.groups.add(employee_group)
        self.finance = Group.objects.create(name='Finance review')
        self.finance.permissions.set(Permission.objects.filter(content_type__app_label='SL_Procurement', codename__in=['approve_requisition', 'add_purchaseorder']))
        self.approver.groups.add(self.finance)
        self.department = Department.objects.create(tenant=self.tenant, name='Sales', code='SALES', head=self.head)
        self.department.members.add(self.worker)
        account = Account.objects.create(tenant=self.tenant, code='6000', name='Sales expense', account_type='expense')
        budget = Budget.objects.create(tenant=self.tenant, name='2026 sales budget', code='BUD-26', start_date='2026-01-01', end_date='2026-12-31', status='active', currency='KES')
        self.line = BudgetLine.objects.create(budget=budget, account=account, cost_center='SALES', period_year=2026, allocated_amount=1000)
        ProcurementPolicy.objects.create(tenant=self.tenant, approval_source='matrix')
        self.rule = ApprovalMatrix.objects.create(tenant=self.tenant, name='Finance', approval_group=self.finance)
        self.client = APIClient()
        self.client.force_authenticate(self.worker)

    def request(self, amount=100, **kwargs):
        response = self.client.post('/api/procurement/requisitions/', dict(title='Customer materials', department=self.department.pk, request_kind='individual', budget_line=self.line.pk, cost_center='SALES', needed_by='2026-11-02', lines=[dict(description='Materials', quantity='1', unit_price=str(amount))]) | kwargs, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        pk = response.data['id']
        response = self.client.patch(f'/api/procurement/requisitions/{pk}/status/', {'status': 'submitted'}, format='json')
        return pk, response

    def head_approve(self, pk):
        self.client.force_authenticate(self.head)
        response = self.client.post(f'/api/procurement/requisitions/{pk}/department-review/', {'decision': 'approve'})
        self.assertEqual(response.status_code, 200, response.data)

    def consolidate(self, ids):
        self.client.force_authenticate(self.head)
        return self.client.post('/api/procurement/requisitions/consolidate/', {'requests': ids}, format='json')

    def test_individual_head_consolidation_higher_approval_and_po_budget_flow(self):
        first, response = self.request(100)
        self.assertEqual(response.status_code, 200, response.data)
        second, response = self.request(150)
        self.assertFalse(BudgetCommitment.objects.exists())
        self.head_approve(first)
        self.head_approve(second)
        response = self.consolidate([first, second])
        self.assertEqual(response.status_code, 201, response.data)
        parent = response.data['id']
        self.assertEqual(Decimal(response.data['estimated_total']), 250)
        response = self.client.patch(f'/api/procurement/requisitions/{parent}/status/', {'status': 'submitted'})
        self.assertEqual(response.status_code, 200, response.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.committed_amount, 250)
        self.assertEqual(BudgetCommitment.objects.count(), 1)
        self.assertEqual(self.client.post('/api/procurement/requisitions/consolidate/', {'requests': [first]}, format='json').status_code, 400)
        self.client.force_authenticate(self.approver)
        response = self.client.post(f'/api/procurement/requisitions/{parent}/approval-action/', {'decision': 'approve'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'approved')
        response = self.client.post(f'/api/procurement/requisitions/{parent}/convert-to-order/', {'supplier_name': 'Supplier'})
        self.assertEqual(response.status_code, 201, response.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.committed_amount, 0)
        self.assertEqual(self.line.obligated_amount, 250)
        repeat = self.client.post(f'/api/procurement/requisitions/{parent}/convert-to-order/', {'supplier_name': 'Supplier'})
        self.assertEqual(repeat.status_code, 200)
        self.line.refresh_from_db()
        self.assertEqual(self.line.obligated_amount, 250)

    def test_individual_cannot_bypass_head_or_create_po(self):
        pk, response = self.request()
        self.assertEqual(self.client.patch(f'/api/procurement/requisitions/{pk}/status/', {'status': 'approved'}).status_code, 400)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f'/api/procurement/requisitions/{pk}/convert-to-order/', {'supplier_name': 'Supplier'}).status_code, 400)
        self.assertEqual(self.client.post(f'/api/procurement/requisitions/{pk}/department-review/', {'decision': 'approve'}).status_code, 403)

    def test_insufficient_budget_and_missing_budget_block_submission(self):
        pk, response = self.request(1001)
        self.assertEqual(response.status_code, 400)
        pk, response = self.request(100, budget_line=None, gl_account=None)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(BudgetCommitment.objects.exists())

    def test_rejection_releases_reserved_budget(self):
        pk, response = self.request(200)
        self.head_approve(pk)
        parent = self.consolidate([pk]).data['id']
        self.client.patch(f'/api/procurement/requisitions/{parent}/status/', {'status': 'submitted'})
        self.client.force_authenticate(self.approver)
        response = self.client.post(f'/api/procurement/requisitions/{parent}/approval-action/', {'decision': 'reject'})
        self.assertEqual(response.status_code, 200, response.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.committed_amount, 0)
        self.assertEqual(BudgetCommitment.objects.get().state, 'released')

    def test_rules_can_edit_deactivate_and_delete_without_erasing_past_decisions(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f'/api/procurement/approval-matrix/{self.rule.pk}/', {'name': 'New finance route', 'is_active': False})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['is_active'])
        self.assertEqual(self.client.delete(f'/api/procurement/approval-matrix/{self.rule.pk}/').status_code, 204)
        self.client.force_authenticate(self.worker)
        self.assertEqual(self.client.post('/api/procurement/approval-matrix/', {'name': 'Unauthorized'}).status_code, 403)

    def test_no_active_rules_fail_closed_and_cannot_resubmit_pending(self):
        pk, response = self.request()
        self.head_approve(pk)
        parent = self.consolidate([pk]).data['id']
        self.rule.is_active = False
        self.rule.save()
        response = self.client.patch(f'/api/procurement/requisitions/{parent}/status/', {'status': 'submitted'})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(BudgetCommitment.objects.exists())

    def test_foreign_budget_and_non_department_member_cannot_create_request(self):
        other = User.objects.create_user('nonmember')
        OrganizationMembership.objects.create(user=other, tenant=self.tenant, is_default=True)
        other.groups.add(self.worker.groups.first())
        self.client.force_authenticate(other)
        response = self.client.post('/api/procurement/requisitions/', dict(title='Hidden', department=self.department.pk, request_kind='individual', cost_center='SALES', budget_line=self.line.pk), format='json')
        self.assertEqual(response.status_code, 403)

    def test_partial_bills_actualize_only_billed_amount_and_do_not_double_count(self):
        from Platform_API.modules.purchases.views import _actualize_budget_from_bill
        po = PurchaseOrder.objects.create(tenant=self.tenant, reference='PARTIAL-PO', supplier_name='Supplier', order_date='2026-11-01', total_amount=250)
        BudgetCommitment.objects.create(tenant=self.tenant, budget_line=self.line, source_type='purchase_order', source_reference=po.reference, state='obligated', amount=250)
        self.line.obligated_amount = 250
        self.line.save()
        first = Bill.objects.create(tenant=self.tenant, purchase_order=po, bill_number='PARTIAL1', total=100, status='approved')
        second = Bill.objects.create(tenant=self.tenant, purchase_order=po, bill_number='PARTIAL2', total=150, status='approved')
        self.assertTrue(_actualize_budget_from_bill(first))
        self.line.refresh_from_db()
        self.assertEqual((self.line.obligated_amount, self.line.actual_amount), (150, 100))
        self.assertTrue(_actualize_budget_from_bill(second))
        self.assertTrue(_actualize_budget_from_bill(first))
        self.line.refresh_from_db()
        self.assertEqual((self.line.obligated_amount, self.line.actual_amount), (0, 250))

    def test_staff_cannot_use_standard_request_to_bypass_department_head(self):
        response = self.client.post('/api/procurement/requisitions/', dict(title='Bypass', request_kind='standard', cost_center='SALES', budget_line=self.line.pk), format='json')
        self.assertEqual(response.status_code, 403)

    def test_configured_deputy_can_review_consolidate_and_submit(self):
        deputy = User.objects.create_user('department-deputy')
        OrganizationMembership.objects.create(user=deputy, tenant=self.tenant, is_default=True)
        self.department.deputy = deputy
        self.department.save()
        pk, response = self.request(100)
        self.client.force_authenticate(deputy)
        response = self.client.post(f'/api/procurement/requisitions/{pk}/department-review/', {'decision': 'approve'})
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post('/api/procurement/requisitions/consolidate/', {'requests': [pk]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        parent = response.data['id']
        response = self.client.patch(f'/api/procurement/requisitions/{parent}/status/', {'status': 'submitted'})
        self.assertEqual(response.status_code, 200, response.data)
        profile = self.client.get('/api/platform/auth/me/').data['data']
        self.assertIn('SL_Procurement.view_requisition', profile['permissions'])
        self.assertTrue(profile['departments'][0]['is_deputy'])
