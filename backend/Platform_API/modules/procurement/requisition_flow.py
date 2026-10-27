"""Budget-backed individual and departmental requisition lifecycle."""
from decimal import Decimal
from uuid import uuid4

from django.db import transaction
from django.contrib.auth.models import Group
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import has_active_permission, tenant_or_403
from Platform_Core.audit import log_business_event
from Platform_Core.models import OrganizationMembership, SystemNotification
from SL_Budgeting.models import BudgetCommitment, BudgetLine
from SL_Procurement.models import ApprovalMatrix, Department, ProcurementPolicy, Requisition, RequisitionLine
from SL_Sales.models import SalesOrder


def is_department_lead(department, user):
    return bool(department and department.is_active and user.pk in {department.head_id, department.deputy_id})


def procurement_can(user, name):
    if name in {'view_department', 'view_requisition', 'change_requisition', 'add_requisition', 'consolidate_requisitions'}:
        from Platform_API.modules.mixins import resolve_user_tenant, NO_TENANT_ACCESS
        tenant = resolve_user_tenant(user)
        if tenant not in (None, NO_TENANT_ACCESS) and Department.objects.filter(tenant=tenant, is_active=True).filter(Q(head=user) | Q(deputy=user)).exists():
            return True
    membership = OrganizationMembership.objects.filter(user=user, is_active=True).order_by('-is_default', 'tenant__name').first()
    role = membership.effective_role_group_name() if membership else ''
    if role.startswith('tenant:') and not role.startswith(f'tenant:{membership.tenant_id}:'):
        return False
    if role and role not in {'Tenant Admin', 'Platform Admin', 'Super Admin'} and not user.is_superuser:
        group = user.groups.filter(name=role).first()
        return bool(group and group.permissions.filter(content_type__app_label='SL_Procurement', codename=name).exists())
    # Legacy tenant administrators retain access while memberships are migrated.
    if not OrganizationMembership.objects.filter(user=user, is_active=True).exists():
        profile = getattr(user, 'tenant_profile', None)
        if profile and profile.is_tenant_admin:
            return True
    return has_active_permission(user, f'SL_Procurement.{name}')


def procurement_require(user, name):
    if not procurement_can(user, name):
        raise PermissionDenied('Your role does not have permission for this procurement action.')


def active_tenant(user):
    tenant = tenant_or_403(user)
    if tenant is None:
        raise PermissionDenied('Select an organization-specific procurement account.')
    return tenant


def active_approval_groups(user):
    groups = user.groups.all()
    membership = OrganizationMembership.objects.filter(user=user, is_active=True).order_by('-is_default', 'tenant__name').first()
    role = membership.effective_role_group_name() if membership else ''
    if membership and membership.is_org_admin and role == 'Tenant Admin':
        return groups.filter(name__in=['Tenant Admin', f'tenant:{membership.tenant_id}:Organization Approvers'])
    return groups.filter(name=role) if role else groups


def scope_requisitions(user, qs):
    if procurement_can(user, 'view_all_requisition') or user.is_superuser:
        return qs
    return qs.filter(Q(requested_by=user) | Q(department__head=user) | Q(department__deputy=user) | Q(approvals__assigned_user=user) | Q(approvals__approval_group__in=active_approval_groups(user))).distinct()


def validate_approval_rule(serializer, tenant):
    data = serializer.validated_data
    instance = serializer.instance
    minimum = data.get('min_amount', getattr(instance, 'min_amount', 0))
    maximum = data.get('max_amount', getattr(instance, 'max_amount', None))
    if minimum < 0 or maximum is not None and maximum < minimum:
        raise ValidationError({'amount': 'Use a non-negative minimum and a maximum at least as large.'})
    if data.get('step_order', getattr(instance, 'step_order', 1)) < 1:
        raise ValidationError({'step_order': 'Approval steps start at 1.'})
    group = data.get('approval_group', getattr(instance, 'approval_group', None))
    if group and group.name.startswith('tenant:') and not group.name.startswith(f'tenant:{tenant.pk}:'):
        raise ValidationError({'approval_group': 'Choose an approval group in this organization.'})


