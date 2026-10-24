# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Projects & Tasks APIs. All records are resolved from the active workspace."""
import csv

from django.http import HttpResponse
from django.db import transaction
from django.db.models import Count, Q
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
from Platform_Core.models import OrganizationMembership, TenantBranch
from Platform_Core.platform import get_active_tenant_module_slugs
from SL_Projects.models import Project, ProjectBranchAccess, ProjectMember, ProjectMilestone, ProjectTask, TaskAttachment, TaskComment, TaskDependency, TaskFollowUp, TaskUpdate
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


def _next_reference(tenant, model, prefix):
    """Serialize reference allocation per tenant so concurrent drafts stay unique."""
    type(tenant).objects.select_for_update().get(pk=tenant.pk)
    sequence = model.objects.filter(tenant=tenant).count() + 1
    return f"{prefix}-{timezone.localdate():%Y}-{sequence:04d}"


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


class TaskFollowUpSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskFollowUp
        fields = "__all__"
        read_only_fields = ("task", "created_at", "updated_at", "completed_at")

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() or obj.owner.username if obj.owner else "Unassigned"


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

    class Meta:
        model = TaskAttachment
        fields = "__all__"
        read_only_fields = ("task", "uploaded_by", "original_name", "content_type", "size_bytes", "created_at")

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username if obj.uploaded_by else "System process"


class ProjectMilestoneSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectMilestone
        fields = "__all__"
        read_only_fields = ("project", "created_at", "updated_at")

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() or obj.owner.username if obj.owner else "Unassigned"


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
        return Response({
            "counts": {
                "active_projects": projects.filter(status="active").count(),
                "open_tasks": tasks.exclude(status__in=["completed", "cancelled"]).count(),
                "my_tasks": tasks.filter(primary_assignee=request.user).exclude(status__in=["completed", "cancelled"]).count(),
                "overdue_tasks": tasks.exclude(status__in=["completed", "cancelled"]).filter(due_date__lt=today).count(),
                "blocked_tasks": tasks.filter(status="blocked").count(),
                "awaiting_review": tasks.filter(status="in_review").count(),
                "ticket_tasks": tasks.filter(source_ticket__isnull=False).count(),
            }
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
        if state := request.query_params.get("status"):
            follow_ups = follow_ups.filter(status=state)
        today = timezone.localdate()
        payload = [{
            "id": follow_up.id,
            "task_id": follow_up.task_id,
            "task_number": follow_up.task.number,
            "task_title": follow_up.task.title,
            "follow_up_date": follow_up.follow_up_date,
            "notes": follow_up.notes,
            "status": "overdue" if follow_up.status in {"scheduled", "pending"} and follow_up.follow_up_date < today else follow_up.status,
            "owner": follow_up.owner.get_full_name() or follow_up.owner.username if follow_up.owner_id else "Unassigned",
        } for follow_up in follow_ups]
        return Response(payload)


class TaskAssigneeListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "view_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        memberships = OrganizationMembership.objects.filter(
            tenant=task.tenant, branch=task.branch, is_active=True
        ).select_related("user").order_by("user__first_name", "user__username")
        return Response([{"id": membership.user_id, "name": membership.user.get_full_name() or membership.user.username} for membership in memberships])


class TaskAssignmentAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _tenant_and_activation(request)
        _require(request.user, "assign_projecttask")
        task = _task_scope(request.user).filter(pk=pk).first()
        if not task:
            return Response({"detail": "Task not found."}, status=status.HTTP_404_NOT_FOUND)
        assignee_id = request.data.get("primary_assignee")
        if not assignee_id:
            task.primary_assignee = None
        else:
            membership = OrganizationMembership.objects.filter(
                tenant=task.tenant, branch=task.branch, user_id=assignee_id, is_active=True
            ).select_related("user").first()
            if not membership:
                raise serializers.ValidationError({"primary_assignee": "Choose an active member of this task branch."})
            task.primary_assignee = membership.user
        task.assigned_by = request.user
        task.updated_by = request.user
        task.save(update_fields=["primary_assignee", "assigned_by", "updated_by", "updated_at"])
        log_business_event(event_group="data_lifecycle", event_type="task_assigned", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task assigned to {task.primary_assignee.get_full_name() or task.primary_assignee.username if task.primary_assignee_id else 'Unassigned'}.")
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
            subtask = ProjectTask.objects.create(
                tenant=tenant, branch=task.branch, number=_next_reference(tenant, ProjectTask, "TSK"),
                title=title, description=str(request.data.get("description") or ""), project=task.project,
                parent_task=task, priority=task.priority, created_by=request.user, updated_by=request.user, assigned_by=request.user,
            )
            log_business_event(event_group="data_lifecycle", event_type="subtask_created", tenant=tenant, actor=request.user, obj=subtask, branch=task.branch, note=f"Subtask created under {task.number}.")
            return Response(TaskSerializer(subtask).data, status=status.HTTP_201_CREATED)
        if action == "dependency":
            depends_on = self._task(request.user, request.data.get("depends_on_id"))
            if not depends_on:
                raise serializers.ValidationError({"depends_on_id": "Choose a task in your active branch."})
            if depends_on.id == task.id or depends_on.project_id != task.project_id:
                raise serializers.ValidationError({"depends_on_id": "Dependencies must be another task in the same project."})
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
        serializer = ProjectSerializer(project, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        branch = serializer.validated_data.get("branch", project.branch)
        _ensure_tenant_relation(project.tenant, branch, "branch")
        project = serializer.save(updated_by=request.user)
        project.full_clean()
        project.save()
        log_business_event(event_group="data_lifecycle", event_type="update", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note="Project updated.")
        return Response(ProjectSerializer(project).data)


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
        member, created = ProjectMember.objects.get_or_create(project=project, user_id=user_id, branch_id=branch_id, defaults={"responsibility": request.data.get("responsibility") or "contributor"})
        if not created:
            member.responsibility = request.data.get("responsibility") or member.responsibility
            member.save(update_fields=["responsibility"])
        log_business_event(event_group="data_lifecycle", event_type="project_member_added", tenant=project.tenant, actor=request.user, obj=project, branch=project.branch, note=f"Project member assigned: {member.user.get_full_name() or member.user.username}.")
        return Response(ProjectMemberSerializer(member).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


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
        for field in ("project", "source_ticket", "parent_task"):
            _ensure_tenant_relation(tenant, serializer.validated_data.get(field), field)
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
        if requested_status in {"in_review", "completed", "cancelled"}:
            raise serializers.ValidationError({"status": "Use the workflow approval process to submit, complete, or cancel a task."})
        serializer = TaskSerializer(task, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        task = serializer.save(updated_by=request.user)
        task.full_clean()
        task.save()
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
        task.updated_by = request.user
        task.save(update_fields=["progress_percentage", "updated_by", "updated_at"])
        log_business_event(event_group="data_lifecycle", event_type="progress_update", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note="Task progress updated.")
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
        follow_up = serializer.save(task=task, owner=serializer.validated_data.get("owner") or request.user)
        log_business_event(event_group="data_lifecycle", event_type="follow_up_created", tenant=task.tenant, actor=request.user, obj=task, branch=task.branch, note="Task follow-up created.")
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
        follow_up.status = "completed"
        follow_up.completed_at = timezone.now()
        follow_up.save(update_fields=["status", "completed_at", "updated_at"])
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
        task = ProjectTask(
            tenant=tenant,
            branch_id=branch_id,
            number=_next_reference(tenant, ProjectTask, "TSK"),
            title=request.data.get("title") or ticket.subject,
            description=request.data.get("description") or ticket.description,
            source_ticket=ticket,
            priority=priority_map.get(ticket.priority, "medium"),
            created_by=request.user,
            updated_by=request.user,
            assigned_by=request.user,
        )
        task.full_clean()
        task.save()
        log_business_event(event_group="data_lifecycle", event_type="ticket_task_created", tenant=tenant, actor=request.user, obj=task, branch=task.branch, note=f"Task created from ticket {ticket.public_id}.")
        return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)
