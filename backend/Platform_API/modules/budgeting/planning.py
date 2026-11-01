"""Department submissions, annual consolidation, and shared workflow integration."""
from collections import defaultdict
from decimal import Decimal
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from Platform_API.modules.mixins import has_active_permission, tenant_or_403
from Platform_Core.models import Department, OrganizationMembership, Tenant, WorkflowInboxItem
from Platform_Core.organization import branch_allowed_for_user, unit_available, platform_branch
from Platform_Core.audit import log_business_event
from SL_Budgeting.models import Budget, BudgetLine


PLANNING_ENTITIES = {'department_budget', 'annual_budget', 'procurement_plan'}


def tenant_for(user):
    tenant = tenant_or_403(user)
    if tenant is None:
        raise PermissionDenied('Select an organization first.')
    return tenant


def can(user, code, app='SL_Budgeting'):
    profile = getattr(user, 'tenant_profile', None)
    if profile and profile.is_tenant_admin and not OrganizationMembership.objects.filter(user=user).exists():
        return True
    return has_active_permission(user, f'{app}.{code}')


def require(user, code, app='SL_Budgeting'):
    if not can(user, code, app):
        raise PermissionDenied('Your active role does not have permission for this action.')


def budgets_for(user, approval=False):
    tenant = tenant_for(user)
    qs = Budget.objects.filter(tenant=tenant).select_related('department', 'branch', 'annual_budget').prefetch_related('lines__account')
    if not (can(user, 'view_all_budget') or can(user, 'consolidate_budget') or approval and can(user, 'approve_budget')):
        qs = qs.filter(Q(created_by=user) | Q(department__head=user) | Q(department__deputy=user) | Q(department__members=user))
    allowed = []
    for budget in qs.distinct():
        if budget.branch_id and not branch_allowed_for_user(user, budget.branch):
            continue
        if budget.department_id and not unit_available(budget.department, user, budget.branch or platform_branch(tenant, user=user), membership_check=not approval, active=False):
            continue
        allowed.append(budget.pk)
    return Budget.objects.filter(tenant=tenant, pk__in=allowed).select_related('department', 'branch', 'annual_budget').prefetch_related('lines__account', 'department_budgets')


def total(budget):
    return budget.lines.aggregate(value=Sum('allocated_amount'))['value'] or Decimal('0')


def budget_access(obj, user):
    editable = obj.approval_status in {'draft', 'rejected'} and not obj.annual_budget_id and obj.status == 'draft'
    sourced = obj.department_budgets.exists()
    return {'can_edit': editable and not sourced and can(user, 'change_budget'), 'can_submit': editable and can(user, 'submit_budget'),
        'can_consolidate': obj.department_id is not None and obj.approval_status == 'approved' and not obj.annual_budget_id and can(user, 'consolidate_budget')}


def validate_budget_data(instance, attrs, user):
    tenant = tenant_for(user)
    department = attrs.get('department', getattr(instance, 'department', None))
    branch = attrs.get('branch', getattr(instance, 'branch', None))
    if branch and (branch.tenant_id != tenant.pk or not branch_allowed_for_user(user, branch)):
        raise ValidationError({'branch': 'Choose an allowed branch in this organization.'})
    if department and not can(user, 'view_all_budget') and user.pk not in {department.head_id, department.deputy_id} and not department.members.filter(pk=user.pk).exists():
        raise PermissionDenied('You may prepare budgets only for your department.')
    if not department and not (can(user, 'view_all_budget') or can(user, 'consolidate_budget')):
        raise PermissionDenied('Choose your department for this budget submission.')
    if department and department.branch_scope == 'selected' and not branch:
        raise ValidationError({'branch': 'Choose a branch for this department budget.'})
    if department and (department.tenant_id != tenant.pk or department.unit_type != 'department' or not unit_available(department, user, branch or platform_branch(tenant, user=user))):
        raise ValidationError({'department': 'Choose an active department available in this branch.'})
    start = attrs.get('start_date', getattr(instance, 'start_date', None))
    end = attrs.get('end_date', getattr(instance, 'end_date', None))
    year = attrs.get('financial_year', getattr(instance, 'financial_year', None))
    if year and (year.tenant_id != tenant.pk or start != year.start_date or end != year.end_date):
        raise ValidationError({'financial_year': 'Dates must match the selected financial year.'})
    if start and end and end < start:
        raise ValidationError({'end_date': 'End date cannot be before the start date.'})
    if instance and not budget_access(instance, user)['can_edit']:
        # Approved amounts and source submissions are immutable; only operational closure remains.
        if set(attrs) != {'status'} or attrs['status'] not in {'closed', 'archived'} or instance.department_id:
            raise ValidationError({'budget': 'Submitted, approved, and consolidated budgets cannot be edited.'})
    if attrs.get('status') == 'active' and (not instance or instance.department_id or instance.approval_status != 'approved'):
        raise ValidationError({'status': 'Activate an approved annual budget through its approval workflow.'})
    for line in attrs.get('lines', []):
        if line.get('allocated_amount', 0) < 0:
            raise ValidationError({'lines': 'Budget amounts cannot be negative.'})
        if any(line.get(field, 0) for field in ['committed_amount', 'obligated_amount', 'actual_amount']):
            raise ValidationError({'lines': 'Commitments and expenditure are recorded by transactions.'})
        if line.get('period_month') is not None and not 1 <= line['period_month'] <= 12:
            raise ValidationError({'lines': 'Choose a month between 1 and 12.'})
        if start and end and not start.year <= line.get('period_year', start.year) <= end.year:
            raise ValidationError({'lines': 'Each line must fall within the budget period.'})
        if department:
            line['cost_center'] = department.code
    return attrs


