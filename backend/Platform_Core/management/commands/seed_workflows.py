# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Seed missing standard approval configurations without rewriting tenant policy."""
from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from Platform_Core.models import (
    ModuleDefinition, Tenant, WorkflowDefinition, WorkflowEntityBinding,
    WorkflowNodeDefinition, WorkflowTransitionDefinition,
)

# module, document type, name, route, preferred existing role, trigger
WORKFLOW_CATALOG = [
    ('weighbridge', 'weighbridge_transaction', 'Weighment Transaction', '/weighbridge/transactions', 'Finance', 'submit'),
    ('procurement', 'procurement_requisition', 'Procurement Requisition', '/procurement/requisitions', 'Finance', 'submit'),
    ('purchases', 'purchase_order', 'Purchase Order', '/procurement/purchase-orders', 'Finance', 'submit'),
    ('purchases', 'goods_receipt', 'Goods Receipt', '/procurement/receipts', 'Operator', 'complete'),
    ('sales', 'sales_order', 'Sales Order', '/sales/orders', 'Finance', 'submit'),
    ('sales', 'sales_invoice', 'Sales Invoice', '/sales/invoices', 'Finance', 'submit'),
    ('sales', 'estimate', 'Sales Estimate', '/sales/estimates', 'Finance', 'submit'),
    ('accounting', 'vendor_bill', 'Vendor Bill', '/finance/payables', 'Finance', 'submit'),
    ('accounting', 'payment_batch', 'Payment Batch', '/finance/transactions', 'Finance', 'submit'),
    ('accounting', 'journal_entry', 'Journal Entry', '/finance/transactions', 'Finance', 'post'),
    ('inventory', 'stock_adjustment', 'Stock Adjustment', '/inventory/movements', 'Operator', 'submit'),
    ('hr-payroll', 'leave_request', 'Leave Request', '/hr/staff', 'Tenant Admin', 'submit'),
    ('crm', 'opportunity', 'CRM Opportunity', '/crm/opportunities', 'Tenant Admin', 'submit'),
    ('ticketing', 'service_ticket', 'Service Ticket', '/ticketing/queue', 'Tenant Admin', 'submit'),
    ('projects-tasks', 'project', 'Project', '/projects', 'Project Manager', 'submit'),
    ('projects-tasks', 'project_task', 'Project Task', '/projects/tasks', 'Project Manager', 'submit'),
]

# Existing thresholds from the reusable workflow examples.
ESCALATIONS = {
    'weighbridge_transaction': ('context.charge', 'gte', '50000'),
    'vendor_bill': ('context.total_amount', 'gte', '100000'),
    'estimate': ('context.total_amount', 'gte', '250000'),
    'project_task': ('context.priority', 'eq', 'critical'),
}