def validate_requisition_data(serializer, data):
    tenant = serializer.context.get('tenant') or getattr(serializer.instance, 'tenant', None)
    user = getattr(serializer.context.get('request'), 'user', None)
    instance = serializer.instance
    kind = data.get('request_kind', getattr(instance, 'request_kind', 'standard'))
    department = data.get('department', getattr(instance, 'department', None))
    budget = data.get('budget_line', getattr(instance, 'budget_line', None))
    order = data.get('sales_order', getattr(instance, 'sales_order', None))
    if kind == 'departmental' and not instance:
        raise ValidationError({'request_kind': 'Create departmental requests by consolidating head-approved individual requests.'})
    if instance and kind != instance.request_kind:
        raise ValidationError({'request_kind': 'Request kind cannot be changed after creation.'})
    if department and (department.tenant_id != tenant.pk or not department.is_active):
        raise ValidationError({'department': 'Choose an active department in this organization.'})
    if kind == 'standard' and user and not procurement_can(user, 'view_all_requisition') and not is_department_lead(department, user):
        raise PermissionDenied('Individual staff requests must go through their department head. Choose Individual request.')
    if kind == 'individual':
        if not department:
            raise ValidationError({'department': 'Individual requests require a department.'})
        if user and not is_department_lead(department, user) and not department.members.filter(pk=user.pk).exists() and not procurement_can(user, 'change_department'):
            raise PermissionDenied('Your account is not a member of this department.')
    if order and (order.tenant_id != tenant.pk or order.status == 'cancelled'):
        raise ValidationError({'sales_order': 'Choose a current sales order from this organization.'})
    if budget:
        if budget.budget.tenant_id != tenant.pk or budget.budget.status != 'active':
            raise ValidationError({'budget_line': 'Choose an active budget in this organization.'})
        data.update(gl_account=budget.account, cost_center=budget.cost_center, project_code=budget.project_code, currency=budget.budget.currency)
        if department and budget.cost_center not in {department.code, department.name}:
            raise ValidationError({'budget_line': 'The budget cost center must match the department code or name.'})
    return data


def release_commitment(requisition):
    for commitment in BudgetCommitment.objects.select_for_update().filter(tenant=requisition.tenant, source_type='requisition', source_reference=requisition.request_number, state='committed'):
        line = BudgetLine.objects.select_for_update().get(pk=commitment.budget_line_id)
        line.committed_amount = max(Decimal('0'), line.committed_amount-commitment.amount)
        line.save(update_fields=['committed_amount', 'updated_at'])
        commitment.state = 'released'
        commitment.released_at = timezone.now()
        commitment.save(update_fields=['state', 'released_at', 'updated_at'])


