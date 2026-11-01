"""Procurement consumes shared organization structure and central workflows."""
from django.db import transaction
from django.db.models import Q
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from Platform_API.modules.mixins import has_active_permission
from Platform_Core.audit import log_business_event
from Platform_Core.models import Department, TenantBranch, WorkflowDefinition
from Platform_Core.organization import branch_allowed_for_user, platform_branch, unit_available
from SL_Procurement.models import ProcurementPolicy


def configuration_allowed(user):
    from .requisition_flow import procurement_can
    return has_active_permission(user, 'SL_Procurement.change_procurementpolicy') or procurement_can(user, 'change_approvalmatrix')


def validate_scope(user, tenant, operational_branch, department):
    branch = platform_branch(tenant, operational_branch, user)
    policy = ProcurementPolicy.objects.filter(tenant=tenant).first()
    if operational_branch and (operational_branch.tenant_id or operational_branch.company.tenant_id) != tenant.pk:
        raise ValidationError({'branch': 'Choose a branch in this organization.'})
    if branch and not branch_allowed_for_user(user, branch):
        raise PermissionDenied('Your organization membership does not allow this branch.')
    if policy and policy.branch_scope == 'selected' and (not branch or not policy.branches.filter(pk=branch.pk, is_active=True, tenant=tenant).exists()):
        raise ValidationError({'branch': 'Procurement is not enabled for this branch. Choose an enabled organization branch.'})
    if policy and (policy.require_department or policy.department_scope == 'selected') and not department:
        raise ValidationError({'department': 'Choose a department for this requisition.'})
    if department:
        if department.tenant_id != tenant.pk or department.unit_type != 'department':
            raise ValidationError({'department': 'Choose a department in this organization.'})
        if not unit_available(department, user, branch):
            raise PermissionDenied('This department is unavailable for your branch or department membership.')
        if policy and policy.department_scope == 'selected' and not policy.departments.filter(pk=department.pk).exists():
            raise ValidationError({'department': 'This department is not enabled for procurement.'})
    return branch


def restrict_records(user, qs):
    """Keep branch and department restrictions inside existing record permissions."""
    from .requisition_flow import active_tenant, procurement_can
    from Platform_API.modules.mixins import resolve_user_tenant
    if user.is_superuser and resolve_user_tenant(user) is None:
        return qs
    tenant = active_tenant(user)
    qs = qs.filter(tenant=tenant)
    policy = ProcurementPolicy.objects.filter(tenant=tenant).first()
    branches = [branch for branch in TenantBranch.objects.filter(tenant=tenant, is_active=True) if branch_allowed_for_user(user, branch)]
    restricted = bool(policy and policy.branch_scope == 'selected')
    if restricted:
        enabled = set(policy.branches.values_list('pk', flat=True))
        branches = [branch for branch in branches if branch.pk in enabled]
    def branch_match(available):
        return Q(branch__organization_link__branch_id__in=[branch.pk for branch in available]) | Q(branch__organization_link__isnull=True, branch__name__in=[branch.name for branch in available])
    if TenantBranch.objects.filter(tenant=tenant).exists() or restricted:
        qs = qs.filter(branch_match(branches) | (Q(branch__isnull=True) if not restricted else Q(pk__in=[])))
    has_branches = TenantBranch.objects.filter(tenant=tenant).exists()
    units = Department.objects.filter(tenant=tenant).select_related('parent').prefetch_related('branches', 'members')
    if policy and policy.department_scope == 'selected':
        units = units.filter(pk__in=policy.departments.values('pk'))
        condition = Q(pk__in=[])
    else:
        condition = Q(department__isnull=True)
    approval_access = procurement_can(user, 'approve_requisition')
    for unit in units:
        available = [branch for branch in branches if unit_available(unit, user, branch, membership_check=not approval_access, active=False)]
        condition |= Q(department=unit) & branch_match(available)
        if not restricted and unit_available(unit, user, None, membership_check=not approval_access, active=False):
            condition |= Q(department=unit, branch__isnull=True)
        if not has_branches and unit_available(unit, user, None, membership_check=not approval_access, active=False):
            condition |= Q(department=unit)
    return qs.filter(condition).distinct()


class ProcurementConfigurationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcurementPolicy
        exclude = ['tenant']
        read_only_fields = ['id']

    def validate(self, attrs):
        tenant = self.context['tenant']
        value = lambda name, default=None: attrs.get(name, getattr(self.instance, name, default))
        for name, model in [('branches', TenantBranch), ('departments', Department)]:
            rows = list(attrs.get(name, getattr(self.instance, name).all() if self.instance else []))
            if any(row.tenant_id != tenant.pk or not row.is_active or name == 'departments' and row.unit_type != 'department' for row in rows):
                raise ValidationError({name: 'Choose active organization records from the shared settings.'})
            scope = 'branch_scope' if name == 'branches' else 'department_scope'
            if value(scope, 'all') == 'selected' and not rows:
                raise ValidationError({name: 'Select at least one record for restricted access.'})
        workflow = value('workflow')
        if workflow and (workflow.tenant_id != tenant.pk or workflow.entity_type != 'procurement_requisition' or not workflow.is_active or workflow.status != 'published'):
            raise ValidationError({'workflow': 'Choose an active published procurement requisition workflow in this organization.'})
        return attrs


class ProcurementConfigurationView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        from .requisition_flow import active_tenant, procurement_can
        tenant = active_tenant(request.user)
        manage = configuration_allowed(request.user)
        if not manage and not procurement_can(request.user, 'view_procurementpolicy'):
            raise PermissionDenied('Your active role cannot view procurement configuration.')
        policy, _ = ProcurementPolicy.objects.get_or_create(tenant=tenant)
        return Response({'organization': {'id': tenant.pk, 'name': tenant.name}, 'can_manage': manage,
            'configuration': ProcurementConfigurationSerializer(policy).data,
            'branches': list(TenantBranch.objects.filter(tenant=tenant, is_active=True).values('id', 'name')),
            'departments': list(Department.objects.filter(tenant=tenant, is_active=True, unit_type='department').values('id', 'name', 'code')),
            'workflows': list(WorkflowDefinition.objects.filter(tenant=tenant, entity_type='procurement_requisition', is_active=True, status='published').values('id', 'name'))})

    @transaction.atomic
    def patch(self, request):
        from .requisition_flow import active_tenant
        tenant = active_tenant(request.user)
        if not configuration_allowed(request.user):
            raise PermissionDenied('Your active role cannot configure procurement.')
        policy, _ = ProcurementPolicy.objects.get_or_create(tenant=tenant)
        policy = ProcurementPolicy.objects.select_for_update().get(pk=policy.pk)
        serializer = ProcurementConfigurationSerializer(policy, data=request.data, partial=True, context={'tenant': tenant})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_business_event(event_group='data_lifecycle', event_type='update', tenant=tenant, actor=request.user, obj=policy, note='Procurement configuration updated; new submissions use the configured route.')
        return Response(serializer.data)

def restrict_workflow_items(qs, user):
    if user.is_superuser or not qs.filter(entity_type='procurement_requisition').exists():
        return qs
    from SL_Procurement.models import Requisition
    permitted = restrict_records(user, Requisition.objects.all()).values('pk')
    return qs.filter(~Q(entity_type='procurement_requisition') | Q(entity_type='procurement_requisition', entity_id__in=permitted))
