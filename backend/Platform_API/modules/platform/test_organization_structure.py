from datetime import date
from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import Account, Department, OrganizationMembership, Tenant, TenantBranch, WorkflowDefinition, WorkflowInboxItem, WorkflowNodeDefinition
from Platform_Core.branch_sync import sync_tenant_branch_to_operational
from SL_Budgeting.models import Budget, BudgetLine
from SL_Procurement.models import ProcurementPolicy, Requisition


class OrganizationStructureTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='Structure organization', code='structure-tests')
        self.foreign = Tenant.objects.create(name='Other organization', code='structure-foreign')
        self.main = TenantBranch.objects.create(tenant=self.tenant, name='Main')
        self.west = TenantBranch.objects.create(tenant=self.tenant, name='West')
        self.foreign_branch = TenantBranch.objects.create(tenant=self.foreign, name='Other')
        self.admin = User.objects.create_user('structure-admin')
        self.worker = User.objects.create_user('structure-worker')
        self.head = User.objects.create_user('structure-head')
        self.outsider = User.objects.create_user('structure-outsider')
        self.foreign_user = User.objects.create_user('structure-foreign')
        OrganizationMembership.objects.create(tenant=self.tenant, user=self.admin, branch=self.main, is_default=True, is_org_admin=True)
        self.worker_membership = OrganizationMembership.objects.create(tenant=self.tenant, user=self.worker, branch=self.main, is_default=True)
        OrganizationMembership.objects.create(tenant=self.tenant, user=self.head, branch=self.main, is_default=True)
        OrganizationMembership.objects.create(tenant=self.tenant, user=self.outsider, branch=self.west, is_default=True)
        OrganizationMembership.objects.create(tenant=self.foreign, user=self.foreign_user, branch=self.foreign_branch, is_default=True)
        self.department = Department.objects.create(tenant=self.tenant, name='Sales', code='SALES', head=self.head)
        self.department.members.add(self.worker)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.unit_payload = {'name': 'Operations', 'code': 'OPS', 'head': self.head.pk, 'members': [self.worker.pk], 'branch_scope': 'selected', 'branches': [self.main.pk], 'access_mode': 'members'}

    def test_shared_department_is_the_same_model_used_by_procurement_and_hr(self):
        from SL_Procurement.models import Department as CompatibleDepartment
        from SL_HR.models import Employee
        self.assertIs(Department, CompatibleDepartment)
        self.assertIs(Requisition._meta.get_field('department').related_model, Department)
        self.assertIs(Employee._meta.get_field('department').related_model, Department)
        response = self.client.post('/api/platform/organization-units/', self.unit_payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        unit = Department.objects.get(pk=response.data['id'])
        self.assertEqual(unit.tenant_id, self.tenant.pk)
        self.assertEqual(list(unit.branches.values_list('pk', flat=True)), [self.main.pk])
        self.assertIn(unit.pk, [row['id'] for row in self.client.get('/api/procurement/setup/').data['departments']])

    def test_foreign_org_members_branches_and_parents_are_rejected(self):
        foreign_unit = Department.objects.create(tenant=self.foreign, name='Other', code='OTHER', head=self.foreign_user)
        for changes in [{'head': self.foreign_user.pk}, {'members': [self.foreign_user.pk]}, {'branches': [self.foreign_branch.pk]}, {'parent': foreign_unit.pk}]:
            with self.subTest(changes=changes):
                response = self.client.post('/api/platform/organization-units/', {**self.unit_payload, **changes}, format='json')
                self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.client.patch(f'/api/platform/organization-units/{foreign_unit.pk}/', {'name': 'Wrong'}, format='json').status_code, 404)

    def test_branch_restrictions_validate_members_and_require_a_branch(self):
        for changes in [{'branches': []}, {'head': self.outsider.pk}, {'members': [self.outsider.pk]}]:
            response = self.client.post('/api/platform/organization-units/', {**self.unit_payload, **changes}, format='json')
            self.assertEqual(response.status_code, 400, response.data)
        self.worker_membership.branches.add(self.west)
        response = self.client.post('/api/platform/organization-units/', {**self.unit_payload, 'branches': [self.main.pk, self.west.pk]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)

    def test_parent_hierarchy_cannot_cycle_and_generic_units_are_not_departments(self):
        division = self.client.post('/api/platform/organization-units/', {**self.unit_payload, 'name': 'Division', 'code': 'DIV', 'unit_type': 'division'}, format='json')
        self.assertEqual(division.status_code, 201, division.data)
        child = self.client.patch(f'/api/platform/organization-units/{self.department.pk}/', {'parent': division.data['id']}, format='json')
        self.assertEqual(child.status_code, 200, child.data)
        response = self.client.patch(f"/api/platform/organization-units/{division.data['id']}/", {'parent': self.department.pk}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        options = self.client.get('/api/procurement/setup/').data['departments']
        self.assertNotIn(division.data['id'], [row['id'] for row in options])

    def test_selected_read_only_role_cannot_use_another_roles_write_permission(self):
        viewer = Group.objects.create(name=f'tenant:{self.tenant.pk}:Structure viewer')
        editor = Group.objects.create(name=f'tenant:{self.tenant.pk}:Structure editor')
        viewer.permissions.set(Permission.objects.filter(content_type__app_label='Platform_Core', codename='view_department'))
        editor.permissions.set(Permission.objects.filter(content_type__app_label='Platform_Core', codename__in=['add_department', 'change_department']))
        self.worker.groups.add(viewer, editor)
        self.worker_membership.active_role_group_name = viewer.name
        self.worker_membership.save()
        self.client.force_authenticate(self.worker)
        self.assertTrue(self.client.get('/api/platform/organization-units/options/').data['permissions']['view'])
        self.assertFalse(self.client.get('/api/platform/organization-units/options/').data['permissions']['add'])
        self.assertEqual(self.client.post('/api/platform/organization-units/', self.unit_payload, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'/api/procurement/departments/{self.department.pk}/', {'name': 'Wrong'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch('/api/procurement/configuration/', {'approval_source': 'matrix'}, format='json').status_code, 403)

    def test_branch_and_member_scopes_are_inherited_from_parent_groupings(self):
        parent = Department.objects.create(tenant=self.tenant, name='Restricted division', code='RESTRICT', head=self.head, unit_type='division', branch_scope='selected', access_mode='members')
        parent.branches.add(self.main)
        parent.members.add(self.worker)
        self.department.parent = parent
        self.department.save()
        self.client.force_authenticate(self.worker)
        self.assertIn(self.department.pk, [row['id'] for row in self.client.get('/api/procurement/setup/').data['departments']])
        self.client.force_authenticate(self.outsider)
        self.assertNotIn(self.department.pk, [row['id'] for row in self.client.get('/api/procurement/setup/').data['departments']])

    def test_procurement_configuration_rejects_foreign_records_and_unpublished_workflows(self):
        foreign_unit = Department.objects.create(tenant=self.foreign, name='Other', code='OTHER', head=self.foreign_user)
        draft = WorkflowDefinition.objects.create(tenant=self.tenant, name='Draft', code='draft', entity_type='procurement_requisition')
        for payload in [{'branch_scope': 'selected', 'branches': []}, {'branches': [self.foreign_branch.pk]}, {'departments': [foreign_unit.pk]}, {'workflow': draft.pk}]:
            response = self.client.patch('/api/procurement/configuration/', payload, format='json')
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.patch('/api/procurement/configuration/', {'branch_scope': 'selected', 'branches': [self.main.pk], 'department_scope': 'selected', 'departments': [self.department.pk], 'require_department': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def test_new_requisitions_and_global_workflow_use_shared_branch_and_department(self):
        finance = Group.objects.create(name=f'tenant:{self.tenant.pk}:Finance approvers')
        finance.user_set.add(self.head)
        workflow = WorkflowDefinition.objects.create(tenant=self.tenant, name='Central procurement', code='central-procurement', entity_type='procurement_requisition', status='published', is_active=True)
        WorkflowNodeDefinition.objects.create(workflow=workflow, code='finance', name='Finance approval', node_type='approval', is_initial=True, approval_group=finance)
        response = self.client.patch('/api/procurement/configuration/', {'approval_source': 'workflow', 'workflow': workflow.pk, 'branch_scope': 'selected', 'branches': [self.main.pk], 'require_department': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        account = Account.objects.create(tenant=self.tenant, code='6000', name='Sales expenses', account_type='expense')
        budget = Budget.objects.create(tenant=self.tenant, name='Sales budget', code='SALES-BUDGET', start_date='2026-01-01', end_date='2026-12-31', status='active')
        line = BudgetLine.objects.create(budget=budget, account=account, cost_center='SALES', period_year=2026, allocated_amount=10000)
        payload = {'title': 'Shared department purchase', 'department': self.department.pk, 'budget_line': line.pk, 'request_kind': 'standard', 'cost_center': 'SALES', 'lines': [{'description': 'Goods', 'quantity': '1', 'unit_price': '100'}]}
        missing = self.client.post('/api/procurement/requisitions/', {**payload, 'department': None}, format='json')
        self.assertEqual(missing.status_code, 400, missing.data)
        wrong_branch = sync_tenant_branch_to_operational(self.west)
        wrong = self.client.post('/api/procurement/requisitions/', {**payload, 'branch': wrong_branch.pk}, format='json')
        self.assertEqual(wrong.status_code, 400, wrong.data)
        created = self.client.post('/api/procurement/requisitions/', payload, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        requisition = Requisition.objects.get(pk=created.data['id'])
        self.assertEqual(requisition.branch.name, self.main.name)
        submitted = self.client.patch(f'/api/procurement/requisitions/{requisition.pk}/status/', {'status': 'submitted'}, format='json')
        self.assertEqual(submitted.status_code, 200, submitted.data)
        inbox = WorkflowInboxItem.objects.get(entity_type='procurement_requisition', entity_id=requisition.pk)
        self.assertEqual(inbox.workflow_id, workflow.pk)
        self.assertEqual(inbox.metadata['organization_id'], self.tenant.pk)
        self.assertEqual(inbox.metadata['branch_id'], self.main.pk)
        self.assertEqual(inbox.metadata['department_id'], self.department.pk)
        self.assertEqual(inbox.metadata['department_code'], 'SALES')
        finance.user_set.add(self.outsider)
        for user in [self.head, self.outsider]:
            membership = OrganizationMembership.objects.get(user=user, tenant=self.tenant)
            membership.active_role_group_name = finance.name
            membership.save()
        self.client.force_authenticate(self.head)
        visible = self.client.get('/api/platform/workflows/inbox/').data['data']['results']
        self.assertIn(inbox.pk, [row['id'] for row in visible])
        self.client.force_authenticate(self.outsider)
        hidden = self.client.get('/api/platform/workflows/inbox/').data['data']['results']
        self.assertNotIn(inbox.pk, [row['id'] for row in hidden])
        self.assertEqual(self.client.get(f'/api/platform/workflows/inbox/{inbox.pk}/subject/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/platform/workflows/inbox/{inbox.pk}/action/', {'decision': 'approve'}).status_code, 403)
        self.client.force_authenticate(self.admin)
        approvals_before = list(requisition.approvals.values_list('pk', flat=True))
        self.client.patch('/api/procurement/configuration/', {'approval_source': 'matrix'}, format='json')
        self.assertEqual(list(requisition.approvals.values_list('pk', flat=True)), approvals_before)
    def test_shared_branch_rename_retains_operational_identity_and_record_access(self):
        from Platform_Core.models import OrganizationBranchLink
        from Platform_Core.organization import platform_branch
        operational = sync_tenant_branch_to_operational(self.main)
        requisition = Requisition.objects.create(tenant=self.tenant, branch=operational, department=self.department, requested_by=self.admin, title='Before rename', cost_center='SALES')
        self.main.name = 'Renamed main office'
        self.main.save()
        self.assertEqual(platform_branch(self.tenant, operational).pk, self.main.pk)
        synced = sync_tenant_branch_to_operational(self.main)
        self.assertEqual(synced.pk, operational.pk)
        self.assertEqual(synced.name, 'Renamed main office')
        self.assertEqual(OrganizationBranchLink.objects.get(operational_branch=synced).branch_id, self.main.pk)
        records = self.client.get('/api/procurement/requisitions/').data['results']
        self.assertIn(requisition.pk, [row['id'] for row in records])

    def test_inactive_department_history_is_readable_and_can_be_deactivated(self):
        requisition = Requisition.objects.create(tenant=self.tenant, department=self.department, requested_by=self.admin, title='Retained history', cost_center='SALES')
        self.head.is_active = False
        self.head.save()
        response = self.client.patch(f'/api/platform/organization-units/{self.department.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        records = self.client.get('/api/procurement/requisitions/').data['results']
        self.assertIn(requisition.pk, [row['id'] for row in records])

    def test_global_workflow_cannot_reference_a_requisition_from_another_organization(self):
        foreign = Requisition.objects.create(tenant=self.foreign, requested_by=self.foreign_user, title='Foreign request', cost_center='OTHER')
        forged = WorkflowInboxItem.objects.create(tenant=self.tenant, module_slug='procurement', entity_type='procurement_requisition', entity_id=foreign.pk, title='Invalid reference', assigned_user=self.worker)
        self.client.force_authenticate(self.worker)
        result = self.client.get('/api/platform/workflows/inbox/').data['data']['results']
        self.assertNotIn(forged.pk, [row['id'] for row in result])
        self.assertEqual(self.client.get(f'/api/platform/workflows/inbox/{forged.pk}/subject/').status_code, 403)

    def test_individual_review_requires_department_reviewer_access_to_the_branch(self):
        from unittest.mock import patch
        from SL_Procurement.models import RequisitionLine
        from Platform_Core.models import SystemNotification
        operational = sync_tenant_branch_to_operational(self.west)
        requisition = Requisition.objects.create(tenant=self.tenant, branch=operational, department=self.department, requested_by=self.admin, title='West branch review', request_kind='individual', cost_center='SALES', estimated_total=10)
        RequisitionLine.objects.create(requisition=requisition, description='West supplies', quantity=1, unit_price=10)
        with patch('Platform_API.modules.procurement.views._run_budget_check', return_value=('passed', '')):
            response = self.client.patch(f'/api/procurement/requisitions/{requisition.pk}/status/', {'status': 'submitted'}, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.assertFalse(SystemNotification.objects.filter(source_type='department_requisition', source_id=requisition.pk).exists())
            OrganizationMembership.objects.get(user=self.head, tenant=self.tenant).branches.add(self.west)
            response = self.client.patch(f'/api/procurement/requisitions/{requisition.pk}/status/', {'status': 'submitted'}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(SystemNotification.objects.filter(recipient=self.head, source_type='department_requisition', source_id=requisition.pk).exists())
