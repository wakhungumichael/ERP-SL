"""Add new workspace entries and unassigned self-service roles without replacing custom setup."""
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction
from Platform_Core.models import ModuleDefinition, Tenant, WorkspaceMenuItem, WorkspaceMenuSection
from SL_HR.models import HRPolicy
from SL_Procurement.models import ApprovalMatrix, ProcurementPolicy


class Command(BaseCommand):
    help = 'Add HR workspace entries, department setup, defaults, and an unassigned Employee Self Service role per active tenant.'

    @transaction.atomic
    def handle(self, *args, **options):
        hr = ModuleDefinition.objects.filter(slug__in=['hr-payroll', 'hr', 'hcm']).first()
        if hr:
            section, _ = WorkspaceMenuSection.objects.get_or_create(key='hr', defaults={'title': 'HR', 'icon': 'users', 'module': hr, 'sort_order': 60, 'is_active': True})
            for index, (key, title) in enumerate([('employees', 'Employees & Onboarding'), ('leave', 'Leave Requests'), ('requests', 'Employee Requests'), ('my-payslips', 'My Payslips'), ('settings', 'HR Settings')], 1):
                WorkspaceMenuItem.objects.get_or_create(section=section, key=key, defaults={'title': title, 'route_path': f'/hr/{key}', 'api_path': f'/api/hr/{key}/', 'required_module': hr, 'sort_order': index, 'icon': 'users'})
        procurement = ModuleDefinition.objects.filter(slug='procurement').first()
        if procurement:
            section, _ = WorkspaceMenuSection.objects.get_or_create(key='procurement', defaults={'title': 'Procurement', 'icon': 'shopping-cart', 'module': procurement, 'sort_order': 50})
            WorkspaceMenuItem.objects.get_or_create(section=section, key='departments', defaults={'title': 'Departments & Heads', 'route_path': '/procurement/departments', 'api_path': '/api/procurement/departments/', 'required_module': procurement, 'sort_order': 3, 'icon': 'users'})
        permission_names = {
            'SL_HR': ['view_employee', 'request_own_leave', 'add_employeedocument', 'view_employeedocument', 'add_employeeservicerequest', 'view_employeeservicerequest'],
            'SL_Procurement': ['add_requisition', 'change_requisition', 'view_requisition'],
        }
        for tenant in Tenant.objects.filter(is_active=True):
            # Only fill missing matrices; preserve customized and deactivated rules.
            if not ApprovalMatrix.objects.filter(tenant=tenant).exists() and not ProcurementPolicy.objects.filter(tenant=tenant, approval_source='matrix').exists():
                from Platform_Core.models import WorkflowNodeDefinition
                nodes = WorkflowNodeDefinition.objects.filter(workflow__tenant=tenant, workflow__entity_type='procurement_requisition', workflow__status='published', workflow__is_active=True, node_type='approval', approval_group__isnull=False).order_by('step_order', 'pk')
                for node in nodes:
                    ApprovalMatrix.objects.create(tenant=tenant, name=node.name, min_amount=node.min_amount or 0, max_amount=node.max_amount, step_order=node.step_order or 1, approval_group=node.approval_group, metadata={'source': 'existing-workflow', 'workflow_id': node.workflow_id})
            HRPolicy.objects.get_or_create(tenant=tenant)
            ProcurementPolicy.objects.get_or_create(tenant=tenant)
            group, created = Group.objects.get_or_create(name=f'tenant:{tenant.pk}:Employee Self Service')
            if created:
                for app, names in permission_names.items():
                    group.permissions.add(*Permission.objects.filter(content_type__app_label=app, codename__in=names))
            self.stdout.write(f'{tenant.code}: workspace defaults ready; self-service role {"created (unassigned)" if created else "preserved"}.')
