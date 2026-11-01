# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Projects & Tasks APIs. All records are resolved from the active workspace."""
import csv
from datetime import date, timedelta

from django.http import FileResponse, HttpResponse
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    apply_tenant_filter,
    has_active_permission,
    resolve_user_tenant,
    tenant_or_403,
)
from Platform_Core.audit import log_business_event
from Platform_Core.models import OrganizationBranchRoleAssignment, OrganizationMembership, SystemNotification, TenantBranch, WorkflowEntityBinding, WorkflowInboxItem
from Platform_Core.platform import get_active_tenant_module_slugs
from SL_Projects.models import Project, ProjectBranchAccess, ProjectDocument, ProjectMember, ProjectMilestone, ProjectTask, TaskAttachment, TaskChecklistItem, TaskCollaborator, TaskComment, TaskDependency, TaskFollowUp, TaskUpdate, TicketTaskStatusSyncPolicy
from SL_Ticketing.models import Ticket
from SL_Projects.general import get_general_project
from SL_Projects.task_types import TASK_TYPES
from SL_Projects.configuration import get_project_settings, active_task_types
from SL_Projects.document_preview import document_preview


MODULE_SLUG = "projects-tasks"


class ProjectsPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


def _tenant_and_activation(request):
    tenant = tenant_or_403(request.user)
    if tenant is not None and not request.user.is_superuser:
        active_modules = get_active_tenant_module_slugs(tenant)
        if MODULE_SLUG not in active_modules:
            raise PermissionDenied("Projects & Tasks is not enabled for this organization.")
    return tenant


def _active_branch_id(user):
    if user.is_superuser:
        return None
    membership = OrganizationMembership.objects.filter(user=user, is_active=True).order_by(
        "-is_default", "tenant__name"
    ).first()
    return membership.branch_id if membership else None


def _active_role_name(user, tenant):
    if user.is_superuser:
        return ""
    membership = OrganizationMembership.objects.filter(user=user, tenant=tenant, is_active=True).order_by("-is_default").first()
    return membership.effective_role_group_name() if membership else ""


def _has_permission(user, codename):
    # Selected task roles must not inherit unrelated permissions from another role.
    tenant = resolve_user_tenant(user)
    membership = (
        OrganizationMembership.objects.filter(user=user, tenant=tenant, is_active=True)
        .order_by("-is_default", "tenant__name")
        .first()
        if tenant not in (None, NO_TENANT_ACCESS)
        else None
    )
    # Organization administrators manage the entire active organization. This
    # must be evaluated against the selected tenant, never an unrelated
    # membership that happens to belong to the same user.
    if membership and membership.is_org_admin:
        return True
    role = _active_role_name(user, tenant) if tenant not in (None, NO_TENANT_ACCESS) else ""
    if role.startswith('tenant:') and not role.startswith(f'tenant:{tenant.id}:'):
        return False
    if role and role not in {"Tenant Admin", "Platform Admin", "Super Admin"} and not user.is_superuser:
        group = user.groups.filter(name=role).first()
        if group:
            return group.permissions.filter(content_type__app_label="SL_Projects", codename=codename).exists()
    return has_active_permission(user, f"SL_Projects.{codename}")


def _require(user, codename):
    allowed = _has_permission(user, codename)
    if codename == "view_projecttask":
        allowed = allowed or _has_permission(user, "view_own_projecttask") or _has_permission(user, "view_all_projecttask")
    if not allowed:
        raise PermissionDenied("Your active role does not have permission for this action.")


def _require_project_read(user):
    """Full project records require Project View, independently of task access."""
    _require(user, "view_project")


def _can_view_all_tasks(user):
    # Branch-wide access is explicit; ordinary task viewing is project scoped.
    return _has_permission(user, "view_all_projecttask")


# Assignment grants work updates on that task, without granting management rights
# over other tasks, project transfers, reassignment, or deactivation.
TASK_PARTICIPANT_PERMISSIONS = {
    'change_projecttask', 'update_projecttask_progress', 'complete_projecttask',
    'reopen_projecttask', 'add_taskfollowup', 'change_taskfollowup',
    'add_taskcomment', 'add_taskattachment',
}
TASK_PARTICIPANT_FIELDS = {
    'title', 'description', 'task_type', 'priority', 'start_date', 'due_date',
    'estimated_hours', 'milestone', 'status',
}


def _is_task_participant(task, user):
    if not user.is_active:
        return False
    named = task.primary_assignee_id == user.pk
    if not named:
        prefetched = getattr(task, '_prefetched_objects_cache', {}).get('collaborators')
        if prefetched is not None:
            named = any(row.user_id == user.pk and row.participation_role in {'accountable', 'supporting'} for row in prefetched)
        else:
            named = task.collaborators.filter(user=user, participation_role__in=['accountable', 'supporting']).exists()
    tenant = resolve_user_tenant(user) if named else None
    if not named or getattr(tenant, 'pk', None) != task.tenant_id or not tenant.is_active:
        return False
    # An explicitly revoked membership overrides a stale legacy tenant profile.
    if OrganizationMembership.objects.filter(user=user, tenant_id=task.tenant_id, is_active=False).exists():
        return False
    from Platform_Core.organization import branch_allowed_for_user
    return branch_allowed_for_user(user, task.branch)


def _task_permission(task, user, code, role_allowed=None):
    if not user.is_active:
        return False
    if role_allowed is None:
        role_allowed = _has_permission(user, code)
    return role_allowed or (code in TASK_PARTICIPANT_PERMISSIONS and _is_task_participant(task, user))


def _require_task_permission(task, user, code):
    if not _task_permission(task, user, code):
        raise PermissionDenied('Your active role or task assignment does not allow this action.')


def task_participant_can_forward(user, identifier):
    try:
        identifier = int(identifier)
    except (TypeError, ValueError):
        return False
    tenant = resolve_user_tenant(user)
    if tenant in (None, NO_TENANT_ACCESS) or MODULE_SLUG not in get_active_tenant_module_slugs(tenant):
        return False
    task = _task_scope(user).filter(pk=identifier, is_active=True).first()
    return bool(task and _is_task_participant(task, user))


def _personal_tasks(user):
    tenant = resolve_user_tenant(user)
    role = _active_role_name(user, tenant) if tenant not in (None, NO_TENANT_ACCESS) else ""
    own = Q(primary_assignee=user) | Q(collaborators__user=user)
    if role:
        own |= Q(assigned_role__name=role)
    return own


def _task_scope(user):
    qs = apply_tenant_filter(
        ProjectTask.objects.select_related("branch", "project", "milestone", "primary_assignee", "assigned_role", "source_ticket"), user
    )
    branch_id = _active_branch_id(user)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if not _can_view_all_tasks(user):
        visible = _personal_tasks(user) | Q(created_by=user)
        if _has_permission(user, "view_projecttask"):
            visible |= Q(project__members__user=user) | Q(project__manager=user) | Q(project__owner=user)
        qs = qs.filter(visible)
    return qs.distinct().prefetch_related("collaborators")


def _project_scope(user):
    qs = apply_tenant_filter(Project.objects.select_related("branch", "manager", "owner"), user)
    branch_id = _active_branch_id(user)
    if branch_id:
        qs = qs.filter(Q(branch_id=branch_id) | Q(participating_branches__branch_id=branch_id))
    if not _can_view_all_tasks(user):
        qs = qs.filter(Q(is_general=True) | Q(manager=user) | Q(owner=user) | Q(created_by=user) | Q(members__user=user) | Q(pk__in=_task_scope(user).values("project_id")))
    return qs.distinct()


def _ensure_tenant_relation(tenant, obj, label):
    owner_tenant_id = obj.project.tenant_id if isinstance(obj, ProjectMilestone) else getattr(obj, "tenant_id", None)
    if obj is not None and tenant is not None and owner_tenant_id != tenant.id:
        raise serializers.ValidationError({label: f"{label.replace('_', ' ').title()} belongs to another organization."})


def _ensure_active_tenant_user(tenant, user, label, branch=None):
    """Validate a tenant user, optionally requiring access to a working branch."""
    if user is None:
        return
    memberships = OrganizationMembership.objects.filter(
        tenant=tenant, user=user, is_active=True
    )
    if branch is not None:
        memberships = memberships.filter(Q(branch=branch) | Q(branches=branch) | Q(branch_role_assignments__branch=branch, branch_role_assignments__is_active=True) | Q(is_org_admin=True) | Q(branch__isnull=True, branches__isnull=True, branch_role_assignments__isnull=True))
    if not memberships.exists():
        scope = " in this branch" if branch is not None else ""
        raise serializers.ValidationError({
            label: f"Choose an active organization user{scope} for {label.replace('_', ' ')}."
        })



def _working_branch_id(user, tenant):
    branch_id = _active_branch_id(user)
    if not branch_id and tenant is not None:
        branches = list(TenantBranch.objects.filter(tenant=tenant, is_active=True).values_list("pk", flat=True)[:2])
        if len(branches) == 1:
            branch_id = branches[0]
    return branch_id


def _eligible_task_memberships(tenant, branch, project=None):
    allowed = (Q(branch=branch) | Q(branches=branch)
               | Q(branch_role_assignments__branch=branch, branch_role_assignments__is_active=True)
               | Q(is_org_admin=True)
               | Q(branch__isnull=True, branches__isnull=True, branch_role_assignments__isnull=True))
    if project is not None:
        allowed |= Q(user__project_memberships__project=project, user__project_memberships__branch=branch)
    return OrganizationMembership.objects.filter(
        tenant=tenant, is_active=True, user__is_active=True,
    ).filter(allowed).select_related("user").distinct().order_by("user__first_name", "user__last_name", "user__username")


def _validate_task_assignee(tenant, branch, project, person):
    if person is not None and not _eligible_task_memberships(tenant, branch, project).filter(user=person).exists():
        raise serializers.ValidationError({"primary_assignee": "Choose an active branch or project team member."})


def _related_records(request, rows, serializer, search_fields, ordering_fields, default_order):
    if value := request.query_params.get("search", "").strip():
        conditions = Q()
        for field in search_fields:
            conditions |= Q(**{f"{field}__icontains": value})
        rows = rows.filter(conditions).distinct()
    ordering = request.query_params.get("ordering", default_order)
    if ordering.lstrip("-") not in ordering_fields:
        ordering = default_order
    rows = rows.order_by(ordering, "pk")
    return _paged_or_list(request, rows, lambda records: serializer(records, many=True, context={"request": request}).data)


def _paged_or_list(request, records, serializer):
    if "page" in request.query_params or "page_size" in request.query_params:
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(records, request)
        return paginator.get_paginated_response(serializer(page))
    return Response(serializer(records))


def _task_approval_state(task):
    bindings = WorkflowEntityBinding.objects.filter(
        workflow__tenant=task.tenant, workflow__is_active=True,
        workflow__status="published", module_slug=MODULE_SLUG,
        entity_type="project_task", is_active=True,
    )
    required = any(not item.trigger_events or "submit" in item.trigger_events for item in bindings)
    pending = WorkflowInboxItem.objects.filter(
        tenant=task.tenant, module_slug=MODULE_SLUG, entity_type="project_task",
        entity_id=task.pk, status__in=["pending", "deferred"],
    ).exists()
    return required, pending, get_project_settings(task.tenant)


def _task_status_reason(task, user, target, approval, previous_status=None, rights=None):
    allowed = lambda code: rights[code] if rights is not None else _task_permission(task, user, code)
    current = previous_status or task.status
    if target == current:
        return ""
    if not task.is_active:
        return "This task is inactive. Reactivate it before changing status."
    if not allowed("change_projecttask"):
        return "Your role or task assignment does not allow changing status."
    required, pending, config = approval
    if target not in config.enabled_task_statuses:
        return "This status is disabled in Project settings."
    if pending:
        return "An approval is pending. Wait for its decision before changing status."
    if current in {"completed", "cancelled"} and not allowed("reopen_projecttask"):
        return "Your role needs permission to reopen closed tasks."
    if target == "reopened" and current not in {"completed", "cancelled"}:
        return "Reopen a completed or cancelled task when more work is needed."
    if target == "completed" and not allowed("complete_projecttask"):
        return "Your role needs permission to complete tasks."
    if required and target in {"in_review", "completed", "cancelled"}:
        return "Approval is required. Use Send for approval."
    return ""