def change_requisition_status(request, pk):
    from .views import RequisitionDetailView, RequisitionSerializer, _run_budget_check, _sync_requisition_approvals, _create_commitment_for_requisition, _close_workflow_inbox_items
    obj = RequisitionDetailView()._get(request, pk)
    if not obj:
        return Response({'detail': 'Not found.'}, status=404)
    obj = Requisition.objects.select_for_update().get(pk=obj.pk)
    target = request.data.get('status')
    named_head = obj.department_id and is_department_lead(obj.department, request.user) and obj.request_kind == 'departmental'
    if not named_head:
        procurement_require(request.user, 'change_requisition')
    if obj.requested_by_id != request.user.pk and not procurement_can(request.user, 'view_all_requisition') and not (obj.department_id and is_department_lead(obj.department, request.user)):
        raise PermissionDenied('Only the requester or the department head can submit this request.')
    if target == 'cancelled':
        if obj.status not in {'draft', 'submitted', 'pending_approval', 'approved'} or obj.parent_requisition_id:
            raise ValidationError({'status': 'This requisition cannot be cancelled.'})
        release_commitment(obj)
        _close_workflow_inbox_items(obj, status_value='cancelled', acted_by=request.user)
        obj.status = 'cancelled'
    elif target == 'draft':
        if obj.status not in {'rejected', 'cancelled'} or obj.parent_requisition_id:
            raise ValidationError({'status': 'Only rejected or cancelled unconsolidated requests may return to draft.'})
        obj.status, obj.department_status = 'draft', 'draft'
    elif target in {'submitted', 'pending_approval'}:
        if obj.status != 'draft' or obj.parent_requisition_id:
            raise ValidationError({'status': 'Only draft requisitions can be submitted.'})
        if not obj.lines.exists() or obj.estimated_total <= 0:
            raise ValidationError({'lines': 'Add positive requisition line amounts before submitting.'})
        obj.budget_status, obj.budget_message = _run_budget_check(obj)
        if obj.budget_status == 'blocked':
            raise ValidationError({'budget': obj.budget_message})
        if obj.department_id and not obj.department.is_active:
            raise ValidationError({'department': 'The department is inactive.'})
        obj.submitted_at = timezone.now()
        if obj.request_kind == 'individual':
            if not obj.department_id or not obj.department.is_active:
                raise ValidationError({'department': 'An active department with a named head is required.'})
            obj.status, obj.department_status = 'submitted', 'pending'
            for recipient in [obj.department.head, obj.department.deputy]:
                if recipient and recipient.pk != obj.requested_by_id:
                    SystemNotification.objects.create(tenant=obj.tenant, recipient=recipient, category='reminder', title='Department requisition awaiting review', message=f'{obj.request_number}: {obj.title}', route_path='/procurement/requisitions', source_type='department_requisition', source_id=obj.pk)
        else:
            if obj.request_kind == 'departmental' and not obj.individual_requests.exists():
                raise ValidationError({'requests': 'Departmental requests must contain approved individual requests.'})
            _sync_requisition_approvals(obj)
            # Reserve once at submission. Consolidated children are never double reserved.
            _create_commitment_for_requisition(obj)
            obj.status = 'pending_approval'
    else:
        raise ValidationError({'status': 'Use submission, department review, higher approval or PO conversion actions.'})
    obj.save()
    log_business_event(event_group='data_lifecycle', event_type='update', tenant=obj.tenant, actor=request.user, obj=obj, note=f'Requisition moved to {obj.status}.')
    return Response(RequisitionSerializer(obj).data)


class DepartmentSerializer(serializers.ModelSerializer):
    head_name = serializers.SerializerMethodField()
    deputy_name = serializers.SerializerMethodField()
    class Meta:
        model = Department
        exclude = ['tenant']

    def get_head_name(self, obj):
        return obj.head.get_full_name() or obj.head.username

    def get_deputy_name(self, obj):
        return (obj.deputy.get_full_name() or obj.deputy.username) if obj.deputy_id else ''

    def validate(self, data):
        tenant = self.context['tenant']
        head = data.get('head', getattr(self.instance, 'head', None))
        deputy = data.get('deputy', getattr(self.instance, 'deputy', None))
        if head and deputy and head.pk == deputy.pk:
            raise ValidationError({'deputy': 'Choose different users for head and deputy.'})
        selected = list(data.get('members', []))
        for name in ['head', 'deputy']:
            if data.get(name):
                selected.append(data[name])
        for user in selected:
            if not OrganizationMembership.objects.filter(user=user, tenant=tenant, is_active=True, user__is_active=True).exists():
                raise ValidationError({'members': 'Choose active organization members for the head and department staff.'})
        code = data.get('code', getattr(self.instance, 'code', ''))
        if Department.objects.filter(tenant=tenant, code=code).exclude(pk=getattr(self.instance, 'pk', None)).exists():
            raise ValidationError({'code': 'Department code is already in use.'})
        return data


class DepartmentListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        qs = Department.objects.filter(tenant=active_tenant(request.user)).select_related('head', 'deputy').prefetch_related('members')
        return Response({'results': DepartmentSerializer(qs, many=True).data})

    def post(self, request):
        procurement_require(request.user, 'add_department')
        tenant = active_tenant(request.user)
        ser = DepartmentSerializer(data=request.data, context={'tenant': tenant})
        ser.is_valid(raise_exception=True)
        ser.save(tenant=tenant)
        return Response(ser.data, status=201)


class DepartmentDetailView(APIView):
    permission_classes = [IsAuthenticated]
    def patch(self, request, pk):
        procurement_require(request.user, 'change_department')
        tenant = active_tenant(request.user)
        obj = get_object_or_404(Department.objects.filter(tenant=tenant), pk=pk)
        ser = DepartmentSerializer(obj, data=request.data, partial=True, context={'tenant': tenant})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request, pk):
        procurement_require(request.user, 'delete_department')
        obj = get_object_or_404(Department.objects.filter(tenant=active_tenant(request.user)), pk=pk)
        if obj.requisitions.exists() or obj.employees.exists():
            raise ValidationError({'department': 'This department has history. Deactivate it instead.'})
        obj.delete()
        return Response(status=204)


class RequisitionSetupView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        tenant = active_tenant(request.user)
        # Metadata only; financial budget options require requisition or budget access.
        allowed = procurement_can(request.user, 'add_requisition') or procurement_can(request.user, 'view_all_requisition') or Department.objects.filter(tenant=tenant, is_active=True).filter(Q(head=request.user) | Q(deputy=request.user)).exists()
        lines = BudgetLine.objects.filter(budget__tenant=tenant, budget__status='active').select_related('budget', 'account') if allowed else BudgetLine.objects.none()
        orders = SalesOrder.objects.filter(tenant=tenant).exclude(status='cancelled') if allowed else SalesOrder.objects.none()
        members = OrganizationMembership.objects.filter(tenant=tenant, is_active=True, user__is_active=True).select_related('user')
        users_allowed = procurement_can(request.user, 'change_department') or has_active_permission(request.user, 'SL_HR.change_employee') or has_active_permission(request.user, 'SL_HR.add_employee')
        config, _ = ProcurementPolicy.objects.get_or_create(tenant=tenant)
        return Response({
            'budget_lines': [{'id': line.pk, 'name': f'{line.budget.code} / {line.cost_center} / {line.account.code}', 'available': line.available_amount, 'currency': line.budget.currency, 'cost_center': line.cost_center, 'account': line.account_id, 'project_code': line.project_code} for line in lines],
            'sales_orders': [{'id': order.pk, 'number': order.order_number} for order in orders.order_by('-created_at')[:200]],
            'approval_groups': [{'id': g.pk, 'name': g.name.split(':', 2)[-1]} for g in Group.objects.filter(Q(name__startswith=f'tenant:{tenant.pk}:') | ~Q(name__startswith='tenant:')).order_by('name')] if users_allowed else [],
            'users': [{'id': m.user_id, 'name': m.user.get_full_name() or m.user.username} for m in members] if users_allowed else [],
            'departments': DepartmentSerializer(Department.objects.filter(tenant=tenant, is_active=True), many=True).data,
            'approval_source': config.approval_source,
            'can_manage_departments': procurement_can(request.user, 'change_department'),
            'current_user': request.user.pk,
        })

    def patch(self, request):
        procurement_require(request.user, 'change_approvalmatrix')
        obj, _ = ProcurementPolicy.objects.get_or_create(tenant=active_tenant(request.user))
        obj.approval_source = serializers.ChoiceField(choices=['matrix', 'workflow']).run_validation(request.data.get('approval_source'))
        obj.save(update_fields=['approval_source'])
        return Response({'approval_source': obj.approval_source})