@transaction.atomic
def consolidate(user, identifiers, name, code):
    require(user, 'consolidate_budget')
    tenant = tenant_for(user)
    Tenant.objects.select_for_update(of=('self',)).get(pk=tenant.pk)
    if not identifiers or len(set(identifiers)) != len(identifiers):
        raise ValidationError({'budgets': 'Select one or more distinct approved departmental budgets.'})
    visible = set(budgets_for(user).values_list('pk', flat=True))
    rows = list(Budget.objects.select_for_update(of=('self',)).filter(tenant=tenant, pk__in=identifiers).order_by('pk'))
    if len(rows) != len(identifiers) or not set(identifiers) <= visible:
        raise ValidationError({'budgets': 'Choose departmental budgets available in this organization.'})
    first = rows[0]
    for row in rows:
        if not row.department_id or row.approval_status != 'approved' or row.annual_budget_id or row.status != 'draft':
            raise ValidationError({'budgets': 'Only approved departmental submissions can be consolidated once.'})
        if (row.start_date, row.end_date, row.currency, row.financial_year_id) != (first.start_date, first.end_date, first.currency, first.financial_year_id):
            raise ValidationError({'budgets': 'Use the same financial year, dates, and currency.'})
        if row.period_type != 'annual' or not row.lines.exists():
            raise ValidationError({'budgets': 'Annual departmental budgets must contain allocation lines.'})
    if len({(row.department_id, row.branch_id) for row in rows}) != len(rows):
        raise ValidationError({'budgets': 'Choose one approved submission per department and branch.'})
    if Budget.objects.filter(tenant=tenant, code=code).exists():
        raise ValidationError({'code': 'This budget code is already in use.'})
    annual = Budget.objects.create(tenant=tenant, name=name, code=code, start_date=first.start_date, end_date=first.end_date,
        financial_year=first.financial_year, period_type='annual', currency=first.currency, created_by=user,
        metadata={'source_budget_ids': [row.pk for row in rows]})
    allocations = {}
    for row in rows:
        for source in row.lines.all():
            key = (source.account_id, source.cost_center, source.project_code, source.period_year, source.period_month)
            if key not in allocations:
                allocations[key] = BudgetLine.objects.create(budget=annual, account_id=source.account_id, cost_center=source.cost_center,
                    project_code=source.project_code, period_year=source.period_year, period_month=source.period_month,
                    allocated_amount=0, notes=source.notes, metadata={'source_line_ids': []})
            line = allocations[key]
            line.allocated_amount += source.allocated_amount
            line.metadata['source_line_ids'].append(source.pk)
            line.save(update_fields=['allocated_amount', 'metadata'])
        row.annual_budget = annual
        row.approval_status = 'consolidated'
        row.save(update_fields=['annual_budget', 'approval_status', 'updated_at'])
    log_business_event(event_group='data_lifecycle', event_type='budget_consolidated', tenant=tenant, actor=user, obj=annual, note='Approved departmental budgets consolidated into an annual budget.')
    return annual


def submission_record(user, entity, identifier):
    tenant = tenant_for(user)
    Tenant.objects.select_for_update(of=('self',)).get(pk=tenant.pk)
    if entity == 'procurement_plan':
        from SL_Procurement.models import ProcurementPlan
        require(user, 'submit_procurementplan', 'SL_Procurement')
        from Platform_API.modules.procurement.plans import plans_for
        obj = plans_for(user).select_for_update(of=('self',)).filter(pk=identifier).first()
        if not obj or obj.status not in {'draft', 'rejected'}:
            raise ValidationError({'plan': 'Choose a draft or rejected procurement plan.'})
        validate_plan(obj)
        return obj
    require(user, 'submit_budget')
    obj = budgets_for(user).select_for_update(of=('self',)).filter(pk=identifier).first()
    if not obj or obj.approval_status not in {'draft', 'rejected'} or obj.annual_budget_id or obj.status != 'draft':
        raise ValidationError({'budget': 'Choose a draft or rejected budget available in this organization.'})
    if (entity == 'department_budget') != bool(obj.department_id):
        raise ValidationError({'budget': 'The selected workflow does not match this budget type.'})
    if total(obj) <= 0:
        raise ValidationError({'lines': 'Add a positive allocation before submitting.'})
    if obj.department_id:
        duplicates = Budget.objects.filter(tenant=tenant, department=obj.department, branch=obj.branch, start_date=obj.start_date,
            end_date=obj.end_date, approval_status__in=['submitted','approved','consolidated']).exclude(pk=obj.pk)
        if duplicates.exists():
            raise ValidationError({'budget': 'This department already has a submitted or approved budget for the period.'})
    return obj