def _task_status_options(task, user, rights=None):
    approval = _task_approval_state(task)
    return [
        {"value": value, "label": label,
         "disabled": bool(reason := _task_status_reason(task, user, value, approval, rights=rights)), "reason": reason}
        for value, label in ProjectTask.STATUS_CHOICES
    ]


def _validate_task_status_change(task, user, target, previous_status=None):
    if not isinstance(target, str) or target not in dict(ProjectTask.STATUS_CHOICES):
        raise serializers.ValidationError({"status": "Choose a valid task status."})
    reason = _task_status_reason(task, user, target, _task_approval_state(task), previous_status)
    if reason:
        raise serializers.ValidationError({"status": reason})


def _apply_task_status(task, previous_status):
    if task.status == previous_status:
        return
    if task.status == "completed":
        task.progress_percentage = 100
        task.completion_date = timezone.localdate()
    elif previous_status in {"completed", "cancelled"}:
        task.completion_date = None
        task.workflow_status = ""
        task.workflow_stage = ""
        totals = task.checklist_items.aggregate(total=Count("id"), completed=Count("id", filter=Q(is_completed=True)))
        task.progress_percentage = min(99, round(totals["completed"] / totals["total"] * 100)) if totals["total"] else 0


def _require_active_task(task):
    if not task.is_active:
        raise serializers.ValidationError({"detail": "This task is inactive. Reactivate it before making changes."})


def _set_task_active(task, active, actor):
    if task.is_active == active:
        return
    if not active and _task_approval_state(task)[1]:
        raise serializers.ValidationError({"detail": "Finish the pending approval before deactivating this task."})
    task.is_active = active
    task.deactivated_at = None if active else timezone.now()
    task.deactivated_by = None if active else actor
    task.updated_by = actor
    task.save(update_fields=["is_active", "deactivated_at", "deactivated_by", "updated_by", "updated_at"])
    label = "reactivated" if active else "deactivated"
    TaskUpdate.objects.create(task=task, updated_by=actor, progress_percentage=task.progress_percentage,
        update_description=f"Task {label}. Existing assignment and history retained.")
    _sync_parent_task_progress(task)
    _sync_project_progress(task)
    log_business_event(event_group="data_lifecycle", event_type=label, tenant=task.tenant, actor=actor,
        obj=task, branch=task.branch, note=f"Task {label}; records retained.")


def _validate_task_type(config, value, current=None):
    if current is not None and value == current:
        return
    active = {row["value"] for row in config.task_types if row.get("is_active", True)}
    if not value or value == "other":
        raise serializers.ValidationError({"task_type": "Choose a task type or type a name for Other."})
    if value in {row["value"] for row in config.task_types} and value not in active:
        raise serializers.ValidationError({"task_type": "This task type is inactive. Choose an active type."})
    if value not in active and not config.allow_custom_task_types:
        raise serializers.ValidationError({"task_type": "Choose an active type configured in Project settings."})


def _next_reference(tenant, model, prefix):
    """Serialize reference allocation per tenant so concurrent drafts stay unique."""
    type(tenant).objects.select_for_update().get(pk=tenant.pk)
    field = "number" if model is ProjectTask else "code"
    reference_prefix = f"{prefix}-{timezone.localdate():%Y}-"
    references = model.objects.filter(tenant=tenant, **{f"{field}__startswith": reference_prefix}).values_list(field, flat=True)
    sequence = max((int(value[len(reference_prefix):]) for value in references if value[len(reference_prefix):].isdigit()), default=0) + 1
    return f"{reference_prefix}{sequence:04d}"


def _date_range(request, *, start_field, end_field):
    """Return validated ISO date filters for a register query."""
    start_value = request.query_params.get("date_from", "").strip()
    end_value = request.query_params.get("date_to", "").strip()
    start = parse_date(start_value) if start_value else None
    end = parse_date(end_value) if end_value else None
    if start_value and start is None:
        raise serializers.ValidationError({"date_from": "Use a valid start date (YYYY-MM-DD)."})
    if end_value and end is None:
        raise serializers.ValidationError({"date_to": "Use a valid end date (YYYY-MM-DD)."})
    if start and end and end < start:
        raise serializers.ValidationError({"date_to": "End date cannot be before start date."})
    filters = {}
    if start:
        filters[f"{start_field}__gte"] = start
    if end:
        filters[f"{end_field}__lte"] = end
    return filters



def _filter_task_register(qs, request):
    params = request.query_params
    activity = params.get("activity", "active")
    if activity not in {"active", "inactive", "all"}:
        raise serializers.ValidationError({"activity": "Choose Active, Inactive, or All tasks."})
    if activity != "all":
        qs = qs.filter(is_active=activity == "active")
    for field in ("status", "priority", "task_type"):
        if (value := params.get(field)) and value != "all":
            qs = qs.filter(**{field: value})
    for field in ("number", "title"):
        if value := params.get(field, "").strip():
            qs = qs.filter(**{f"{field}__icontains": value})
    if value := params.get("source_ticket", "").strip():
        qs = qs.filter(source_ticket__public_id__icontains=value)
    if params.get("overdue") == "1":
        qs = qs.exclude(status__in=["completed", "cancelled"]).filter(due_date__lt=timezone.localdate())
    if params.get("ticket_linked") == "1":
        qs = qs.filter(source_ticket__isnull=False)
    for field in ("project", "milestone", "assignee"):
        value = params.get(field)
        if not value or value == "all":
            continue
        if field == "assignee" and value == "unassigned":
            qs = qs.filter(primary_assignee__isnull=True)
            continue
        try:
            identifier = int(value)
            if identifier <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise serializers.ValidationError({field: "Choose a valid record."})
        if field == "assignee":
            qs = qs.filter(Q(primary_assignee_id=identifier) | Q(collaborators__user_id=identifier)).distinct()
        else:
            qs = qs.filter(**{f"{field}_id": identifier})
    progress = {}
    for field, lookup in (("progress_min", "progress_percentage__gte"), ("progress_max", "progress_percentage__lte")):
        if (value := params.get(field)) not in (None, ""):
            try:
                value = int(value)
                if not 0 <= value <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                raise serializers.ValidationError({field: "Enter a percentage between 0 and 100."})
            progress[field] = value
            qs = qs.filter(**{lookup: value})
    if progress.get("progress_min", 0) > progress.get("progress_max", 100):
        raise serializers.ValidationError({"progress_max": "Maximum progress cannot be below minimum progress."})
    if value := params.get("search", "").strip():
        qs = qs.filter(Q(number__icontains=value) | Q(title__icontains=value) | Q(description__icontains=value)
            | Q(project__name__icontains=value) | Q(source_ticket__public_id__icontains=value)
            | Q(primary_assignee__username__icontains=value) | Q(primary_assignee__first_name__icontains=value)
            | Q(primary_assignee__last_name__icontains=value))
    if params.get("scope") == "mine":
        qs = qs.filter(_personal_tasks(request.user)).distinct()
    # Project team uses the permitted project/task scope from _task_scope.
    # An extra assigned-role filter hides person-assigned and unassigned drafts.
    return qs.filter(**_date_range(request, start_field="due_date", end_field="due_date"))


def _would_create_dependency_cycle(task_id, depends_on_id):
    """Return whether adding task -> depends_on would create a dependency loop."""
    pending = [depends_on_id]
    visited = set()
    while pending:
        current_id = pending.pop()
        if current_id == task_id:
            return True
        if current_id in visited:
            continue
        visited.add(current_id)
        pending.extend(
            TaskDependency.objects.filter(task_id=current_id).values_list("depends_on_id", flat=True)
        )
    return False


def _sync_project_progress(task, project_id=None):
    """Keep a parent project's progress aligned with its active task register."""
    project_id = project_id or task.project_id
    if not project_id:
        return
    aggregate = ProjectTask.objects.filter(project_id=project_id, is_active=True).exclude(status="cancelled").aggregate(
        progress=Avg("progress_percentage")
    )
    progress = round(aggregate["progress"] or 0)
    Project.objects.filter(pk=project_id).exclude(progress_percentage=progress).update(progress_percentage=progress)


def _sync_parent_task_progress(task):
    """Roll child progress up through a task hierarchy without changing lifecycle status."""
    current = task
    visited = set()
    while current.parent_task_id and current.parent_task_id not in visited:
        parent = current.parent_task
        visited.add(parent.pk)
        aggregate = ProjectTask.objects.filter(parent_task=parent, is_active=True).exclude(status="cancelled").aggregate(
            progress=Avg("progress_percentage")
        )
        progress = round(aggregate["progress"] or 0)
        ProjectTask.objects.filter(pk=parent.pk).exclude(progress_percentage=progress).update(progress_percentage=progress)
        parent.progress_percentage = progress
        current = parent


def _sync_task_checklist_progress(task):
    """Derive progress from completed deliverables instead of a typed percentage."""
    totals = task.checklist_items.aggregate(
        total=Count("id"), completed=Count("id", filter=Q(is_completed=True))
    )
    if not totals["total"]:
        return task.progress_percentage
    progress = round((totals["completed"] / totals["total"]) * 100)
    ProjectTask.objects.filter(pk=task.pk).update(progress_percentage=progress)
    task.progress_percentage = progress
    _sync_parent_task_progress(task)
    _sync_project_progress(task)
    return progress


def _notify_project_user(*, recipient, actor, tenant, title, message, route_path, source_type, source_id):
    """Create one actionable unread reminder per project event and recipient."""
    if not recipient or recipient.pk == actor.pk:
        return
    if SystemNotification.objects.filter(
        tenant=tenant, recipient=recipient, source_type=source_type, source_id=source_id, is_read=False,
    ).exists():
        return
    SystemNotification.objects.create(
        tenant=tenant,
        recipient=recipient,
        category="reminder",
        title=title[:200],
        message=message,
        route_path=route_path,
        source_type=source_type,
        source_id=source_id,
    )


def _notify_task_participants(*, task, actor, title, message, source_type):
    """Notify the accountable assignee and collaborators without duplicates."""
    recipients = {
        collaborator.user_id: collaborator.user
        for collaborator in task.collaborators.select_related("user")
    }
    if task.primary_assignee_id:
        recipients[task.primary_assignee_id] = task.primary_assignee
    for recipient in recipients.values():
        _notify_project_user(
            recipient=recipient,
            actor=actor,
            tenant=task.tenant,
            title=title,
            message=message,
            route_path=f"/projects/tasks/{task.pk}",
            source_type=source_type,
            source_id=task.pk,
        )


def _sync_source_ticket_when_complete(*, task, actor):
    """Apply the optional one-way ticket policy; never automatically close tickets."""
    if not task.source_ticket_id or task.status != "completed":
        return
    policy = TicketTaskStatusSyncPolicy.objects.filter(tenant=task.tenant, is_enabled=True).first()
    if not policy or task.source_ticket.project_tasks.exclude(status="completed").exists():
        return
    ticket = task.source_ticket
    if ticket.status == policy.target_ticket_status or ticket.status == "closed":
        return
    previous_status = ticket.status
    ticket.status = policy.target_ticket_status
    ticket.save(update_fields=["status", "resolved_at", "updated_at"])
    log_business_event(event_group="ticket_task_sync", event_type="ticket_status_synced", tenant=task.tenant, actor=actor, obj=ticket, branch=task.branch, note=f"Ticket moved from {previous_status} to {ticket.status} after all linked tasks completed.")


def _serializer_permission(serializer, code):
    request = serializer.context.get('request')
    if not request:
        return False
    cache = serializer.context.setdefault('_project_permissions', {})
    if code not in cache:
        cache[code] = _has_permission(request.user, code)
    return cache[code]


def _serializer_task_rights(serializer, task):
    request = serializer.context.get('request')
    if not request:
        return {}
    cache = serializer.context.setdefault('_task_work_rights', {})
    if task.pk not in cache:
        roles = {code: _serializer_permission(serializer, code) for code in TASK_PARTICIPANT_PERMISSIONS}
        participant = not all(roles.values()) and _is_task_participant(task, request.user)
        cache[task.pk] = {code: bool(request.user.is_active and (allowed or participant)) for code, allowed in roles.items()}
    return cache[task.pk]


def _project_has_history(project):
    return (project.tasks.exists() or project.milestones.exists() or ProjectDocument.objects.filter(project=project).exists()
        or Ticket.objects.filter(project=project).exists()
        or WorkflowInboxItem.objects.filter(tenant=project.tenant, module_slug=MODULE_SLUG, entity_type='project', entity_id=project.pk).exists())


