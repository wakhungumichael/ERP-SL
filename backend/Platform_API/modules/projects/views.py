# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Projects & Tasks APIs. All records are resolved from the active workspace."""
import csv
from datetime import date

from django.http import HttpResponse
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone
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
from Platform_Core.models import OrganizationBranchRoleAssignment, OrganizationMembership, SystemNotification, TenantBranch, WorkflowEntityBinding
from Platform_Core.platform import get_active_tenant_module_slugs
from SL_Projects.models import Project, ProjectBranchAccess, ProjectDocument, ProjectMember, ProjectMilestone, ProjectTask, TaskAttachment, TaskComment, TaskDependency, TaskFollowUp, TaskUpdate
from SL_Ticketing.models import Ticket


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


def _require(user, codename):
    if not has_active_permission(user, f"SL_Projects.{codename}"):
        raise PermissionDenied("Your active role does not have permission for this action.")


def _project_scope(user):
    qs = apply_tenant_filter(Project.objects.select_related("branch", "manager", "owner"), user)
    branch_id = _active_branch_id(user)
    if branch_id:
        qs = qs.filter(Q(branch_id=branch_id) | Q(participating_branches__branch_id=branch_id)).distinct()
    return qs


def _task_scope(user):
    qs = apply_tenant_filter(
        ProjectTask.objects.select_related("branch", "project", "milestone", "primary_assignee", "source_ticket"), user
    )
    branch_id = _active_branch_id(user)
    return qs.filter(branch_id=branch_id) if branch_id else qs


def _ensure_tenant_relation(tenant, obj, label):
    if obj is not None and tenant is not None and getattr(obj, "tenant_id", None) != tenant.id:
        raise serializers.ValidationError({label: f"{label.replace('_', ' ').title()} belongs to another organization."})


def _ensure_active_tenant_user(tenant, user, label, branch=None):
    """Validate a tenant user, optionally requiring access to a working branch."""
    if user is None:
        return
    memberships = OrganizationMembership.objects.filter(
        tenant=tenant, user=user, is_active=True
    )
    if branch is not None:
        memberships = memberships.filter(Q(branch=branch) | Q(branches=branch))
    if not memberships.exists():
        scope = " in this branch" if branch is not None else ""
        raise serializers.ValidationError({
            label: f"Choose an active organization user{scope} for {label.replace('_', ' ')}."
        })


def _next_reference(tenant, model, prefix):
    """Serialize reference allocation per tenant so concurrent drafts stay unique."""
    type(tenant).objects.select_for_update().get(pk=tenant.pk)
    sequence = model.objects.filter(tenant=tenant).count() + 1
    return f"{prefix}-{timezone.localdate():%Y}-{sequence:04d}"


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


def _sync_project_progress(task):
    """Keep a parent project's progress aligned with its active task register."""
    if not task.project_id:
        return
    aggregate = ProjectTask.objects.filter(project_id=task.project_id).exclude(status="cancelled").aggregate(
        progress=Avg("progress_percentage")
    )
    progress = round(aggregate["progress"] or 0)
    Project.objects.filter(pk=task.project_id).exclude(progress_percentage=progress).update(progress_percentage=progress)


def _sync_parent_task_progress(task):
    """Roll child progress up through a task hierarchy without changing lifecycle status."""
    current = task
    visited = set()
    while current.parent_task_id and current.parent_task_id not in visited:
        parent = current.parent_task
        visited.add(parent.pk)
        aggregate = ProjectTask.objects.filter(parent_task=parent).exclude(status="cancelled").aggregate(
            progress=Avg("progress_percentage")
        )
        progress = round(aggregate["progress"] or 0)
        ProjectTask.objects.filter(pk=parent.pk).exclude(progress_percentage=progress).update(progress_percentage=progress)
        parent.progress_percentage = progress
        current = parent


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


