# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Tenant and branch-aware projects and internal work management records."""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from Platform_Core.models import AuditMetadataMixin


class Project(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"), ("planned", "Planned"), ("active", "Active"),
        ("on_hold", "On hold"), ("completed", "Completed"),
        ("cancelled", "Cancelled"), ("archived", "Archived"),
    ]
    PRIORITY_CHOICES = [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")]

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="projects")
    branch = models.ForeignKey("Platform_Core.TenantBranch", on_delete=models.PROTECT, related_name="owned_projects")
    code = models.CharField(max_length=48)
    name = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    project_type = models.CharField(max_length=100, blank=True)
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="managed_projects")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_projects")
    start_date = models.DateField(null=True, blank=True)
    target_end_date = models.DateField(null=True, blank=True)
    actual_end_date = models.DateField(null=True, blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="medium")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    progress_percentage = models.PositiveSmallIntegerField(default=0)
    estimated_budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    actual_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    workflow_status = models.CharField(max_length=30, blank=True)
    workflow_stage = models.CharField(max_length=180, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_projects")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_projects")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "name"]
        unique_together = ("tenant", "code")
        permissions = [
            ("view_project_dashboard", "Can view projects dashboard"),
            ("assign_project_manager", "Can assign project manager"),
            ("manage_project_members", "Can manage project members"),
            ("close_project", "Can close projects"),
            ("export_project", "Can export projects"),
        ]

    def clean(self):
        if self.branch_id and self.tenant_id and self.branch.tenant_id != self.tenant_id:
            raise ValidationError({"branch": "The owning branch must belong to the project tenant."})
        if not 0 <= self.progress_percentage <= 100:
            raise ValidationError({"progress_percentage": "Progress must be between 0 and 100."})

    def __str__(self):
        return f"{self.code} - {self.name}"


class ProjectBranchAccess(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="participating_branches")
    branch = models.ForeignKey("Platform_Core.TenantBranch", on_delete=models.CASCADE, related_name="project_access")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("project", "branch")

    def clean(self):
        if self.project_id and self.branch_id and self.project.tenant_id != self.branch.tenant_id:
            raise ValidationError("Participating branch must belong to the project tenant.")


class ProjectMember(models.Model):
    ROLE_CHOICES = [("manager", "Manager"), ("owner", "Owner"), ("contributor", "Contributor"), ("viewer", "Viewer")]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships")
    branch = models.ForeignKey("Platform_Core.TenantBranch", on_delete=models.PROTECT, related_name="project_memberships")
    responsibility = models.CharField(max_length=20, choices=ROLE_CHOICES, default="contributor")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("project", "user", "branch")

    def clean(self):
        if self.project_id and self.branch_id and self.project.tenant_id != self.branch.tenant_id:
            raise ValidationError("Project member branch must belong to the project tenant.")