class ProjectSerializer(serializers.ModelSerializer):
    access = serializers.SerializerMethodField()
    def get_access(self, obj):
        allowed = lambda code: _serializer_permission(self, code)
        return {'can_edit': allowed('change_project'), 'can_delete': obj.status == 'draft' and not obj.is_general and allowed('delete_project') and not _project_has_history(obj),
            'can_close': not obj.is_general and allowed('close_project'), 'can_manage_team': allowed('manage_project_members'), 'can_assign_manager': allowed('assign_project_manager'),
            'can_add_milestone': allowed('add_projectmilestone'), 'can_change_milestone': allowed('change_projectmilestone'), 'can_delete_milestone': allowed('delete_projectmilestone'),
            'can_add_document': allowed('add_projectdocument'), 'can_delete_document': allowed('delete_projectdocument'), 'can_add_task': allowed('add_projecttask')}

    manager_name = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = Project
        fields = "__all__"
        read_only_fields = ("workflow_status", "workflow_stage", "progress_percentage", "is_general", "tenant", "created_by", "updated_by", "created_at", "updated_at")

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ""

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() or obj.owner.username if obj.owner else ""

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a project name.")
        return value

    def validate(self, attrs):
        if self.instance and self.instance.is_general:
            for field in ("name", "code", "branch", "status"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({field: "The General project is reserved for general work and cannot be renamed, moved or closed."})
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        target_end = attrs.get("target_end_date", getattr(self.instance, "target_end_date", None))
        if start and target_end and target_end < start:
            raise serializers.ValidationError({"target_end_date": "Target end date cannot be before the start date."})
        for field in ("estimated_budget", "actual_cost"):
            value = attrs.get(field, getattr(self.instance, field, None))
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Enter an amount of zero or more."})
        return attrs


class TaskSerializer(serializers.ModelSerializer):
    access = serializers.SerializerMethodField()
    def get_access(self, obj):
        allowed = lambda code: _serializer_permission(self, code)
        rights = _serializer_task_rights(self, obj)
        work = lambda code: rights.get(code, False)
        active = obj.is_active
        return {'can_edit': active and work('change_projecttask'), 'can_assign': active and allowed('assign_projecttask'),
            'can_deactivate': allowed('deactivate_projecttask'), 'can_move_project': active and allowed('change_projecttask'), 'can_create_subtask': active and allowed('change_projecttask') and allowed('add_projecttask'),
            'can_update_progress': active and work('update_projecttask_progress'), 'can_add_followup': active and work('add_taskfollowup'),
            'can_complete_followup': active and work('change_taskfollowup'), 'can_comment': active and work('add_taskcomment'),
            'can_attach': active and work('add_taskattachment'), 'can_remove_attachment': active and allowed('delete_taskattachment')}

    status_options = serializers.SerializerMethodField()
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), required=True, allow_null=False)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    assignee_name = serializers.SerializerMethodField()
    source_ticket_reference = serializers.CharField(source="source_ticket.public_id", read_only=True)

    class Meta:
        model = ProjectTask
        fields = "__all__"
        read_only_fields = ("assigned_role", "progress_percentage", "actual_hours", "tenant", "created_by", "updated_by", "assigned_by", "created_at", "updated_at", "completion_date", "workflow_status", "workflow_stage", "is_active", "deactivated_at", "deactivated_by")

    def get_status_options(self, obj):
        request = self.context.get("request")
        return _task_status_options(obj, request.user, _serializer_task_rights(self, obj)) if request else []

    def get_assignee_name(self, obj):
        return obj.primary_assignee.get_full_name() or obj.primary_assignee.username if obj.primary_assignee else ""

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a task title.")
        return value

    def validate(self, attrs):
        instance = self.instance
        start = attrs.get("start_date", getattr(instance, "start_date", None))
        due = attrs.get("due_date", getattr(instance, "due_date", None))
        project = attrs.get("project", getattr(instance, "project", None))
        branch = attrs.get("branch", getattr(instance, "branch", None))
        milestone = attrs.get("milestone", getattr(instance, "milestone", None))
        parent = attrs.get("parent_task", getattr(instance, "parent_task", None))
        if start and due and due < start:
            raise serializers.ValidationError({"due_date": "Due date cannot be before the task start date."})
        if project and milestone and milestone.project_id != project.id:
            raise serializers.ValidationError({"milestone": "Choose a milestone belonging to the selected project."})
        if (
            project
            and branch
            and branch.pk != project.branch_id
            and not project.participating_branches.filter(branch=branch).exists()
        ):
            raise serializers.ValidationError({
                "branch": "Add this branch to the project before creating or moving work there."
            })
        if instance and parent and parent.id == instance.id:
            raise serializers.ValidationError({"parent_task": "A task cannot be its own parent."})
        if "parent_task" in attrs and parent and not parent.is_active:
            raise serializers.ValidationError({"parent_task": "Reactivate the parent task before linking new work."})
        for field in ("estimated_hours", "actual_hours"):
            if field in attrs and attrs[field] is not None and attrs[field] < 0:
                raise serializers.ValidationError({field: "Hours cannot be negative."})
        return attrs


class TicketTaskStatusSyncPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketTaskStatusSyncPolicy
        fields = ("is_enabled", "target_ticket_status", "updated_at")
        read_only_fields = ("updated_at",)


class TaskCollaboratorSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskCollaborator
        fields = "__all__"
        read_only_fields = ("task", "created_at")

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class TaskChecklistItemSerializer(serializers.ModelSerializer):
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskChecklistItem
        fields = "__all__"
        read_only_fields = ("task", "completed_by", "completed_at", "created_by", "created_at", "updated_at")

    def get_completed_by_name(self, obj):
        return obj.completed_by.get_full_name() or obj.completed_by.username if obj.completed_by else ""

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a deliverable or checklist item.")
        return value


class TaskUpdateSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.username if obj.updated_by else "System"

    class Meta:
        model = TaskUpdate
        fields = "__all__"
        read_only_fields = ("task", "updated_by", "progress_percentage", "created_at")

    def validate_progress_percentage(self, value):
        if not 0 <= value <= 100:
            raise serializers.ValidationError("Progress must be between 0 and 100.")
        return value

    def validate_update_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("Describe the work completed or the current blocker.")
        return value.strip()

    def validate_time_spent_hours(self, value):
        if value < 0:
            raise serializers.ValidationError("Time spent cannot be negative.")
        return value


class TaskFollowUpSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskFollowUp
        fields = "__all__"
        read_only_fields = ("task", "created_at", "updated_at", "completed_at")

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() or obj.owner.username if obj.owner else "Unassigned"

    def validate_notes(self, value):
        return value.strip()


class TaskCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    mention_names = serializers.SerializerMethodField()
    mention_user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        write_only=True,
        required=False,
    )

    class Meta:
        model = TaskComment
        fields = "__all__"
        read_only_fields = ("task", "author", "mentions", "created_at", "updated_at")

    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.username if obj.author else "System process"

    def get_mention_names(self, obj):
        return [user.get_full_name() or user.username for user in obj.mentions.all()]

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter a comment before saving.")
        return value.strip()


class TaskAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    task_number = serializers.CharField(source="task.number", read_only=True)
    task_title = serializers.CharField(source="task.title", read_only=True)
    source = serializers.SerializerMethodField()

    class Meta:
        model = TaskAttachment
        fields = "__all__"
        read_only_fields = ("task", "uploaded_by", "original_name", "content_type", "size_bytes", "created_at")

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username if obj.uploaded_by else "System process"

    def get_source(self, obj):
        return "task"


class ProjectDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDocument
        fields = "__all__"
        read_only_fields = ("project", "uploaded_by", "original_name", "content_type", "size_bytes", "created_at")

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username if obj.uploaded_by else "System process"

    def get_source(self, obj):
        return "project"


class ProjectMilestoneSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectMilestone
        fields = "__all__"
        read_only_fields = ("project", "created_at", "updated_at")

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() or obj.owner.username if obj.owner else "Unassigned"

    def validate_progress_percentage(self, value):
        if not 0 <= value <= 100:
            raise serializers.ValidationError("Progress must be between 0 and 100.")
        return value


class ProjectMemberSerializer(serializers.ModelSerializer):
    access = serializers.SerializerMethodField()
    def get_access(self, obj):
        return {'can_remove': _serializer_permission(self, 'manage_project_members') and (obj.user_id not in {obj.project.manager_id, obj.project.owner_id} or _serializer_permission(self, 'assign_project_manager'))}

    user_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = ProjectMember
        fields = "__all__"
        read_only_fields = ("project", "created_at")

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


def _can_manage_samples(user):
    tenant = resolve_user_tenant(user)
    return bool(tenant not in (None, NO_TENANT_ACCESS) and (user.is_superuser or OrganizationMembership.objects.filter(user=user, tenant=tenant, is_active=True, is_org_admin=True).exists()) and _has_permission(user, 'delete_projecttask') and _has_permission(user, 'delete_project'))


class ProjectSampleDataAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def delete(self, request):
        tenant = _tenant_and_activation(request)
        if not _can_manage_samples(request.user):
            raise PermissionDenied('Only an organization administrator can remove sample data.')
        from SL_Projects.management.commands.seed_project_samples import PREFIX, MARKER
        tasks = _task_scope(request.user).filter(number__startswith=PREFIX, description=MARKER, is_active=True)
        count = 0
        for task in tasks:
            _set_task_active(task, False, request.user)
            count += 1
        return Response({"detail": f"Deactivated {count} sample tasks. All records and history retained."})


class ProjectsDashboardAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_project_dashboard")
        tasks = _task_scope(request.user).filter(is_active=True)
        projects = _project_scope(request.user)
        today = timezone.localdate()
        open_tasks = tasks.exclude(status__in=["completed", "cancelled"])
        return Response({
            "access": {"view_all_tasks": _can_view_all_tasks(request.user), "role": _active_role_name(request.user, resolve_user_tenant(request.user)), "can_create_task": _has_permission(request.user, "add_projecttask"), "can_create_project": _has_permission(request.user, "add_project"), "can_export": _has_permission(request.user, "export_projecttask"), "can_manage_samples": _can_manage_samples(request.user), "has_samples": ProjectTask.objects.filter(tenant=resolve_user_tenant(request.user), number__startswith="DEMO-V1-", is_active=True).exists()},
            "counts": {
                "active_projects": projects.filter(status="active").count(),
                "open_tasks": open_tasks.count(),
                "my_tasks": open_tasks.filter(_personal_tasks(request.user)).distinct().count(),
                "overdue_tasks": open_tasks.filter(due_date__lt=today).count(),
                "blocked_tasks": tasks.filter(status="blocked").count(),
                "awaiting_review": tasks.filter(status="in_review").count(),
                "ticket_tasks": tasks.filter(source_ticket__isnull=False).count(),
            },
            "recent_tasks": TaskSerializer(tasks.order_by("-updated_at")[:6], many=True).data,
            "upcoming_deadlines": TaskSerializer(open_tasks.filter(due_date__isnull=False).order_by("due_date", "priority")[:6], many=True).data,
            "tasks_by_status": list(tasks.values("status").annotate(count=Count("id", distinct=True)).order_by("status")),
            "tasks_by_priority": list(tasks.values("priority").annotate(count=Count("id", distinct=True)).order_by("priority")),
        })


class ProjectTaskAlertsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        today = timezone.localdate()
        tasks = _task_scope(request.user).filter(is_active=True).filter(_personal_tasks(request.user)).exclude(status__in=["completed", "cancelled"]).distinct()
        followups = TaskFollowUp.objects.filter(task__in=tasks, status__in=["scheduled", "pending", "overdue"], follow_up_date__lte=today)
        due = tasks.filter(due_date__lte=today)
        return Response({
            "count": due.count() + followups.count(), "open_count": tasks.count(),
            "overdue_count": tasks.filter(due_date__lt=today).count(),
            "items": [{"id": f"task-{task.pk}", "title": task.title, "reference": task.number, "date": task.due_date, "route_path": f"/projects/tasks/{task.pk}"} for task in due.order_by("due_date", "pk")[:8]] +
                     [{"id": f"followup-{item.pk}", "title": item.notes, "reference": item.task.number, "date": item.follow_up_date, "route_path": f"/projects/tasks/{item.task_id}"} for item in followups.select_related("task")[:8]],
        })


class ProjectsReportsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        kind = request.query_params.get("report", "tasks")
        tasks = _filter_task_register(_task_scope(request.user), request) if kind in {"tasks", "workload"} else _task_scope(request.user).filter(is_active=True)
        projects = _project_scope(request.user)
        if kind == "projects":
            projects = projects.filter(**_date_range(request, start_field="target_end_date", end_field="target_end_date"))
            if value := request.query_params.get("search"):
                projects = projects.filter(Q(code__icontains=value) | Q(name__icontains=value))
        today = timezone.localdate()
        follow_ups = TaskFollowUp.objects.filter(task__in=tasks)
        milestones = ProjectMilestone.objects.filter(project__in=projects)
        if kind == "follow-ups":
            follow_ups = follow_ups.filter(**_date_range(request, start_field="follow_up_date", end_field="follow_up_date"))
            if value := request.query_params.get("search"):
                follow_ups = follow_ups.filter(Q(notes__icontains=value) | Q(task__title__icontains=value) | Q(task__number__icontains=value))
        if kind == "milestones":
            milestones = milestones.filter(**_date_range(request, start_field="due_date", end_field="due_date"))
            if value := request.query_params.get("search"):
                milestones = milestones.filter(name__icontains=value)
        payload = {
            "summary": {
                "projects": projects.count(),
                "active_projects": projects.filter(status="active").count(),
                "open_tasks": tasks.exclude(status__in=["completed", "cancelled"]).count(),
                "overdue_tasks": tasks.exclude(status__in=["completed", "cancelled"]).filter(due_date__lt=today).count(),
                "ticket_tasks": tasks.filter(source_ticket__isnull=False).count(),
                "open_follow_ups": follow_ups.exclude(status__in=["completed", "cancelled"]).count(),
                "overdue_follow_ups": follow_ups.filter(
                    status__in=["scheduled", "pending"], follow_up_date__lt=today
                ).count(),
            },
            "tasks_by_status": list(tasks.values("status").annotate(count=Count("id", distinct=True)).order_by("status")),
            "tasks_by_priority": list(tasks.values("priority").annotate(count=Count("id", distinct=True)).order_by("priority")),
            "project_progress": list(
                projects.values("code", "name", "progress_percentage", "status")
                .order_by("progress_percentage", "target_end_date", "name")[:10]
            ),
            "upcoming_milestones": list(
                milestones.filter(
                    due_date__isnull=False, status__in=["draft", "open"]
                )
                .order_by("due_date", "id")
                .values("id", "project__code", "project__name", "name", "due_date", "status")[:10]
            ),
            "workload": [
                {"assignee": row["primary_assignee__username"], "name": row["primary_assignee__first_name"] or row["primary_assignee__username"], "count": row["count"]}
                for row in tasks.exclude(status__in=["completed", "cancelled"]).values("primary_assignee__username", "primary_assignee__first_name").annotate(count=Count("id", distinct=True)).order_by("-count")[:10]
            ],
        }
        report_type = request.query_params.get("report", "tasks")
        from SL_Projects.reporting import project_report_rows, report_document
        columns, rows = project_report_rows(report_type, tasks, projects, follow_ups, milestones)
        download = request.query_params.get("download")
        if download in {"csv", "pdf"}:
            _require(request.user, "export_projecttask")
            if download == "pdf":
                from Platform_Core.document_pdf import document_pdf_response
                return document_pdf_response(report_document(resolve_user_tenant(request.user), report_type, columns, rows, request), f"projects-{report_type}.pdf")
            response = HttpResponse(content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = f'attachment; filename="projects-{report_type}.csv"'
            writer = csv.writer(response)
            writer.writerow(columns)
            for row in rows:
                writer.writerow([("'" + str(value)) if str(value).startswith(("=", "+", "-", "@")) else value for value in row])
            return response
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(rows, request)
        payload.update({"columns": columns, "rows": page, "count": len(rows), "report": report_type, "can_export": _has_permission(request.user, "export_projecttask")})
        return Response(payload)





class ProjectCalendarAPIView(APIView):
    """Return all dated delivery records visible in the active branch scope."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        try:
            start = date.fromisoformat(str(request.query_params.get("start") or ""))
            end = date.fromisoformat(str(request.query_params.get("end") or ""))
        except ValueError:
            raise serializers.ValidationError({"start": "Provide start and end dates in YYYY-MM-DD format."})
        if end < start:
            raise serializers.ValidationError({"end": "End date must be on or after start date."})
        projects = _project_scope(request.user)
        tasks = _task_scope(request.user).filter(is_active=True)
        if project_id := request.query_params.get("project"):
            project = projects.filter(pk=project_id).first()
            if not project:
                raise serializers.ValidationError({"project": "Choose a project visible in your active branch."})
            projects = projects.filter(pk=project.pk)
            tasks = tasks.filter(project=project)
        milestone_owner_id = None
        if assignee_id := request.query_params.get("assignee"):
            if assignee_id == "mine":
                tasks = tasks.filter(_personal_tasks(request.user)).distinct()
                milestone_owner_id = request.user.id
            else:
                try:
                    milestone_owner_id = int(assignee_id)
                    tasks = tasks.filter(primary_assignee_id=milestone_owner_id)
                except (TypeError, ValueError):
                    raise serializers.ValidationError({"assignee": "Choose a valid task assignee."})
        event_tasks = tasks
        tasks = event_tasks.filter(due_date__range=(start, end))
        # Calendar access through task permissions must not reveal project
        # records. Project events require the same permission as project pages.
        milestones = ProjectMilestone.objects.none()
        if _has_permission(request.user, "view_project"):
            milestones = ProjectMilestone.objects.filter(
                project__in=projects, due_date__range=(start, end)
            ).select_related("project")
        if milestone_owner_id is not None:
            milestones = milestones.filter(owner_id=milestone_owner_id)
        follow_ups = TaskFollowUp.objects.filter(
            task__in=event_tasks, follow_up_date__range=(start, end)
        ).select_related("task")
        events = [
            {"kind": "task", "id": task.id, "title": f"{task.number} · {task.title}", "date": task.due_date, "status": task.status, "priority": task.priority, "url": f"/projects/tasks/{task.id}"}
            for task in tasks
        ] + [
            {"kind": "milestone", "id": milestone.id, "title": f"{milestone.project.code} · {milestone.name}", "date": milestone.due_date, "status": milestone.status, "priority": "medium", "url": f"/projects/{milestone.project_id}"}
            for milestone in milestones
        ] + [
            {"kind": "follow_up", "id": follow_up.id, "title": f"{follow_up.task.number} · Follow-up", "date": follow_up.follow_up_date, "status": follow_up.status, "priority": follow_up.task.priority, "url": f"/projects/tasks/{follow_up.task_id}"}
            for follow_up in follow_ups
        ]
        return Response(sorted(events, key=lambda event: (event["date"], event["kind"], event["title"])))


class ProjectExportAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "export_project")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="projects.csv"'
        writer = csv.writer(response)
        writer.writerow(["Code", "Project", "Branch", "Manager", "Status", "Priority", "Progress %", "Start date", "Target end date"])
        for project in _project_scope(request.user):
            writer.writerow([project.code, project.name, project.branch.name, project.manager.get_full_name() or project.manager.username if project.manager_id else "", project.status, project.priority, project.progress_percentage, project.start_date or "", project.target_end_date or ""])
        return response


class TaskExportAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "export_projecttask")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="project-tasks.csv"'
        writer = csv.writer(response)
        writer.writerow(["Number", "Task", "Project", "Branch", "Assignee", "Status", "Priority", "Progress %", "Due date", "Workflow stage"])
        for task in _filter_task_register(_task_scope(request.user), request):
            writer.writerow([task.number, task.title, task.project.name if task.project_id else "", task.branch.name, task.primary_assignee.get_full_name() or task.primary_assignee.username if task.primary_assignee_id else "", task.status, task.priority, task.progress_percentage, task.due_date or "", task.workflow_stage])
        return response


class TaskFollowUpWorkspaceAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        task_id = serializers.IntegerField(min_value=1).run_validation(request.data.get("task"))
        return TaskFollowUpListCreateAPIView().post(request, pk=task_id)

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        tasks = _task_scope(request.user).filter(is_active=True)
        follow_ups = TaskFollowUp.objects.filter(task__in=tasks).select_related("task", "owner").order_by("follow_up_date", "id")
        today = timezone.localdate()
        if state := request.query_params.get("status"):
            if state == "overdue":
                follow_ups = follow_ups.filter(status__in=["scheduled", "pending"], follow_up_date__lt=today)
            else:
                follow_ups = follow_ups.filter(status=state)
        if value := request.query_params.get("search"):
            follow_ups = follow_ups.filter(
                Q(task__number__icontains=value)
                | Q(task__title__icontains=value)
                | Q(notes__icontains=value)
                | Q(owner__first_name__icontains=value)
                | Q(owner__last_name__icontains=value)
                | Q(owner__username__icontains=value)
            )
        summary = {
            "total": follow_ups.count(),
            "open": follow_ups.exclude(status__in=["completed", "cancelled"]).count(),
            "completed": follow_ups.filter(status="completed").count(),
            "overdue": follow_ups.filter(status__in=["scheduled", "pending"], follow_up_date__lt=today).count(),
        }
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(follow_ups, request)
        payload = [{
            "id": follow_up.id,
            "task_id": follow_up.task_id,
            "task_number": follow_up.task.number,
            "task_title": follow_up.task.title,
            "follow_up_date": follow_up.follow_up_date,
            "notes": follow_up.notes,
            "status": "overdue" if follow_up.status in {"scheduled", "pending"} and follow_up.follow_up_date < today else follow_up.status,
            "owner": follow_up.owner.get_full_name() or follow_up.owner.username if follow_up.owner_id else "Unassigned",
        } for follow_up in page]
        response = paginator.get_paginated_response(payload)
        response.data["summary"] = summary
        response.data["can_create"] = _has_permission(request.user, "add_taskfollowup")
        return response


class TaskFollowUpExportAPIView(APIView):
    """Export the filtered follow-up register visible to the active branch."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "export_projecttask")
        follow_ups = TaskFollowUp.objects.filter(
            task__in=_task_scope(request.user).filter(is_active=True)
        ).select_related("task", "owner")
        today = timezone.localdate()
        if state := request.query_params.get("status"):
            if state == "overdue":
                follow_ups = follow_ups.filter(
                    status__in=["scheduled", "pending"], follow_up_date__lt=today
                )
            else:
                follow_ups = follow_ups.filter(status=state)
        if value := request.query_params.get("search"):
            follow_ups = follow_ups.filter(
                Q(task__number__icontains=value)
                | Q(task__title__icontains=value)
                | Q(notes__icontains=value)
                | Q(owner__first_name__icontains=value)
                | Q(owner__last_name__icontains=value)
                | Q(owner__username__icontains=value)
            )
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="project-follow-ups.csv"'
        writer = csv.writer(response)
        writer.writerow(["Due date", "Task number", "Task", "Owner", "Notes", "Status"])
        for follow_up in follow_ups.order_by("follow_up_date", "id"):
            current_status = (
                "overdue"
                if follow_up.status in {"scheduled", "pending"}
                and follow_up.follow_up_date < today
                else follow_up.status
            )
            writer.writerow([
                follow_up.follow_up_date,
                follow_up.task.number,
                follow_up.task.title,
                follow_up.owner.get_full_name() or follow_up.owner.username
                if follow_up.owner_id
                else "Unassigned",
                follow_up.notes,
                current_status,
            ])
        return response


class TaskAssigneeListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        project = task.project
        if value := request.query_params.get("project"):
            project = _project_scope(request.user).filter(pk=value).first()
            if project is None:
                raise serializers.ValidationError({"project": "Choose an available project."})
        return Response([{"id": member.user_id, "name": member.user.get_full_name() or member.user.username}
            for member in _eligible_task_memberships(task.tenant, task.branch, project)])


class ActiveBranchTaskAssigneeListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_and_activation(request)
        if not (_has_permission(request.user, "view_project") or _has_permission(request.user, "add_project")):
            _require(request.user, "view_projecttask")
        branch_id = _working_branch_id(request.user, tenant)
        if not branch_id:
            raise PermissionDenied("Select an active branch before creating a task.")
        project = None
        if value := request.query_params.get("project"):
            project = _project_scope(request.user).filter(pk=value).first()
            if project is None:
                raise serializers.ValidationError({"project": "Choose an available project."})
        return Response([{"id": member.user_id, "name": member.user.get_full_name() or member.user.username}
            for member in _eligible_task_memberships(tenant, branch_id, project)])


class TaskRoleListAPIView(APIView):
    """Expose only branch-valid organization roles for assigning team work."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        roles = OrganizationBranchRoleAssignment.objects.filter(
            membership__tenant=task.tenant, membership__is_active=True, branch=task.branch, is_active=True,
        ).select_related("role_group").values("role_group_id", "role_group__name").distinct().order_by("role_group__name")
        return Response([{"id": role["role_group_id"], "name": role["role_group__name"].split(":")[-1]} for role in roles])


class TaskAssignmentAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "assign_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_active_task(task)
        if "primary_assignee" not in request.data and "assigned_role" not in request.data:
            raise serializers.ValidationError({"primary_assignee": "Choose an assignee or explicitly select Unassigned."})
        assignee_id = request.data.get("primary_assignee")
        if assignee_id == "":
            raise serializers.ValidationError({"primary_assignee": "Choose an assignee or explicitly select Unassigned."})
        if "primary_assignee" in request.data and not assignee_id:
            task.primary_assignee = None
        elif "primary_assignee" in request.data:
            membership = _eligible_task_memberships(task.tenant, task.branch, task.project).filter(user_id=assignee_id).first()
            if not membership:
                raise serializers.ValidationError({"primary_assignee": "Choose an active member of this task branch."})
            task.primary_assignee = membership.user
        if "assigned_role" in request.data:
            role_id = request.data.get("assigned_role")
            if not role_id:
                task.assigned_role = None
            else:
                assignment = OrganizationBranchRoleAssignment.objects.filter(
                    membership__tenant=task.tenant, membership__is_active=True, branch=task.branch,
                    is_active=True, role_group_id=role_id,
                ).select_related("role_group").first()
                if not assignment:
                    raise serializers.ValidationError({"assigned_role": "Choose an active role for this task branch."})
                task.assigned_role = assignment.role_group
        task.assigned_by = request.user
        task.updated_by = request.user
        task.save(update_fields=["primary_assignee", "assigned_role", "assigned_by", "updated_by", "updated_at"])
        task.collaborators.filter(user_id=task.primary_assignee_id).delete()
        assignee_name = task.primary_assignee.get_full_name() or task.primary_assignee.username if task.primary_assignee_id else "Unassigned"
        role_name = task.assigned_role.name.split(":")[-1] if task.assigned_role_id else "No role"
        log_business_event(event_group="data_lifecycle", event_type="task_assigned", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task assigned to {assignee_name}; team role: {role_name}.")
        _notify_project_user(
            recipient=task.primary_assignee,
            actor=request.user,
            tenant=task.tenant,
            title=f"Task assigned: {task.number}",
            message=f"{request.user.get_full_name() or request.user.username} assigned you to {task.title}.",
            route_path=f"/projects/tasks/{task.pk}",
            source_type="project_task_assignment",
            source_id=task.pk,
        )
        return Response(TaskSerializer(task, context={"request": request}).data)


class TaskCollaboratorListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _task(self, user, pk):
        return _task_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = self._task(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        collaborators = task.collaborators.select_related("user").order_by(
            "user__first_name", "user__last_name", "user__username"
        )
        return Response(TaskCollaboratorSerializer(collaborators, many=True).data)

    @transaction.atomic
    def post(self, request, pk):
        tenant = _tenant_and_activation(request)
        _require(request.user, "assign_projecttask")
        task = self._task(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_active_task(task)
        role = request.data.get("participation_role", "supporting")
        if role not in {"accountable", "supporting"}:
            raise serializers.ValidationError({"participation_role": "Choose accountable or supporting."})
        user_ids = request.data.get("user_ids")
        if user_ids is None:
            user_ids = [request.data.get("user")] if request.data.get("user") else []
        if not isinstance(user_ids, list) or not user_ids:
            raise serializers.ValidationError({"user_ids": "Choose at least one participant."})
        try:
            user_ids = {int(value) for value in user_ids}
        except (TypeError, ValueError):
            raise serializers.ValidationError({"user_ids": "Choose valid organization users."})
        memberships = _eligible_task_memberships(task.tenant, task.branch, task.project).filter(user_id__in=user_ids)
        found_ids = {membership.user_id for membership in memberships}
        if found_ids != user_ids:
            raise serializers.ValidationError({"user_ids": "Every participant must be active in this task branch."})
        if task.primary_assignee_id in user_ids:
            raise serializers.ValidationError({"user_ids": "The lead assignee is already accountable for this task."})
        if request.data.get("replace") is True:
            task.collaborators.filter(participation_role=role).exclude(user_id__in=user_ids).delete()
        for membership in memberships:
            collaborator, created = TaskCollaborator.objects.update_or_create(
                task=task, user=membership.user, defaults={"participation_role": role}
            )
            name = membership.user.get_full_name() or membership.user.username
            if not created:
                continue
            log_business_event(
                event_group="data_lifecycle",
                event_type="task_collaborator_added",
                tenant=tenant,
                actor=request.user,
                obj=task,
                branch=task.branch,
                note=f"{collaborator.get_participation_role_display()} added: {name}.",
            )
            _notify_project_user(
                recipient=membership.user,
                actor=request.user,
                tenant=tenant,
                title=f"Added to task: {task.number}",
                message=f"You were added as {collaborator.get_participation_role_display().lower()} for {task.title}.",
                route_path=f"/projects/tasks/{task.pk}",
                source_type="project_task_collaborator",
                source_id=task.pk,
            )
        current = task.collaborators.select_related("user").order_by("participation_role", "user__first_name", "user__username")
        return Response(TaskCollaboratorSerializer(current, many=True).data)


class TaskCollaboratorDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def delete(self, request, pk, collaborator_id):
        _tenant_and_activation(request)
        _require(request.user, "assign_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_active_task(task)
        collaborator = task.collaborators.filter(pk=collaborator_id).select_related("user").first()
        if not collaborator:
            return Response({"detail": "Supporting participant not found."}, status=status.HTTP_404_NOT_FOUND)
        name = collaborator.user.get_full_name() or collaborator.user.username
        collaborator.delete()
        log_business_event(
            event_group="data_lifecycle",
            event_type="task_collaborator_removed",
            tenant=task.tenant,
            actor=request.user,
            obj=task,
            branch=task.branch,
            note=f"Supporting participant removed: {name}.",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskChecklistAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return _related_records(request, task.checklist_items.select_related("completed_by"), TaskChecklistItemSerializer, ("title",), {"created_at", "title", "is_completed"}, "created_at")

    @transaction.atomic
    def post(self, request, pk):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "update_projecttask_progress")
        _require_active_task(task)
        serializer = TaskChecklistItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = serializer.save(task=task, created_by=request.user)
        _sync_task_checklist_progress(task)
        return Response(TaskChecklistItemSerializer(item).data, status=status.HTTP_201_CREATED)


class TaskChecklistDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, pk, item_id):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "update_projecttask_progress")
        _require_active_task(task)
        item = task.checklist_items.filter(pk=item_id).first()
        if not item:
            return Response({"detail": "Checklist item not found."}, status=status.HTTP_404_NOT_FOUND)
        if "title" in request.data:
            title = str(request.data.get("title") or "").strip()
            if not title:
                raise serializers.ValidationError({"title": "Enter a deliverable or checklist item."})
            item.title = title
        if "is_completed" in request.data:
            item.is_completed = bool(request.data.get("is_completed"))
            item.completed_by = request.user if item.is_completed else None
            item.completed_at = timezone.now() if item.is_completed else None
        item.save()
        _sync_task_checklist_progress(task)
        return Response(TaskChecklistItemSerializer(item).data)

    @transaction.atomic
    def delete(self, request, pk, item_id):
        _tenant_and_activation(request)
        _require(request.user, "update_projecttask_progress")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_active_task(task)
        deleted, _ = task.checklist_items.filter(pk=item_id).delete()
        if not deleted:
            return Response({"detail": "Checklist item not found."}, status=status.HTTP_404_NOT_FOUND)
        _sync_task_checklist_progress(task)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskStructureAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _task(self, user, pk):
        return _task_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = self._task(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        candidates = _task_scope(request.user).filter(project=task.project).exclude(pk=task.pk).exclude(parent_task=task) if task.project_id else _task_scope(request.user).filter(project__isnull=True).exclude(pk=task.pk).exclude(parent_task=task)
        kind = request.query_params.get("kind")
        if kind in {"subtasks", "dependencies"}:
            rows = _task_scope(request.user).filter(parent_task=task) if kind == "subtasks" else _task_scope(request.user).filter(dependent_tasks__task=task)
            return _related_records(request, rows, TaskSerializer, ("number", "title"), {"number", "title", "status", "due_date", "created_at"}, "number")
        if kind == "options":
            if value := request.query_params.get("search", "").strip():
                candidates = candidates.filter(Q(number__icontains=value) | Q(title__icontains=value))
            candidates = candidates.filter(is_active=True).exclude(dependent_tasks__task=task).order_by("number", "pk")
            return Response({"candidates": TaskSerializer(candidates[:100], many=True).data})
        return Response({
            "subtasks": TaskSerializer(_task_scope(request.user).filter(parent_task=task), many=True).data,
            "dependencies": TaskSerializer(_task_scope(request.user).filter(dependent_tasks__task=task), many=True).data,
            "candidates": TaskSerializer(candidates[:100], many=True).data,
        })

    @transaction.atomic
    def post(self, request, pk):
        tenant = _tenant_and_activation(request)
        _require(request.user, "change_projecttask")
        task = self._task(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_active_task(task)
        action = str(request.data.get("action") or "").strip()
        if action == "subtask":
            _require(request.user, "add_projecttask")
            title = str(request.data.get("title") or "").strip()
            if not title:
                raise serializers.ValidationError({"title": "Enter a subtask title."})
            payload = {
                "branch": task.branch_id,
                "number": _next_reference(tenant, ProjectTask, "TSK"),
                "title": title,
                "description": str(request.data.get("description") or ""),
                "project": task.project_id,
                "parent_task": task.id,
                "priority": request.data.get("priority") or task.priority,
                "task_type": get_project_settings(tenant).default_task_type,
                "status": get_project_settings(tenant).default_task_status,
                "due_date": request.data.get("due_date") or None,
                "estimated_hours": request.data.get("estimated_hours") or None,
            }
            serializer = TaskSerializer(data=payload)
            serializer.is_valid(raise_exception=True)
            subtask = serializer.save(
                tenant=tenant,
                created_by=request.user,
                updated_by=request.user,
                assigned_by=request.user,
            )
            subtask.full_clean()
            subtask.save()
            log_business_event(event_group="data_lifecycle", event_type="subtask_created", tenant=tenant, actor=request.user, obj=subtask, branch=task.branch, note=f"Subtask created under {task.number}.")
            return Response(TaskSerializer(subtask, context={"request": request}).data, status=status.HTTP_201_CREATED)
        if action == "dependency":
            depends_on = self._task(request.user, request.data.get("depends_on_id"))
            if not depends_on or not depends_on.is_active:
                raise serializers.ValidationError({"depends_on_id": "Choose an active task in your active branch."})
            if depends_on.id == task.id or depends_on.project_id != task.project_id:
                raise serializers.ValidationError({"depends_on_id": "Dependencies must be another task in the same project."})
            if _would_create_dependency_cycle(task.id, depends_on.id):
                raise serializers.ValidationError({"depends_on_id": "This dependency would create a circular task dependency."})
            relation, created = TaskDependency.objects.get_or_create(task=task, depends_on=depends_on)
            if created:
                log_business_event(event_group="data_lifecycle", event_type="dependency_added", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note=f"Dependency added: {depends_on.number}.")
            return Response(TaskSerializer(depends_on).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        raise serializers.ValidationError({"action": "Use subtask or dependency."})


class TaskProjectOptionsAPIView(APIView):
    """Minimal project labels for task filters; full project records stay protected."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_and_activation(request)
        if not _has_permission(request.user, 'view_project'):
            _require(request.user, 'view_projecttask')
        branch_id = _working_branch_id(request.user, tenant)
        if tenant is not None and branch_id:
            get_general_project(tenant.pk, branch_id)
        projects = _project_scope(request.user).order_by('-is_general', 'name', 'pk')
        if value := request.query_params.get('search'):
            projects = projects.filter(Q(code__icontains=value) | Q(name__icontains=value))
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(projects, request)
        return paginator.get_paginated_response([{'id': project.pk, 'code': project.code, 'name': project.name, 'is_general': project.is_general, 'branch': project.branch_id, 'branch_name': project.branch.name} for project in page])


class TaskMilestoneOptionsAPIView(APIView):
    """Only labels needed to select a milestone while working on tasks."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        if not _has_permission(request.user, "view_project"):
            _require(request.user, "view_projecttask")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(list(project.milestones.order_by("name", "pk").values("id", "name", "status")))


class ProjectListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require_project_read(request.user)
        qs = _project_scope(request.user)
        if value := request.query_params.get("status"):
            qs = qs.filter(status=value)
        if value := request.query_params.get("search"):
            qs = qs.filter(Q(code__icontains=value) | Q(name__icontains=value) | Q(description__icontains=value))
        qs = qs.filter(**_date_range(request, start_field="start_date", end_field="target_end_date"))
        ordering = request.query_params.get("ordering", "-created_at")
        if ordering.lstrip("-") in {"code", "name", "start_date", "target_end_date", "progress_percentage", "status", "created_at"}:
            qs = qs.order_by(ordering)
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(qs, request)
        response = paginator.get_paginated_response(ProjectSerializer(page, many=True, context={"request": request}).data)
        response.data['access'] = {'can_create': _has_permission(request.user, 'add_project'), 'can_export': _has_permission(request.user, 'export_project')}
        return response

    @transaction.atomic
    def post(self, request):
        tenant = _tenant_and_activation(request)
        _require(request.user, "add_project")
        payload = request.data.copy()
        branch_id = _active_branch_id(request.user)
        if not branch_id:
            # A newly created organization commonly has one operating branch
            # before its members have been assigned branch-role records. Use
            # that single branch rather than returning an opaque 403.
            branch_ids = list(TenantBranch.objects.filter(tenant=tenant, is_active=True).values_list("id", flat=True)[:2])
            if len(branch_ids) == 1:
                branch_id = branch_ids[0]
        if not branch_id:
            raise PermissionDenied("Choose an active branch before creating a project. Ask an administrator to assign your branch access if none is available.")
        payload.setdefault("branch", branch_id)
        payload.setdefault("code", _next_reference(tenant, Project, "PRJ"))
        serializer = ProjectSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("manager") or serializer.validated_data.get("owner"):
            _require(request.user, "assign_project_manager")
        branch = serializer.validated_data["branch"]
        _ensure_tenant_relation(tenant, branch, "branch")
        _ensure_active_tenant_user(
            tenant, serializer.validated_data.get("manager"), "manager", branch
        )
        _ensure_active_tenant_user(
            tenant, serializer.validated_data.get("owner"), "owner", branch
        )
        project = serializer.save(tenant=tenant, created_by=request.user, updated_by=request.user)
        project.full_clean()
        project.save()
        log_business_event(event_group="data_lifecycle", event_type="create", tenant=tenant, actor=request.user, obj=project, branch=project.branch, note="Project created.")
        return Response(ProjectSerializer(project, context={"request": request}).data, status=status.HTTP_201_CREATED)


class TicketTaskStatusSyncPolicyAPIView(APIView):
    """Tenant admin configuration for the opt-in, one-way ticket sync."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_and_activation(request)
        if not _has_permission(request.user, "change_projectmodulesettings"):
            _require(request.user, "change_project")
        policy, _ = TicketTaskStatusSyncPolicy.objects.get_or_create(tenant=tenant)
        return Response(TicketTaskStatusSyncPolicySerializer(policy).data)

    def put(self, request):
        tenant = _tenant_and_activation(request)
        if not _has_permission(request.user, "change_projectmodulesettings"):
            _require(request.user, "change_project")
        policy, _ = TicketTaskStatusSyncPolicy.objects.get_or_create(tenant=tenant)
        serializer = TicketTaskStatusSyncPolicySerializer(policy, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_business_event(event_group="configuration", event_type="ticket_task_sync_policy_updated", tenant=tenant, actor=request.user, obj=policy, note="Project ticket/task synchronization policy updated.")
        return Response(serializer.data)


class ProjectDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, user, pk):
        return _project_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require_project_read(request.user)
        project = self._get(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @transaction.atomic
    def patch(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "change_project")
        project = self._get(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.data.get("status") in {"completed", "cancelled", "archived"}:
            return Response(
                {"detail": "Use the project lifecycle action to complete, cancel, or archive a project."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ProjectSerializer(project, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if any(field in serializer.validated_data and (serializer.validated_data[field].pk if serializer.validated_data[field] else None) != getattr(project, field+"_id") for field in ["manager", "owner"]):
            _require(request.user, "assign_project_manager")
        branch = serializer.validated_data.get("branch", project.branch)
        if branch.pk != project.branch_id:
            from Platform_Core.organization import branch_allowed_for_user
            if not branch_allowed_for_user(request.user, branch):
                raise PermissionDenied("You do not have access to the selected branch.")
        _ensure_tenant_relation(project.tenant, branch, "branch")
        _ensure_active_tenant_user(
            project.tenant, serializer.validated_data.get("manager"), "manager", branch
        )
        _ensure_active_tenant_user(
            project.tenant, serializer.validated_data.get("owner"), "owner", branch
        )
        project = serializer.save(updated_by=request.user)
        project.full_clean()
        project.save()
        log_business_event(event_group="data_lifecycle", event_type="update", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note="Project updated.")
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @transaction.atomic
    def delete(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "delete_project")
        project = self._get(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if project.is_general:
            raise serializers.ValidationError({"detail": "The General project is reserved for general work."})
        if project.status != "draft":
            raise serializers.ValidationError({"status": "Only draft projects can be deleted."})
        if _project_has_history(project):
            raise serializers.ValidationError({"detail": "This project has linked records or approval history. Archive it to retain its history."})
        log_business_event(
            event_group="data_lifecycle",
            event_type="delete",
            tenant=project.tenant,
            actor=request.user,
            obj=project,
            branch=project.branch,
            note="Draft project deleted.",
        )
        project.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectCloseAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "close_project")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if project.is_general:
            raise serializers.ValidationError({"detail": "The General project must remain available for general tasks."})
        target_status = request.data.get("status")
        if target_status not in {"completed", "cancelled", "archived"}:
            return Response({"detail": "Choose completed, cancelled, or archived."}, status=status.HTTP_400_BAD_REQUEST)
        if target_status == "completed":
            open_tasks = ProjectTask.objects.filter(project=project).exclude(status__in=["completed", "cancelled"]).count()
            if open_tasks:
                return Response(
                    {"detail": f"Complete or cancel the remaining {open_tasks} open task(s) before closing this project."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            project.progress_percentage = 100
            project.actual_end_date = timezone.localdate()
        project.status = target_status
        project.updated_by = request.user
        project.save(update_fields=["status", "progress_percentage", "actual_end_date", "updated_by", "updated_at"])
        log_business_event(
            event_group="data_lifecycle",
            event_type=f"project_{target_status}",
            tenant=project.tenant,
            actor=request.user,
            obj=project,
            branch=project.branch,
            note=f"Project marked {target_status}.",
        )
        return Response(ProjectSerializer(project, context={"request": request}).data)


class ProjectDocumentListAPIView(APIView):
    """Manage project-owned documents and show supporting task documents together."""
    permission_classes = [IsAuthenticated]
    max_upload_bytes = 10 * 1024 * 1024

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require_project_read(request.user)
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        project_documents = project.documents.select_related("uploaded_by").all()
        task_attachments = TaskAttachment.objects.filter(task__in=_task_scope(request.user).filter(project=project)).select_related("task", "uploaded_by").order_by("-created_at")
        documents = [
            *ProjectDocumentSerializer(project_documents, many=True, context={"request": request}).data,
            *TaskAttachmentSerializer(task_attachments, many=True, context={"request": request}).data,
        ]
        documents.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        if value := request.query_params.get("search", "").strip().lower():
            documents = [item for item in documents if value in " ".join(str(item.get(key, "")) for key in ("original_name", "uploaded_by_name", "task_number", "task_title")).lower()]
        if (source := request.query_params.get("source")) in {"project", "task"}:
            documents = [item for item in documents if item.get("source") == source]
        if request.query_params.get("ordering") == "original_name":
            documents.sort(key=lambda item: item.get("original_name", "").lower())
        return _paged_or_list(request, documents, lambda rows: rows)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "add_projectdocument")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        upload = request.FILES.get("file")
        if upload is None:
            raise serializers.ValidationError({"file": "Choose a file to upload."})
        if upload.size > self.max_upload_bytes:
            raise serializers.ValidationError({"file": "Files must be 10 MB or smaller."})
        document = ProjectDocument.objects.create(
            project=project,
            uploaded_by=request.user,
            file=upload,
            original_name=upload.name[:255],
            content_type=getattr(upload, "content_type", "") or "",
            size_bytes=upload.size,
            is_evidence=str(request.data.get("is_evidence") or "").lower() in {"1", "true", "yes", "on"},
        )
        log_business_event(event_group="data_lifecycle", event_type="project_document_added", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Project document added: {document.original_name}.")
        return Response(ProjectDocumentSerializer(document, context={"request": request}).data, status=status.HTTP_201_CREATED)



class ProjectDocumentPreviewAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, source, document_id):
        _tenant_and_activation(request)
        _require_project_read(request.user)
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if source == "project":
            record = project.documents.filter(pk=document_id).first()
        elif source == "task":
            record = TaskAttachment.objects.filter(task__in=_task_scope(request.user).filter(project=project), pk=document_id).first()
        else:
            record = None
        if not record:
            return Response({"detail": "Document not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.query_params.get("download") == "1":
            try:
                stream = record.file.open("rb")
            except OSError:
                raise serializers.ValidationError("The stored file is unavailable. Ask an administrator to restore it.")
            response = FileResponse(stream, as_attachment=True, filename=record.original_name, content_type="application/octet-stream")
            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"
            return response
        return document_preview(record)


class TaskTypeListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        if not _has_permission(request.user, "add_projecttask"):
            _require(request.user, "view_projecttask")
        return Response(active_task_types(get_project_settings(resolve_user_tenant(request.user))))


class ProjectDocumentDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, document_id):
        _tenant_and_activation(request)
        _require(request.user, "delete_projectdocument")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        document = project.documents.filter(pk=document_id).first()
        if not document:
            return Response({"detail": "Project document not found."}, status=status.HTTP_404_NOT_FOUND)
        name = document.original_name
        if document.file:
            document.file.delete(save=False)
        document.delete()
        log_business_event(event_group="data_lifecycle", event_type="project_document_removed", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Project document removed: {name}.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectMilestoneListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _project(self, user, pk):
        return _project_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require_project_read(request.user)
        project = self._project(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        rows = project.milestones.select_related("owner").all()
        if value := request.query_params.get("search"):
            rows = rows.filter(Q(name__icontains=value) | Q(description__icontains=value))
        if (value := request.query_params.get("status")) and value != "all":
            rows = rows.filter(status=value)
        ordering = request.query_params.get("ordering", "due_date")
        if ordering.lstrip("-") in {"name", "due_date", "status", "progress_percentage", "created_at"}:
            rows = rows.order_by(ordering, "pk")
        return _paged_or_list(request, rows, lambda page: ProjectMilestoneSerializer(page, many=True).data)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "add_projectmilestone")
        project = self._project(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ProjectMilestoneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        milestone = serializer.save(project=project)
        log_business_event(event_group="data_lifecycle", event_type="milestone_created", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Milestone created: {milestone.name}.")
        return Response(ProjectMilestoneSerializer(milestone).data, status=status.HTTP_201_CREATED)


class ProjectMilestoneCompleteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk, milestone_id):
        _tenant_and_activation(request)
        _require(request.user, "change_projectmilestone")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        milestone = project.milestones.filter(pk=milestone_id).first()
        if not milestone:
            return Response({"detail": "Milestone not found for this project."}, status=status.HTTP_404_NOT_FOUND)
        if milestone.status != "completed":
            milestone.status = "completed"
            milestone.progress_percentage = 100
            milestone.completion_date = timezone.localdate()
            milestone.save(update_fields=["status", "progress_percentage", "completion_date", "updated_at"])
            log_business_event(
                event_group="data_lifecycle",
                event_type="milestone_completed",
                tenant=project.tenant,
                actor=request.user,
                obj=project,
                branch=project.branch,
                note=f"Milestone completed: {milestone.name}.",
            )
        return Response(ProjectMilestoneSerializer(milestone).data)


class ProjectMilestoneDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _milestone(self, user, pk, milestone_id):
        project = _project_scope(user).filter(pk=pk).first()
        if not project:
            return None, None
        return project, project.milestones.filter(pk=milestone_id).first()

    def patch(self, request, pk, milestone_id):
        _tenant_and_activation(request)
        _require(request.user, "change_projectmilestone")
        project, milestone = self._milestone(request.user, pk, milestone_id)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not milestone:
            return Response({"detail": "Milestone not found for this project."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ProjectMilestoneSerializer(milestone, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        if fields.get("status") == "completed":
            fields["progress_percentage"] = 100
            fields["completion_date"] = timezone.localdate()
        elif fields.get("status") and fields["status"] != "completed":
            fields["completion_date"] = None
        milestone = serializer.save(**fields)
        log_business_event(event_group="data_lifecycle", event_type="milestone_updated", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Milestone updated: {milestone.name}.")
        return Response(ProjectMilestoneSerializer(milestone).data)

    def delete(self, request, pk, milestone_id):
        _tenant_and_activation(request)
        _require(request.user, "delete_projectmilestone")
        project, milestone = self._milestone(request.user, pk, milestone_id)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not milestone:
            return Response({"detail": "Milestone not found for this project."}, status=status.HTTP_404_NOT_FOUND)
        if milestone.tasks.exists():
            raise serializers.ValidationError({"milestone": "Move or remove its tasks before deleting this milestone."})
        name = milestone.name
        milestone.delete()
        log_business_event(event_group="data_lifecycle", event_type="milestone_removed", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Milestone removed: {name}.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectMemberListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _project(self, user, pk):
        return _project_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require_project_read(request.user)
        project = self._project(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if ("page" in request.query_params or "page_size" in request.query_params) and request.query_params.get("include_options") != "1":
            return _related_records(request, project.members.select_related("user", "branch"), ProjectMemberSerializer,
                ("user__username", "user__first_name", "user__last_name", "branch__name", "responsibility"),
                {"user__username", "branch__name", "responsibility", "id"}, "user__username")
        branch_ids = [project.branch_id, *project.participating_branches.values_list("branch_id", flat=True)]
        memberships = OrganizationMembership.objects.filter(tenant=project.tenant, is_active=True).filter(
            Q(branch_id__in=branch_ids) | Q(branches__id__in=branch_ids)
        ).select_related("user", "branch").distinct()
        candidates = []
        for membership in memberships:
            available_branches = list(membership.branches.filter(id__in=branch_ids))
            if membership.branch_id and membership.branch_id in branch_ids:
                available_branches.append(membership.branch)
            for branch in {branch.id: branch for branch in available_branches}.values():
                candidates.append({
                    "user_id": membership.user_id,
                    "user_name": membership.user.get_full_name() or membership.user.username,
                    "branch_id": branch.id,
                    "branch_name": branch.name,
                })
        return Response({
            "members": [] if request.query_params.get("include_options") == "1" else ProjectMemberSerializer(project.members.select_related("user", "branch"), many=True).data,
            "candidates": candidates,
            "branches": [{"id": branch.id, "name": branch.name} for branch in TenantBranch.objects.filter(tenant=project.tenant, is_active=True).order_by("name")],
        })

    @transaction.atomic
    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "manage_project_members")
        project = self._project(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.data.get("action") == "branch":
            branch = TenantBranch.objects.filter(pk=request.data.get("branch"), tenant=project.tenant, is_active=True).first()
            if not branch:
                raise serializers.ValidationError({"branch": "Choose an active branch in this organization."})
            if branch.pk != project.branch_id:
                ProjectBranchAccess.objects.get_or_create(project=project, branch=branch)
            log_business_event(event_group="data_lifecycle", event_type="project_branch_added", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Participating branch added: {branch.name}.")
            return Response({"id": branch.id, "name": branch.name}, status=status.HTTP_201_CREATED)
        user_id = request.data.get("user")
        branch_id = request.data.get("branch") or project.branch_id
        branch_ids = {project.branch_id, *project.participating_branches.values_list("branch_id", flat=True)}
        try:
            branch_id = int(branch_id)
        except (TypeError, ValueError):
            raise serializers.ValidationError({"branch": "Choose a valid project branch."})
        if branch_id not in branch_ids:
            raise serializers.ValidationError({"branch": "Add this branch to the project before assigning its members."})
        membership = OrganizationMembership.objects.filter(tenant=project.tenant, user_id=user_id, is_active=True).filter(
            Q(branch_id=branch_id) | Q(branches__id=branch_id)
        ).first()
        if not membership:
            raise serializers.ValidationError({"user": "Choose an active organization member in the selected branch."})
        responsibility = request.data.get("responsibility") or "contributor"
        if responsibility not in dict(ProjectMember.ROLE_CHOICES):
            raise serializers.ValidationError({"responsibility": "Choose manager, owner, contributor, or viewer."})
        if responsibility in {"manager", "owner"}:
            _require(request.user, "assign_project_manager")
        member, created = ProjectMember.objects.get_or_create(project=project, user_id=user_id, branch_id=branch_id, defaults={"responsibility": request.data.get("responsibility") or "contributor"})
        if not created:
            member.responsibility = responsibility
            member.save(update_fields=["responsibility"])
        if responsibility == "manager":
            project.manager = member.user
            project.updated_by = request.user
            project.save(update_fields=["manager", "updated_by", "updated_at"])
        elif responsibility == "owner":
            project.owner = member.user
            project.updated_by = request.user
            project.save(update_fields=["owner", "updated_by", "updated_at"])
        log_business_event(event_group="data_lifecycle", event_type="project_member_added", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Project member assigned: {member.user.get_full_name() or member.user.username}.")
        return Response(ProjectMemberSerializer(member, context={"request": request}).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ProjectMemberDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def delete(self, request, pk, member_id):
        _tenant_and_activation(request)
        _require(request.user, "manage_project_members")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        member = project.members.filter(pk=member_id).select_related("user").first()
        if not member:
            return Response({"detail": "Project member not found."}, status=status.HTTP_404_NOT_FOUND)
        if member.user_id in {project.manager_id, project.owner_id}:
            _require(request.user, "assign_project_manager")
        fields = ["updated_by", "updated_at"]
        if project.manager_id == member.user_id:
            project.manager = None
            fields.append("manager")
        if project.owner_id == member.user_id:
            project.owner = None
            fields.append("owner")
        if len(fields) > 2:
            project.updated_by = request.user
            project.save(update_fields=fields)
        member_name = member.user.get_full_name() or member.user.username
        member.delete()
        log_business_event(
            event_group="data_lifecycle",
            event_type="project_member_removed",
            tenant=project.tenant,
            actor=request.user,
            obj=project,
            branch=project.branch,
            note=f"Project member removed: {member_name}.",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        qs = _task_scope(request.user)
        qs = _filter_task_register(qs, request)
        ordering = request.query_params.get("ordering", "due_date")
        if ordering.lstrip("-") in {
            "number",
            "title",
            "priority",
            "status",
            "due_date",
            "start_date",
            "progress_percentage",
            "created_at",
            "updated_at",
            "project__name", "source_ticket__public_id", "primary_assignee__username",
        }:
            qs = qs.order_by(ordering, "id")
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(qs, request)
        response = paginator.get_paginated_response(TaskSerializer(page, many=True, context={"request": request}).data)
        response.data["summary"] = {"completed": qs.filter(status="completed").count()}
        response.data["access"] = {"view_all_tasks": _can_view_all_tasks(request.user), "can_create": _has_permission(request.user, "add_projecttask"), "can_export": _has_permission(request.user, "export_projecttask")}
        return response

    @transaction.atomic
    def post(self, request):
        tenant = _tenant_and_activation(request)
        _require(request.user, "add_projecttask")
        payload = request.data.copy()
        config = get_project_settings(tenant)
        payload.setdefault("task_type", config.default_task_type)
        payload.setdefault("priority", config.default_priority)
        payload.setdefault("status", config.default_task_status)
        if config.default_due_days is not None:
            payload.setdefault("due_date", timezone.localdate() + timedelta(days=config.default_due_days))
        branch_id = _working_branch_id(request.user, tenant)
        if not branch_id:
            raise PermissionDenied("Select an active branch before creating a task.")
        payload.setdefault("branch", branch_id)
        payload.setdefault("number", _next_reference(tenant, ProjectTask, "TSK"))
        serializer = TaskSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        _validate_task_type(config, serializer.validated_data.get("task_type"))
        branch = serializer.validated_data["branch"]
        _ensure_tenant_relation(tenant, branch, "branch")
        for field in ("project", "milestone", "source_ticket", "parent_task"):
            _ensure_tenant_relation(tenant, serializer.validated_data.get(field), field)
        selected_project = serializer.validated_data["project"]
        if not _project_scope(request.user).filter(pk=selected_project.pk).exists():
            raise serializers.ValidationError({"project": "Choose an available project in this workspace."})
        if serializer.validated_data.get("primary_assignee"):
            _require(request.user, "assign_projecttask")
        _validate_task_assignee(tenant, branch, selected_project, serializer.validated_data.get("primary_assignee"))
        task = serializer.save(tenant=tenant, created_by=request.user, updated_by=request.user, assigned_by=request.user)
        _validate_task_status_change(task, request.user, task.status, previous_status="draft")
        _apply_task_status(task, "draft")
        task.full_clean()
        task.save()
        log_business_event(event_group="data_lifecycle", event_type="create", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note="Task created.")
        return Response(TaskSerializer(task, context={"request": request}).data, status=status.HTTP_201_CREATED)


class TaskDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, user, pk):
        return _task_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = self._get(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(TaskSerializer(task, context={"request": request}).data)

    @transaction.atomic
    def patch(self, request, pk):
        _tenant_and_activation(request)
        task = self._get(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "change_projecttask")
        _require_active_task(task)
        previous_project_id = task.project_id
        previous_assignee_id = task.primary_assignee_id
        previous_due_date = task.due_date
        previous_status = task.status
        requested_status = request.data.get("status")
        if requested_status is not None:
            _validate_task_status_change(task, request.user, requested_status)
        payload = request.data.copy()
        if not _has_permission(request.user, 'change_projecttask'):
            extra = set(payload) - TASK_PARTICIPANT_FIELDS
            # Older clients send the unchanged project with ordinary edits.
            if 'project' in extra and str(payload['project']) == str(task.project_id):
                extra.remove('project')
            if 'primary_assignee' in extra:
                unchanged = str(payload['primary_assignee'] or '') == str(task.primary_assignee_id or '')
                if unchanged or _has_permission(request.user, 'assign_projecttask'):
                    extra.remove('primary_assignee')
            if extra:
                raise PermissionDenied('Moving a task or changing administrative fields requires task management permission.')
        moving = "project" in payload and str(payload["project"]) != str(task.project_id)
        if moving:
            if task.parent_task_id or task.subtasks.exists() or task.dependencies.exists() or task.dependent_tasks.exists():
                raise serializers.ValidationError({"project": "Unlink subtasks and dependencies before moving this task to another project."})
            payload.setdefault("milestone", None)
        if "primary_assignee" in payload and str(payload["primary_assignee"] or "") != str(task.primary_assignee_id or ""):
            _require(request.user, "assign_projecttask")
        serializer = TaskSerializer(task, data=payload, partial=True)
        serializer.is_valid(raise_exception=True)
        _validate_task_type(get_project_settings(task.tenant), serializer.validated_data.get("task_type", task.task_type), task.task_type)
        for field in ("project", "milestone", "source_ticket", "parent_task"):
            _ensure_tenant_relation(task.tenant, serializer.validated_data.get(field), field)
        destination = serializer.validated_data.get("project", task.project)
        if not _project_scope(request.user).filter(pk=destination.pk).exists():
            raise serializers.ValidationError({"project": "Choose an available project in this workspace."})
        assignee = serializer.validated_data.get("primary_assignee", task.primary_assignee)
        destination_branch = serializer.validated_data.get("branch", task.branch)
        branch_changed = destination_branch.pk != task.branch_id
        if branch_changed:
            from Platform_Core.organization import branch_allowed_for_user
            if not branch_allowed_for_user(request.user, destination_branch):
                raise PermissionDenied("You do not have access to the selected branch.")
        if moving or branch_changed or (assignee.pk if assignee else None) != previous_assignee_id:
            _validate_task_assignee(task.tenant, destination_branch, destination, assignee)
        if moving or branch_changed:
            allowed = set(_eligible_task_memberships(task.tenant, destination_branch, destination).values_list("user_id", flat=True))
            if task.collaborators.exclude(user_id__in=allowed).exists():
                raise serializers.ValidationError({"project": "Update participants before moving this task; some cannot access the destination project."})
        task = serializer.save(updated_by=request.user)
        if task.primary_assignee_id != previous_assignee_id:
            task.assigned_by = request.user
            task.collaborators.filter(user_id=task.primary_assignee_id).delete()
            _notify_project_user(recipient=task.primary_assignee, actor=request.user, tenant=task.tenant,
                title=f"Task assigned: {task.number}", message=f"You were assigned to {task.title}.",
                route_path=f"/projects/tasks/{task.pk}", source_type="project_task_assignment", source_id=task.pk)
        _apply_task_status(task, previous_status)
        task.full_clean()
        task.save()
        if task.status != previous_status:
            labels = dict(ProjectTask.STATUS_CHOICES)
            TaskUpdate.objects.create(task=task, updated_by=request.user,
                progress_percentage=task.progress_percentage,
                update_description=f"Status changed from {labels[previous_status]} to {labels[task.status]}.")
        if task.due_date != previous_due_date:
            due_label = task.due_date.strftime("%d %b %Y") if task.due_date else "not set"
            _notify_task_participants(
                task=task,
                actor=request.user,
                title=f"Due date updated: {task.number}",
                message=f"The due date for {task.title} is now {due_label}.",
                source_type="project_task_due_date",
            )
        if task.status == "blocked" and previous_status != "blocked":
            _notify_task_participants(
                task=task,
                actor=request.user,
                title=f"Task blocked: {task.number}",
                message=f"{task.title} is blocked and needs attention.",
                source_type="project_task_blocked",
            )
        _sync_parent_task_progress(task)
        _sync_project_progress(task)
        if previous_project_id != task.project_id:
            _sync_project_progress(task, previous_project_id)
        _sync_source_ticket_when_complete(task=task, actor=request.user)
        log_business_event(event_group="data_lifecycle", event_type="update", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note="Task updated.")
        return Response(TaskSerializer(task, context={"request": request}).data)

    def delete(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        if not self._get(request.user, pk):
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"detail": "Tasks cannot be deleted. Use Deactivate task to retain the record and its history."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)


class TaskActivationAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "deactivate_projecttask")
        task = _task_scope(request.user).select_for_update().filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        active = request.data.get("is_active")
        if not isinstance(active, bool):
            raise serializers.ValidationError({"is_active": "Choose true to reactivate or false to deactivate."})
        _set_task_active(task, active, request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)


class TaskUpdateListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return _related_records(request, task.updates.select_related("updated_by"), TaskUpdateSerializer, ("update_description", "updated_by__username", "updated_by__first_name", "updated_by__last_name"), {"created_at", "progress_percentage", "time_spent_hours"}, "-created_at")

    def post(self, request, pk):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "update_projecttask_progress")
        _require_active_task(task)
        serializer = TaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        update = serializer.save(task=task, updated_by=request.user, progress_percentage=task.progress_percentage)
        task.actual_hours = (task.actual_hours or 0) + update.time_spent_hours
        task.updated_by = request.user
        task.save(update_fields=["actual_hours", "updated_by", "updated_at"])
        log_business_event(event_group="data_lifecycle", event_type="progress_update", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task progress updated; {update.time_spent_hours} hour(s) recorded.")
        return Response(TaskUpdateSerializer(update).data, status=status.HTTP_201_CREATED)


class TaskFollowUpListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return _related_records(request, task.follow_ups.select_related("owner"), TaskFollowUpSerializer, ("notes", "owner__username", "owner__first_name", "owner__last_name"), {"follow_up_date", "created_at", "status"}, "follow_up_date")

    def post(self, request, pk):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "add_taskfollowup")
        _require_active_task(task)
        serializer = TaskFollowUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = serializer.validated_data.get("owner") or request.user
        _ensure_active_tenant_user(task.tenant, owner, "owner", task.branch)
        follow_up = serializer.save(task=task, owner=owner)
        log_business_event(event_group="data_lifecycle", event_type="follow_up_created", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note="Task follow-up created.")
        _notify_project_user(
            recipient=owner,
            actor=request.user,
            tenant=task.tenant,
            title=f"Follow-up scheduled: {task.number}",
            message=f"A follow-up for {task.title} is due on {follow_up.follow_up_date:%d %b %Y}.",
            route_path=f"/projects/tasks/{task.pk}",
            source_type="project_task_follow_up",
            source_id=follow_up.pk,
        )
        return Response(TaskFollowUpSerializer(follow_up).data, status=status.HTTP_201_CREATED)


class TaskFollowUpCompleteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, follow_up_id):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "change_taskfollowup")
        _require_active_task(task)
        follow_up = task.follow_ups.filter(pk=follow_up_id).first()
        if not follow_up:
            return Response({"detail": "Follow-up not found for this task."}, status=status.HTTP_404_NOT_FOUND)
        if follow_up.status == "completed":
            return Response(TaskFollowUpSerializer(follow_up).data)
        follow_up.mark_completed()
        log_business_event(
            event_group="data_lifecycle",
            event_type="follow_up_completed",
            tenant=task.tenant,
            actor=request.user,
            obj=task,
            branch=task.branch,
            note=f"Follow-up {follow_up.id} completed.",
        )
        return Response(TaskFollowUpSerializer(follow_up).data)


class TaskCommentListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return _related_records(request, task.comments.select_related("author").prefetch_related("mentions"), TaskCommentSerializer,
            ("body", "author__username", "author__first_name", "author__last_name"), {"created_at"}, "-created_at")

    def post(self, request, pk):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "add_taskcomment")
        _require_active_task(task)
        serializer = TaskCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        mention_user_ids = set(serializer.validated_data.pop("mention_user_ids", []))
        eligible_user_ids = set(
            OrganizationMembership.objects.filter(tenant=task.tenant, is_active=True)
            .filter(Q(branch=task.branch) | Q(branches=task.branch))
            .values_list("user_id", flat=True)
            .distinct()
        )
        invalid_mentions = mention_user_ids - eligible_user_ids
        if invalid_mentions:
            raise serializers.ValidationError({
                "mention_user_ids": "Mention only active organization users who can access this task branch."
            })
        comment = serializer.save(task=task, author=request.user)
        if mention_user_ids:
            comment.mentions.set(mention_user_ids)
            for recipient in comment.mentions.all():
                _notify_project_user(
                    recipient=recipient,
                    actor=request.user,
                    tenant=task.tenant,
                    title=f"You were mentioned on {task.number}",
                    message=f"{request.user.get_full_name() or request.user.username} mentioned you in a task comment.",
                    route_path=f"/projects/tasks/{task.pk}",
                    source_type="project_task_comment_mention",
                    source_id=comment.pk,
                )
        log_business_event(event_group="data_lifecycle", event_type="comment_created", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note="Task comment added.")
        return Response(TaskCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class TaskAttachmentListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]
    max_upload_bytes = 10 * 1024 * 1024

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return _related_records(request, task.attachments.select_related("uploaded_by"), TaskAttachmentSerializer, ("original_name", "uploaded_by__username", "uploaded_by__first_name", "uploaded_by__last_name"), {"created_at", "original_name", "size_bytes"}, "-created_at")

    def post(self, request, pk):
        _tenant_and_activation(request)
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_task_permission(task, request.user, "add_taskattachment")
        _require_active_task(task)
        upload = request.FILES.get("file")
        if upload is None:
            raise serializers.ValidationError({"file": "Choose a file to upload."})
        if upload.size > self.max_upload_bytes:
            raise serializers.ValidationError({"file": "Files must be 10 MB or smaller."})
        attachment = TaskAttachment.objects.create(
            task=task,
            uploaded_by=request.user,
            file=upload,
            original_name=upload.name[:255],
            content_type=getattr(upload, "content_type", "") or "",
            size_bytes=upload.size,
            is_evidence=str(request.data.get("is_evidence") or "").lower() in {"1", "true", "yes", "on"},
        )
        log_business_event(event_group="data_lifecycle", event_type="attachment_added", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task attachment added: {attachment.original_name}.")
        return Response(TaskAttachmentSerializer(attachment, context={"request": request}).data, status=status.HTTP_201_CREATED)


class TaskAttachmentDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, attachment_id):
        _tenant_and_activation(request)
        _require(request.user, "delete_taskattachment")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        _require_active_task(task)
        attachment = task.attachments.filter(pk=attachment_id).first()
        if not attachment:
            return Response({"detail": "Attachment not found for this task."}, status=status.HTTP_404_NOT_FOUND)
        name = attachment.original_name
        if attachment.file:
            attachment.file.delete(save=False)
        attachment.delete()
        log_business_event(event_group="data_lifecycle", event_type="attachment_removed", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task attachment removed: {name}.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class TicketTaskListCreateAPIView(APIView):
    """Expose real ticket-linked tasks without duplicating ticket workflow state."""

    permission_classes = [IsAuthenticated]

    def _ticket(self, user, ticket_id):
        tenant = tenant_or_403(user)
        if tenant is not None and not user.is_superuser and MODULE_SLUG not in get_active_tenant_module_slugs(tenant):
            raise PermissionDenied("Projects & Tasks is not enabled for this organization.")
        return tenant, Ticket.objects.filter(tenant=tenant, pk=ticket_id).first()

    def get(self, request, ticket_id):
        tenant, ticket = self._ticket(request.user, ticket_id)
        _require(request.user, "view_projecttask")
        if not ticket:
            return Response({"detail": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        tasks = _task_scope(request.user).filter(source_ticket=ticket)
        return Response(TaskSerializer(tasks, many=True).data)

    @transaction.atomic
    def post(self, request, ticket_id):
        tenant, ticket = self._ticket(request.user, ticket_id)
        _require(request.user, "create_projecttask_from_ticket")
        if not ticket:
            return Response({"detail": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        branch_id = _active_branch_id(request.user)
        if not branch_id:
            raise PermissionDenied("Select an active branch before creating a task.")
        priority_map = {"low": "low", "normal": "medium", "high": "high", "urgent": "critical"}
        priority = request.data.get("priority") or priority_map.get(ticket.priority, "medium")
        if priority not in dict(ProjectTask.PRIORITY_CHOICES):
            raise serializers.ValidationError({"priority": "Choose low, medium, high, or critical."})
        config = get_project_settings(tenant)
        active_types = {row["value"] for row in config.task_types if row.get("is_active", True)}
        task_type = str(request.data.get("task_type") or ("customer_support" if "customer_support" in active_types else config.default_task_type)).strip()
        _validate_task_type(config, task_type)
        due_date = request.data.get("due_date") or (timezone.localdate() + timedelta(days=config.default_due_days) if config.default_due_days is not None else None)
        if due_date:
            due_date = serializers.DateField().run_validation(due_date)
        linked_project=ticket.project
        if linked_project and linked_project.branch_id!=branch_id and not linked_project.participating_branches.filter(branch_id=branch_id).exists():
            raise serializers.ValidationError({"project":"Switch to the ticket project's branch before creating a task, or add the current branch to that project."})
        task = ProjectTask(
            tenant=tenant,
            branch_id=branch_id,
            number=_next_reference(tenant, ProjectTask, "TSK"),
            title=request.data.get("title") or ticket.subject,
            description=request.data.get("description") or ticket.description,
            source_ticket=ticket,
            project=linked_project or get_general_project(tenant.pk, branch_id),
            task_type=task_type,
            status=config.default_task_status,
            priority=priority,
            due_date=due_date,
            created_by=request.user,
            updated_by=request.user,
            assigned_by=request.user,
        )
        task.full_clean()
        task.save()
        log_business_event(event_group="data_lifecycle", event_type="ticket_task_created", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task created from ticket {ticket.public_id}.")
        return Response(TaskSerializer(task, context={"request": request}).data, status=status.HTTP_201_CREATED)