class Command(BaseCommand):
    help = 'Seed missing ERP workflows; preserve all existing tenant workflows and procurement matrices.'

    def add_arguments(self, parser):
        scope = parser.add_mutually_exclusive_group(required=True)
        scope.add_argument('--tenant-code')
        scope.add_argument('--all-active-tenants', action='store_true')
        parser.add_argument('--publish', action='store_true', help='Activate newly created workflows.')
        parser.add_argument('--dry-run', action='store_true', help='Validate and report the proposed setup, rolling back all writes.')
        parser.add_argument('--run-id', help='Audit identifier for the newly seeded setups.')

    def handle(self, *args, **options):
        tenants = Tenant.objects.filter(is_active=True).exclude(status__in=['archived', 'suspended'])
        if options.get('tenant_code'):
            tenants = tenants.filter(code=options['tenant_code'])
        self.created = self.skipped = 0
        self.run_id = options.get('run_id') or timezone.now().strftime('%Y%m%dT%H%M%SZ')
        with transaction.atomic():
            tenants = list(tenants.select_for_update().order_by('pk'))
            if not tenants:
                raise CommandError('No active organizations match the requested scope.')
            for tenant in tenants:
                before = self.created
                for spec in WORKFLOW_CATALOG:
                    self._seed(tenant, spec, options['publish'])
                self.stdout.write(f'{tenant.code}: {self.created - before} new workflows')
            if options['dry_run']:
                transaction.set_rollback(True)
        self.stdout.write(self.style.SUCCESS(
            f'{"Dry run" if options["dry_run"] else "Seeding complete"}: {self.created} created, {self.skipped} existing configurations preserved; '
            f'new workflows {"published" if options["publish"] else "saved as inactive drafts"}.'
        ))

    def _group(self, tenant, preferred):
        for name in dict.fromkeys([preferred, 'Tenant Admin']):
            group = Group.objects.filter(name=name).first()
            if group is None:
                continue
            members = User.objects.filter(is_active=True, groups=group).filter(
                Q(tenant_profile__tenant=tenant) |
                Q(organization_memberships__tenant=tenant, organization_memberships__is_active=True)
            ).distinct()
            if members.exists():
                if name != preferred:
                    self.stdout.write(f'  {tenant.code}: {preferred} has no eligible members; using Tenant Admin')
                return group
        # An organization owner may be an employee in another organization.
        # Use a tenant-scoped approver group without granting a global admin role.
        admins = User.objects.filter(is_active=True).filter(
            Q(organization_memberships__tenant=tenant, organization_memberships__is_active=True, organization_memberships__is_org_admin=True) |
            Q(tenant_profile__tenant=tenant, tenant_profile__is_tenant_admin=True)
        ).distinct()
        if admins.exists():
            Group.objects.get_or_create(name='Tenant Admin')
            group, _ = Group.objects.get_or_create(name=f'tenant:{tenant.pk}:Organization Approvers')
            group.user_set.add(*admins)
            return group
        raise CommandError(f'{tenant.code}: no active approver belongs to {preferred} or Tenant Admin. No workflows were seeded.')

    def _transition(self, workflow, source, target, key, **kwargs):
        return WorkflowTransitionDefinition.objects.create(
            workflow=workflow, from_node=source, to_node=target,
            transition_key=key, name=key.replace('-', ' ').title(), **kwargs,
        )

    def _seed(self, tenant, spec, publish):
        module, entity, label, route, preferred, trigger = spec
        code = f'{entity.replace("_", "-")}-approval'
        existing = WorkflowDefinition.objects.filter(tenant=tenant).filter(Q(entity_type=entity) | Q(code=code)).exists()
        bound = WorkflowEntityBinding.objects.filter(workflow__tenant=tenant, module_slug=module, entity_type=entity).exists()
        if entity == 'procurement_requisition':
            from SL_Procurement.models import ApprovalMatrix
            existing = existing or ApprovalMatrix.objects.filter(tenant=tenant, is_active=True).exists()
        if existing or bound:
            self.skipped += 1
            self.stdout.write(f'  Preserved {tenant.code}: {label}')
            return
        group = self._group(tenant, preferred)
        workflow = WorkflowDefinition.objects.create(
            tenant=tenant, module=ModuleDefinition.objects.filter(slug=module).first(), code=code,
            name=f'{label} Approval', entity_type=entity, trigger_event=trigger,
            description='Standard approval setup. Organization administrators can revise roles and routing in Workflow Center.',
            status='published' if publish else 'draft', is_active=publish,
            published_at=timezone.now() if publish else None,
            metadata={'seed_source': 'standard-workflows', 'seed_version': 1, 'seed_run': self.run_id, 'preferred_approval_group': preferred},
        )
        WorkflowEntityBinding.objects.create(
            workflow=workflow, module_slug=module, entity_type=entity, entity_label=label,
            route_path=route, trigger_events=[trigger], is_primary=True,
        )
        end = WorkflowNodeDefinition.objects.create(workflow=workflow, code='completed', name='Approved', node_type='end', step_order=99, notify_dashboard=False)
        if entity == 'procurement_requisition':
            self._procurement_nodes(tenant, workflow, end)
        else:
            review = WorkflowNodeDefinition.objects.create(workflow=workflow, code='review', name=f'{group.name} Review', node_type='approval', step_order=1, is_initial=True, approval_group=group)
            escalation = ESCALATIONS.get(entity)
            admin = self._group(tenant, 'Tenant Admin') if escalation else group
            if escalation and admin.pk != group.pk:
                final = WorkflowNodeDefinition.objects.create(workflow=workflow, code='final-review', name='Tenant Admin Approval', node_type='approval', step_order=2, approval_group=admin)
                field, operator, value = escalation
                self._transition(workflow, review, final, 'escalate', decision='approve', priority=1, condition_field=field, condition_operator=operator, condition_value=value)
                self._transition(workflow, final, end, 'final-approval', decision='approve', is_default=True)
            self._transition(workflow, review, end, 'approve', decision='approve', priority=99, is_default=True)
        from Platform_API.modules.platform.views import _validate_workflow_definition
        errors, _ = _validate_workflow_definition(workflow)
        if errors:
            raise CommandError(f'{tenant.code}: invalid {label} workflow: {errors}')
        self.created += 1

    def _procurement_nodes(self, tenant, workflow, end):
        from SL_Procurement.management.commands.seed_procurement_approval_matrix import DEFAULT_RULES
        # The native requisition engine skips approval nodes outside their
        # amount band, then follows amount thresholds to the applicable role.
        previous = None
        for index, rule in enumerate(DEFAULT_RULES, start=1):
            group = self._group(tenant, rule['group_name'])
            node = WorkflowNodeDefinition.objects.create(
                workflow=workflow, code=f'amount-band-{index}', name=rule['name'], node_type='approval',
                step_order=index, is_initial=index == 1, approval_group=group,
                min_amount=rule['min_amount'], max_amount=rule['max_amount'],
            )
            if previous:
                self._transition(
                    workflow, previous, node, f'route-band-{index}', decision='approve', priority=1,
                    condition_field='estimated_total', condition_operator='gte', condition_value=str(rule['min_amount']),
                )
            self._transition(workflow, node, end, f'approve-band-{index}', decision='approve', priority=99, is_default=True)
            previous = node