class DepartmentDecisionView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request, pk):
        obj = get_object_or_404(Requisition.objects.select_for_update().filter(tenant=active_tenant(request.user)), pk=pk)
        if not obj.department_id or not is_department_lead(obj.department, request.user):
            raise PermissionDenied('Only this department’s head or deputy may review individual requests.')
        if obj.request_kind != 'individual' or obj.department_status != 'pending' or obj.status != 'submitted':
            raise ValidationError({'status': 'This individual request is not awaiting department review.'})
        if obj.requested_by_id == request.user.pk:
            raise PermissionDenied('A department head cannot approve their own individual request. Use the standard approval route for that request.')
        decision = serializers.ChoiceField(choices=['approve', 'reject']).run_validation(request.data.get('decision'))
        obj.department_status = 'approved' if decision == 'approve' else 'rejected'
        if decision == 'reject':
            obj.status = 'rejected'
        obj.department_decided_by, obj.department_decided_at = request.user, timezone.now()
        obj.department_decision_notes = serializers.CharField(allow_blank=True).run_validation(request.data.get('notes', ''))
        obj.save()
        log_business_event(event_group='data_lifecycle', event_type='approval', tenant=obj.tenant, actor=request.user, obj=obj, note=f'Department head {decision}: {obj.department_decision_notes}')
        from .views import RequisitionSerializer
        return Response(RequisitionSerializer(obj).data)


class DepartmentConsolidateView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request):
        tenant = active_tenant(request.user)
        ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=100).run_validation(request.data.get('requests'))
        if len(ids) != len(set(ids)):
            raise ValidationError({'requests': 'Choose each request once.'})
        selected = list(Requisition.objects.select_for_update().filter(tenant=tenant, pk__in=ids).order_by('pk'))
        if len(selected) != len(ids):
            raise ValidationError({'requests': 'One or more requests are unavailable.'})
        first = selected[0]
        for obj in selected:
            if not obj.department_id or not is_department_lead(obj.department, request.user):
                raise PermissionDenied('Only the department head or deputy may consolidate these requests.')
            if obj.request_kind != 'individual' or obj.department_status != 'approved' or obj.parent_requisition_id or obj.status != 'submitted':
                raise ValidationError({'requests': 'Choose individual requests approved by the department head and not yet consolidated.'})
            if (obj.department_id, obj.budget_line_id, obj.currency, obj.sales_order_id, obj.gl_account_id, obj.project_code, obj.branch_id) != (first.department_id, first.budget_line_id, first.currency, first.sales_order_id, first.gl_account_id, first.project_code, first.branch_id):
                raise ValidationError({'requests': 'Consolidate requests from the same department, branch, budget line, project, currency and sales order together.'})
        obj = Requisition.objects.create(tenant=tenant, requested_by=request.user, department=first.department, request_kind='departmental', department_status='approved', department_decided_by=request.user, department_decided_at=timezone.now(),
            request_number=f'DREQ-{timezone.localdate():%Y%m%d}-{uuid4().hex[:8]}', title=serializers.CharField(max_length=200).run_validation(request.data.get('title') or f'{first.department.name} departmental requisition'),
            description='Consolidated from: ' + ', '.join(r.request_number for r in selected), cost_center=first.cost_center, gl_account=first.gl_account, budget_line=first.budget_line, branch=first.branch, project_code=first.project_code, currency=first.currency, sales_order=first.sales_order,
            needed_by=min((r.needed_by for r in selected if r.needed_by), default=None))
        for source in selected:
            for line in source.lines.all():
                RequisitionLine.objects.create(requisition=obj, **{field: getattr(line, field) for field in ['item_type', 'product', 'description', 'unit', 'quantity', 'unit_price']})
            source.parent_requisition = obj
            source.department_status, source.status = 'consolidated', 'consolidated'
            source.save(update_fields=['parent_requisition', 'department_status', 'status', 'updated_at'])
        obj.recalculate_total()
        log_business_event(event_group='data_lifecycle', event_type='create', tenant=tenant, actor=request.user, obj=obj, note=obj.description)
        from .views import RequisitionSerializer
        return Response(RequisitionSerializer(obj).data, status=201)