class ProjectSerializer(serializers.ModelSerializer):
    manager_name = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = Project
        fields = "__all__"
        read_only_fields = ("tenant", "created_by", "updated_by", "created_at", "updated_at")

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
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    assignee_name = serializers.SerializerMethodField()
    source_ticket_reference = serializers.CharField(source="source_ticket.public_id", read_only=True)

    class Meta:
        model = ProjectTask
        fields = "__all__"
        read_only_fields = ("tenant", "created_by", "updated_by", "assigned_by", "created_at", "updated_at")

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
        milestone = attrs.get("milestone", getattr(instance, "milestone", None))
        parent = attrs.get("parent_task", getattr(instance, "parent_task", None))
        if start and due and due < start:
            raise serializers.ValidationError({"due_date": "Due date cannot be before the task start date."})
        if project and milestone and milestone.project_id != project.id:
            raise serializers.ValidationError({"milestone": "Choose a milestone belonging to the selected project."})
        if instance and parent and parent.id == instance.id:
            raise serializers.ValidationError({"parent_task": "A task cannot be its own parent."})
        for field in ("estimated_hours", "actual_hours"):
            if field in attrs and attrs[field] is not None and attrs[field] < 0:
                raise serializers.ValidationError({field: "Hours cannot be negative."})
        return attrs


class TaskUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskUpdate
        fields = "__all__"
        read_only_fields = ("task", "updated_by", "created_at")

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

    class Meta:
        model = TaskComment
        fields = "__all__"
        read_only_fields = ("task", "author", "mentions", "created_at", "updated_at")

    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.username if obj.author else "System process"

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
    user_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = ProjectMember
        fields = "__all__"
        read_only_fields = ("project", "created_at")

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class ProjectsDashboardAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_project")
        tasks = _task_scope(request.user)
        projects = _project_scope(request.user)
        today = timezone.localdate()
        open_tasks = tasks.exclude(status__in=["completed", "cancelled"])
        return Response({
            "counts": {
                "active_projects": projects.filter(status="active").count(),
                "open_tasks": open_tasks.count(),
                "my_tasks": open_tasks.filter(primary_assignee=request.user).count(),
                "overdue_tasks": open_tasks.filter(due_date__lt=today).count(),
                "blocked_tasks": tasks.filter(status="blocked").count(),
                "awaiting_review": tasks.filter(status="in_review").count(),
                "ticket_tasks": tasks.filter(source_ticket__isnull=False).count(),
            },
            "recent_tasks": TaskSerializer(tasks.order_by("-updated_at")[:6], many=True).data,
            "upcoming_deadlines": TaskSerializer(open_tasks.filter(due_date__isnull=False).order_by("due_date", "priority")[:6], many=True).data,
            "tasks_by_status": list(tasks.values("status").annotate(count=Count("id")).order_by("status")),
            "tasks_by_priority": list(tasks.values("priority").annotate(count=Count("id")).order_by("priority")),
        })


class ProjectsReportsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_project")
        tasks = _task_scope(request.user)
        projects = _project_scope(request.user)
        today = timezone.localdate()
        return Response({
            "summary": {
                "projects": projects.count(),
                "active_projects": projects.filter(status="active").count(),
                "open_tasks": tasks.exclude(status__in=["completed", "cancelled"]).count(),
                "overdue_tasks": tasks.exclude(status__in=["completed", "cancelled"]).filter(due_date__lt=today).count(),
            },
            "tasks_by_status": list(tasks.values("status").annotate(count=Count("id")).order_by("status")),
            "tasks_by_priority": list(tasks.values("priority").annotate(count=Count("id")).order_by("priority")),
            "workload": [
                {"assignee": row["primary_assignee__username"], "name": row["primary_assignee__first_name"] or row["primary_assignee__username"], "count": row["count"]}
                for row in tasks.exclude(status__in=["completed", "cancelled"]).values("primary_assignee__username", "primary_assignee__first_name").annotate(count=Count("id")).order_by("-count")[:10]
            ],
        })


