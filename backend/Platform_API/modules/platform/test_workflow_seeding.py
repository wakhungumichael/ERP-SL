# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from decimal import Decimal
from io import StringIO

from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.forms.models import model_to_dict
from django.test import TestCase

from Platform_Core.management.commands.seed_workflows import WORKFLOW_CATALOG
from Platform_Core.models import Tenant, TenantUserProfile, WorkflowDefinition, WorkflowEntityBinding, WorkflowInboxItem
from Platform_API.modules.platform.views import _validate_workflow_definition, _workflow_next_actionable_node
from Platform_API.modules.procurement.views import _matching_central_workflow_path
from SL_Procurement.models import ApprovalMatrix, Requisition


class StandardWorkflowSeedingTests(TestCase):
    def setUp(self):
        self.admin_group, _ = Group.objects.get_or_create(name='Tenant Admin')
        self.finance_group, _ = Group.objects.get_or_create(name='Finance')
        self.operator_group, _ = Group.objects.get_or_create(name='Operator')
        self.tenants = [Tenant.objects.create(name=f'Workflow Organization {index}', code=f'workflow-org-{index}', is_active=True, status='active') for index in (1, 2)]
        self.admins = []
        for tenant in self.tenants:
            user = User.objects.create_user(f'workflow-admin-{tenant.pk}')
            TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=True)
            user.groups.add(self.admin_group)
            self.admins.append(user)

    def seed(self, **options):
        call_command('seed_workflows', all_active_tenants=True, publish=True, stdout=StringIO(), **options)

    def test_all_active_organizations_receive_valid_published_setups(self):
        inactive = Tenant.objects.create(name='Inactive', code='workflow-inactive', is_active=False)
        self.seed()
        for tenant in self.tenants:
            workflows = WorkflowDefinition.objects.filter(tenant=tenant)
            self.assertEqual(workflows.count(), len(WORKFLOW_CATALOG))
            self.assertFalse(workflows.exclude(status='published', is_active=True).exists())
            for workflow in workflows:
                self.assertIsNotNone(workflow.published_at)
                errors, _ = _validate_workflow_definition(workflow)
                self.assertEqual(errors, [], workflow.code)
        self.assertFalse(WorkflowDefinition.objects.filter(tenant=inactive).exists())

    def test_reruns_preserve_existing_custom_and_standard_workflows(self):
        custom = WorkflowDefinition.objects.create(tenant=self.tenants[0], code='custom-ticket-route', name='Custom ticket route', entity_type='service_ticket', status='published', metadata={'custom': True})
        WorkflowEntityBinding.objects.create(workflow=custom, module_slug='ticketing', entity_type='service_ticket', entity_label='Custom ticket')
        original = model_to_dict(custom)
        self.seed()
        snapshot = list(WorkflowDefinition.objects.order_by('pk').values())
        self.seed()
        self.assertEqual(list(WorkflowDefinition.objects.order_by('pk').values()), snapshot)
        custom.refresh_from_db()
        self.assertEqual(model_to_dict(custom), original)
        self.assertEqual(WorkflowDefinition.objects.filter(tenant=self.tenants[0], entity_type='service_ticket').count(), 1)

    def test_existing_draft_is_not_overwritten_or_published(self):
        draft = WorkflowDefinition.objects.create(tenant=self.tenants[0], code='private-estimate-setup', name='Private estimate', entity_type='estimate', status='draft', is_active=False)
        self.seed()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'draft')
        self.assertFalse(draft.is_active)
        self.assertEqual(WorkflowDefinition.objects.filter(tenant=self.tenants[0], entity_type='estimate').count(), 1)

    def test_unstaffed_groups_fall_back_to_existing_tenant_admins(self):
        before_users = User.objects.count()
        self.seed()
        for workflow in WorkflowDefinition.objects.all():
            self.assertFalse(workflow.nodes.filter(node_type='approval').exclude(approval_group=self.admin_group).exists())
        self.assertFalse(Group.objects.filter(name='Project Manager').exists())
        self.assertEqual(User.objects.count(), before_users)

    def test_dry_run_does_not_persist_workflows(self):
        self.seed(dry_run=True)
        self.assertFalse(WorkflowDefinition.objects.exists())
        self.assertFalse(WorkflowEntityBinding.objects.exists())

    def test_missing_approvers_rolls_back_the_entire_seed(self):
        self.admins[1].is_active = False
        self.admins[1].save(update_fields=['is_active'])
        with self.assertRaises(CommandError):
            self.seed()
        self.assertFalse(WorkflowDefinition.objects.exists())

    def test_existing_procurement_matrix_is_preserved(self):
        matrix = ApprovalMatrix.objects.create(tenant=self.tenants[0], name='Custom matrix', cost_center='Engineering', min_amount=123, approval_group=self.finance_group, step_order=1)
        original = model_to_dict(matrix)
        self.seed()
        matrix.refresh_from_db()
        self.assertEqual(model_to_dict(matrix), original)
        self.assertFalse(WorkflowDefinition.objects.filter(tenant=self.tenants[0], entity_type='procurement_requisition').exists())

    def test_procurement_amount_bands_use_the_existing_thresholds(self):
        tenant = self.tenants[0]
        for name, group in [('seed-finance', self.finance_group), ('seed-operator', self.operator_group)]:
            user = User.objects.create_user(name)
            TenantUserProfile.objects.create(user=user, tenant=tenant)
            user.groups.add(group)
        self.seed()
        for amount, group in [('0', self.operator_group), ('5000', self.operator_group), ('5000.01', self.finance_group), ('25000', self.finance_group), ('25000.01', self.admin_group)]:
            with self.subTest(amount=amount):
                requisition = Requisition(tenant=tenant, estimated_total=Decimal(amount), cost_center='', currency='KES', status='draft')
                workflow, nodes = _matching_central_workflow_path(requisition)
                self.assertIsNotNone(workflow)
                self.assertEqual(len(nodes), 1)
                self.assertEqual(nodes[0].approval_group_id, group.pk)

    def test_estimate_escalation_uses_the_existing_high_value_threshold(self):
        tenant = self.tenants[0]
        finance = User.objects.create_user('estimate-finance')
        TenantUserProfile.objects.create(user=finance, tenant=tenant)
        finance.groups.add(self.finance_group)
        self.seed()
        workflow = WorkflowDefinition.objects.get(tenant=tenant, entity_type='estimate')
        review = workflow.nodes.get(is_initial=True)
        for amount, escalates in [(249999, False), (250000, True)]:
            item = WorkflowInboxItem(workflow=workflow, tenant=tenant, node_definition=review, metadata={'context': {'total_amount': amount}})
            next_node = _workflow_next_actionable_node(item)
            if escalates:
                self.assertEqual(next_node.approval_group_id, self.admin_group.pk)
            else:
                self.assertIsNone(next_node)