def submission_metadata(obj, entity):
    if entity == 'procurement_plan':
        return {'organization_id': obj.tenant_id, 'annual_budget_id': obj.annual_budget_id,
            'amount': str(obj.lines.aggregate(value=Sum('estimated_amount'))['value'] or 0), 'currency': obj.annual_budget.currency}
    return {'organization_id': obj.tenant_id, 'branch_id': obj.branch_id, 'department_id': obj.department_id,
        'department_code': obj.department.code if obj.department_id else '', 'amount': str(total(obj)), 'currency': obj.currency}


def validate_plan(obj):
    budget = obj.annual_budget
    if budget.department_id or budget.approval_status != 'approved' or budget.status != 'active':
        raise ValidationError({'annual_budget': 'Choose an approved active annual budget.'})
    lines = list(obj.lines.select_related('budget_line'))
    if not lines:
        raise ValidationError({'lines': 'Add at least one procurement item.'})
    totals = defaultdict(Decimal)
    for line in lines:
        if line.budget_line.budget_id != budget.pk or line.estimated_amount <= 0 or line.quantity <= 0:
            raise ValidationError({'lines': 'Each item needs a positive quantity and amount against this annual budget.'})
        if not line.planned_date or not budget.start_date <= line.planned_date <= budget.end_date:
            raise ValidationError({'lines': 'Choose a procurement date within the budget year.'})
        totals[line.budget_line_id] += line.estimated_amount
        if totals[line.budget_line_id] > line.budget_line.allocated_amount:
            raise ValidationError({'lines': 'Planned spending exceeds its annual budget allocation.'})


def planning_can_submit(user, module, entity):
    return entity in PLANNING_ENTITIES and module == ('procurement' if entity == 'procurement_plan' else 'budgeting') and can(user, 'submit_procurementplan' if entity == 'procurement_plan' else 'submit_budget', 'SL_Procurement' if entity == 'procurement_plan' else 'SL_Budgeting')


def planning_can_review(item, user):
    if item.entity_type not in PLANNING_ENTITIES:
        return True
    if item.tenant_id != tenant_for(user).pk or (item.metadata or {}).get('submitted_by') == user.pk:
        return False
    if item.entity_type == 'procurement_plan':
        return can(user, 'approve_procurementplan', 'SL_Procurement')
    return can(user, 'approve_budget') and budgets_for(user, approval=True).filter(pk=item.entity_id).exists()


def apply_decision(item, decision, actor):
    entity = item.entity_type
    if entity == 'procurement_plan':
        from SL_Procurement.models import ProcurementPlan
        obj = ProcurementPlan.objects.select_for_update(of=('self',)).get(tenant=item.tenant, pk=item.entity_id)
        field = 'status'
    else:
        obj = Budget.objects.select_for_update(of=('self',)).get(tenant=item.tenant, pk=item.entity_id)
        field = 'approval_status'
    if decision == 'in_progress':
        setattr(obj, field, 'submitted')
        if not obj.submitted_by_id or (item.metadata or {}).get("previous_inbox_item_id") is None:
            obj.submitted_by_id = (item.metadata or {}).get("submitted_by", actor.pk)
    elif decision == 'reject':
        setattr(obj, field, 'rejected')
    elif decision == 'complete':
        if getattr(obj, field) != 'submitted':
            raise ValidationError({'approval': 'This submission is no longer awaiting approval.'})
        if entity == 'procurement_plan':
            validate_plan(obj)
        setattr(obj, field, 'approved')
        obj.approved_by, obj.approved_at = actor, timezone.now()
        if entity == 'annual_budget':
            obj.status = 'active'
    obj.save()
    log_business_event(event_group='workflow', event_type='planning_'+decision, tenant=item.tenant, actor=actor, obj=obj, note='Planning approval updated through Workflow Center.')


def planning_can_view(item, user):
    if item.entity_type not in PLANNING_ENTITIES:
        return True
    if item.tenant_id != tenant_for(user).pk:
        return False
    if item.entity_type == 'procurement_plan':
        from Platform_API.modules.procurement.plans import plans_for
        return can(user, 'view_procurementplan', 'SL_Procurement') and plans_for(user).filter(pk=item.entity_id).exists()
    return (can(user, 'view_budget') or can(user, 'approve_budget')) and budgets_for(user, approval=True).filter(pk=item.entity_id).exists()


def restrict_planning_items(qs, user):
    identifiers = [item.pk for item in qs.filter(entity_type__in=PLANNING_ENTITIES) if planning_can_view(item, user)]
    return qs.filter(~Q(entity_type__in=PLANNING_ENTITIES) | Q(pk__in=identifiers))