class ProjectCalendarAPIView(APIView):
    """Return all dated delivery records visible in the active branch scope."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_project")
        try:
            start = date.fromisoformat(str(request.query_params.get("start") or ""))
            end = date.fromisoformat(str(request.query_params.get("end") or ""))
        except ValueError:
            raise serializers.ValidationError({"start": "Provide start and end dates in YYYY-MM-DD format."})
        if end < start:
            raise serializers.ValidationError({"end": "End date must be on or after start date."})
        tasks = _task_scope(request.user).filter(due_date__range=(start, end))
        milestones = ProjectMilestone.objects.filter(project__in=_project_scope(request.user), due_date__range=(start, end)).select_related("project")
        follow_ups = TaskFollowUp.objects.filter(task__in=_task_scope(request.user), follow_up_date__range=(start, end)).select_related("task")
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
        for task in _task_scope(request.user):
            writer.writerow([task.number, task.title, task.project.name if task.project_id else "", task.branch.name, task.primary_assignee.get_full_name() or task.primary_assignee.username if task.primary_assignee_id else "", task.status, task.priority, task.progress_percentage, task.due_date or "", task.workflow_stage])
        return response


class TaskFollowUpWorkspaceAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        tasks = _task_scope(request.user)
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
        return response


class TaskFollowUpExportAPIView(APIView):
    """Export the filtered follow-up register visible to the active branch."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "export_projecttask")
        follow_ups = TaskFollowUp.objects.filter(
            task__in=_task_scope(request.user)
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
        memberships = OrganizationMembership.objects.filter(tenant=task.tenant, is_active=True).filter(
            Q(branch=task.branch) | Q(branches=task.branch)
        ).select_related("user").distinct().order_by("user__first_name", "user__username")
        return Response([{"id": membership.user_id, "name": membership.user.get_full_name() or membership.user.username} for membership in memberships])


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

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "assign_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        assignee_id = request.data.get("primary_assignee")
        if "primary_assignee" in request.data and not assignee_id:
            task.primary_assignee = None
        elif "primary_assignee" in request.data:
            membership = OrganizationMembership.objects.filter(
                tenant=task.tenant, user_id=assignee_id, is_active=True
            ).filter(
                Q(branch=task.branch) | Q(branches=task.branch)
            ).select_related("user").distinct().first()
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
        return Response(TaskSerializer(task).data)


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
        return Response({
            "subtasks": TaskSerializer(task.subtasks.select_related("primary_assignee"), many=True).data,
            "dependencies": TaskSerializer(ProjectTask.objects.filter(dependent_tasks__task=task).select_related("primary_assignee"), many=True).data,
            "candidates": TaskSerializer(candidates[:100], many=True).data,
        })

    @transaction.atomic
    def post(self, request, pk):
        tenant = _tenant_and_activation(request)
        _require(request.user, "change_projecttask")
        task = self._task(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        action = str(request.data.get("action") or "").strip()
        if action == "subtask":
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
            return Response(TaskSerializer(subtask).data, status=status.HTTP_201_CREATED)
        if action == "dependency":
            depends_on = self._task(request.user, request.data.get("depends_on_id"))
            if not depends_on:
                raise serializers.ValidationError({"depends_on_id": "Choose a task in your active branch."})
            if depends_on.id == task.id or depends_on.project_id != task.project_id:
                raise serializers.ValidationError({"depends_on_id": "Dependencies must be another task in the same project."})
            if _would_create_dependency_cycle(task.id, depends_on.id):
                raise serializers.ValidationError({"depends_on_id": "This dependency would create a circular task dependency."})
            relation, created = TaskDependency.objects.get_or_create(task=task, depends_on=depends_on)
            if created:
                log_business_event(event_group="data_lifecycle", event_type="dependency_added", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note=f"Dependency added: {depends_on.number}.")
            return Response(TaskSerializer(depends_on).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        raise serializers.ValidationError({"action": "Use subtask or dependency."})


class ProjectListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _tenant_and_activation(request)
        _require(request.user, "view_project")
        qs = _project_scope(request.user)
        if value := request.query_params.get("status"):
            qs = qs.filter(status=value)
        if value := request.query_params.get("search"):
            qs = qs.filter(Q(code__icontains=value) | Q(name__icontains=value) | Q(description__icontains=value))
        ordering = request.query_params.get("ordering", "-created_at")
        if ordering.lstrip("-") in {"code", "name", "start_date", "target_end_date", "progress_percentage", "status", "created_at"}:
            qs = qs.order_by(ordering)
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ProjectSerializer(page, many=True).data)

    @transaction.atomic
    def post(self, request):
        tenant = _tenant_and_activation(request)
        _require(request.user, "add_project")
        payload = request.data.copy()
        branch_id = _active_branch_id(request.user)
        if not branch_id:
            raise PermissionDenied("Select an active branch before creating a project.")
        payload.setdefault("branch", branch_id)
        payload.setdefault("code", _next_reference(tenant, Project, "PRJ"))
        serializer = ProjectSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
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
        return Response(ProjectSerializer(project).data, status=status.HTTP_201_CREATED)


class ProjectDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, user, pk):
        return _project_scope(user).filter(pk=pk).first()

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_project")
        project = self._get(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ProjectSerializer(project).data)

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
        branch = serializer.validated_data.get("branch", project.branch)
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
        return Response(ProjectSerializer(project).data)


class ProjectCloseAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "close_project")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
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
        return Response(ProjectSerializer(project).data)