class ProjectMilestone(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [("draft", "Draft"), ("open", "Open"), ("completed", "Completed"), ("cancelled", "Cancelled")]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="milestones")
    name = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    due_date = models.DateField(null=True, blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_project_milestones")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    completion_date = models.DateField(null=True, blank=True)
    progress_percentage = models.PositiveSmallIntegerField(default=0)
    dependencies = models.ManyToManyField("self", symmetrical=False, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "id"]


class ProjectTask(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"), ("todo", "To do"), ("in_progress", "In progress"),
        ("blocked", "Blocked"), ("in_review", "In review"), ("completed", "Completed"), ("cancelled", "Cancelled"),
    ]
    PRIORITY_CHOICES = Project.PRIORITY_CHOICES

    tenant = models.ForeignKey("Platform_Core.Tenant", on_delete=models.CASCADE, related_name="project_tasks")
    branch = models.ForeignKey("Platform_Core.TenantBranch", on_delete=models.PROTECT, related_name="project_tasks")
    number = models.CharField(max_length=48)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=100, blank=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks", null=True, blank=True)
    milestone = models.ForeignKey(ProjectMilestone, on_delete=models.SET_NULL, related_name="tasks", null=True, blank=True)
    parent_task = models.ForeignKey("self", on_delete=models.SET_NULL, related_name="subtasks", null=True, blank=True)
    source_ticket = models.ForeignKey("SL_Ticketing.Ticket", on_delete=models.SET_NULL, related_name="project_tasks", null=True, blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="medium")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    progress_percentage = models.PositiveSmallIntegerField(default=0)
    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    estimated_hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    actual_hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    primary_assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="primary_project_tasks")
    assigned_role = models.ForeignKey("auth.Group", on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_project_tasks")
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_project_tasks")
    workflow_status = models.CharField(max_length=30, blank=True)
    workflow_stage = models.CharField(max_length=180, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_project_tasks")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_project_tasks")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "-created_at"]
        unique_together = ("tenant", "number")
        permissions = [
            ("assign_projecttask", "Can assign project tasks"),
            ("update_projecttask_progress", "Can update project task progress"),
            ("complete_projecttask", "Can complete project tasks"),
            ("reopen_projecttask", "Can reopen project tasks"),
            ("export_projecttask", "Can export project tasks"),
            ("create_projecttask_from_ticket", "Can create project tasks from tickets"),
        ]

    def clean(self):
        errors = {}
        if self.branch_id and self.tenant_id and self.branch.tenant_id != self.tenant_id:
            errors["branch"] = "Task branch must belong to the task tenant."
        if self.project_id and self.project.tenant_id != self.tenant_id:
            errors["project"] = "Project belongs to a different tenant."
        if self.milestone_id and self.milestone.project.tenant_id != self.tenant_id:
            errors["milestone"] = "Milestone belongs to a different tenant."
        if self.source_ticket_id and self.source_ticket.tenant_id != self.tenant_id:
            errors["source_ticket"] = "Ticket belongs to a different tenant."
        if self.parent_task_id and self.parent_task.tenant_id != self.tenant_id:
            errors["parent_task"] = "Parent task belongs to a different tenant."
        if not 0 <= self.progress_percentage <= 100:
            errors["progress_percentage"] = "Progress must be between 0 and 100."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.number} - {self.title}"


class TaskCollaborator(models.Model):
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="collaborators")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="collaborating_project_tasks")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("task", "user")


class TaskDependency(models.Model):
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="dependencies")
    depends_on = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="dependent_tasks")

    class Meta:
        unique_together = ("task", "depends_on")

    def clean(self):
        if self.task_id == self.depends_on_id:
            raise ValidationError("A task cannot depend on itself.")
        if self.task_id and self.depends_on_id and self.task.tenant_id != self.depends_on.tenant_id:
            raise ValidationError("Task dependencies must belong to the same tenant.")


class TaskUpdate(AuditMetadataMixin, models.Model):
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="updates")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="project_task_updates")
    progress_percentage = models.PositiveSmallIntegerField()
    update_description = models.TextField()
    work_completed = models.TextField(blank=True)
    challenges = models.TextField(blank=True)
    next_action = models.TextField(blank=True)
    next_follow_up_date = models.DateField(null=True, blank=True)
    time_spent_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class TaskComment(AuditMetadataMixin, models.Model):
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="project_task_comments")
    body = models.TextField()
    mentions = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="mentioned_project_task_comments")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class TaskAttachment(AuditMetadataMixin, models.Model):
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="attachments")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="project_task_attachments")
    file = models.FileField(upload_to="projects/tasks/%Y/%m/")
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    is_evidence = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class TaskFollowUp(AuditMetadataMixin, models.Model):
    STATUS_CHOICES = [("scheduled", "Scheduled"), ("pending", "Pending"), ("completed", "Completed"), ("overdue", "Overdue"), ("cancelled", "Cancelled")]
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="follow_ups")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="project_task_follow_ups")
    follow_up_date = models.DateField()
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="scheduled")
    outcome = models.TextField(blank=True)
    next_follow_up_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["follow_up_date", "id"]

    def mark_completed(self):
        self.status = "completed"
        self.completed_at = timezone.now()