class ProjectDocumentListAPIView(APIView):
    """Manage project-owned documents and show supporting task documents together."""
    permission_classes = [IsAuthenticated]
    max_upload_bytes = 10 * 1024 * 1024

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_project")
        project = _project_scope(request.user).filter(pk=pk).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        project_documents = project.documents.select_related("uploaded_by").all()
        task_attachments = TaskAttachment.objects.filter(task__project=project).select_related("task", "uploaded_by").order_by("-created_at")
        documents = [
            *ProjectDocumentSerializer(project_documents, many=True, context={"request": request}).data,
            *TaskAttachmentSerializer(task_attachments, many=True, context={"request": request}).data,
        ]
        documents.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return Response(documents)

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
        _require(request.user, "view_project")
        project = self._project(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ProjectMilestoneSerializer(project.milestones.select_related("owner"), many=True).data)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "change_project")
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
        _require(request.user, "change_project")
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
        _require(request.user, "view_project")
        project = self._project(request.user, pk)
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
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
            "members": ProjectMemberSerializer(project.members.select_related("user", "branch"), many=True).data,
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
        if responsibility == "manager":
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
        return Response(ProjectMemberSerializer(member).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


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
        if value := request.query_params.get("status"):
            qs = qs.filter(status=value)
        if request.query_params.get("scope") == "mine":
            qs = qs.filter(primary_assignee=request.user)
        if request.query_params.get("scope") == "team":
            role_name = _active_role_name(request.user, tenant_or_403(request.user))
            qs = qs.filter(assigned_role__name=role_name) if role_name else qs.none()
        if value := request.query_params.get("project"):
            qs = qs.filter(project_id=value)
        if value := request.query_params.get("search"):
            qs = qs.filter(Q(number__icontains=value) | Q(title__icontains=value) | Q(description__icontains=value))
        paginator = ProjectsPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(TaskSerializer(page, many=True).data)

    @transaction.atomic
    def post(self, request):
        tenant = _tenant_and_activation(request)
        _require(request.user, "add_projecttask")
        payload = request.data.copy()
        branch_id = _active_branch_id(request.user)
        if not branch_id:
            raise PermissionDenied("Select an active branch before creating a task.")
        payload.setdefault("branch", branch_id)
        payload.setdefault("number", _next_reference(tenant, ProjectTask, "TSK"))
        serializer = TaskSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        branch = serializer.validated_data["branch"]
        _ensure_tenant_relation(tenant, branch, "branch")
        for field in ("project", "milestone", "source_ticket", "parent_task"):
            _ensure_tenant_relation(tenant, serializer.validated_data.get(field), field)
        _ensure_active_tenant_user(
            tenant,
            serializer.validated_data.get("primary_assignee"),
            "primary_assignee",
            branch,
        )
        task = serializer.save(tenant=tenant, created_by=request.user, updated_by=request.user, assigned_by=request.user)
        task.full_clean()
        task.save()
        log_business_event(event_group="data_lifecycle", event_type="create", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note="Task created.")
        return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)


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
        return Response(TaskSerializer(task).data)

    @transaction.atomic
    def patch(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "change_projecttask")
        task = self._get(request.user, pk)
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        requested_status = request.data.get("status")
        workflow_configured = WorkflowEntityBinding.objects.filter(
            workflow__tenant=task.tenant,
            workflow__is_active=True,
            workflow__status="published",
            module_slug=MODULE_SLUG,
            entity_type="project_task",
            is_active=True,
        ).exists()
        if requested_status == "in_review" or (requested_status in {"completed", "cancelled"} and workflow_configured):
            raise serializers.ValidationError({"status": "Use the workflow approval process to submit, complete, or cancel this task."})
        if requested_status == "completed":
            _require(request.user, "complete_projecttask")
        serializer = TaskSerializer(task, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field in ("project", "milestone", "source_ticket", "parent_task"):
            _ensure_tenant_relation(task.tenant, serializer.validated_data.get(field), field)
        _ensure_active_tenant_user(
            task.tenant,
            serializer.validated_data.get("primary_assignee"),
            "primary_assignee",
            task.branch,
        )
        task = serializer.save(updated_by=request.user)
        if requested_status == "completed":
            task.progress_percentage = 100
            task.completion_date = timezone.localdate()
        task.full_clean()
        task.save()
        _sync_parent_task_progress(task)
        _sync_project_progress(task)
        log_business_event(event_group="data_lifecycle", event_type="update", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note="Task updated.")
        return Response(TaskSerializer(task).data)


class TaskUpdateListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(TaskUpdateSerializer(task.updates.select_related("updated_by"), many=True).data)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "update_projecttask_progress")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = TaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        update = serializer.save(task=task, updated_by=request.user)
        task.progress_percentage = update.progress_percentage
        task.actual_hours = (task.actual_hours or 0) + update.time_spent_hours
        task.updated_by = request.user
        task.save(update_fields=["progress_percentage", "actual_hours", "updated_by", "updated_at"])
        _sync_parent_task_progress(task)
        _sync_project_progress(task)
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
        return Response(TaskFollowUpSerializer(task.follow_ups.select_related("owner"), many=True).data)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "add_taskfollowup")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
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
        _require(request.user, "change_taskfollowup")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
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
        return Response(TaskCommentSerializer(task.comments.select_related("author"), many=True).data)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "add_taskcomment")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = TaskCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(task=task, author=request.user)
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
        return Response(TaskAttachmentSerializer(task.attachments.select_related("uploaded_by"), many=True, context={"request": request}).data)

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "add_taskattachment")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
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
        due_date = request.data.get("due_date") or None
        if due_date:
            due_date = serializers.DateField().run_validation(due_date)
        task = ProjectTask(
            tenant=tenant,
            branch_id=branch_id,
            number=_next_reference(tenant, ProjectTask, "TSK"),
            title=request.data.get("title") or ticket.subject,
            description=request.data.get("description") or ticket.description,
            source_ticket=ticket,
            task_type=str(request.data.get("task_type") or "")[:100],
            priority=priority,
            due_date=due_date,
            created_by=request.user,
            updated_by=request.user,
            assigned_by=request.user,
        )
        task.full_clean()
        task.save()
        log_business_event(event_group="data_lifecycle", event_type="ticket_task_created", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task created from ticket {ticket.public_id}.")
        return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)
