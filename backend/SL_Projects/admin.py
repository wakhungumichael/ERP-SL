# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.contrib import admin

from .models import Project, ProjectDocument, ProjectMilestone, ProjectTask, TaskFollowUp


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "tenant", "branch", "status", "progress_percentage")
    list_filter = ("status", "priority", "tenant")
    search_fields = ("code", "name")


@admin.register(ProjectMilestone)
class ProjectMilestoneAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "due_date", "status")


@admin.register(ProjectTask)
class ProjectTaskAdmin(admin.ModelAdmin):
    list_display = ("number", "title", "tenant", "branch", "is_active", "status", "primary_assignee", "due_date")
    readonly_fields = ("is_active", "deactivated_at", "deactivated_by")

    def has_delete_permission(self, request, obj=None):
        return False
    list_filter = ("is_active", "status", "priority", "tenant")
    search_fields = ("number", "title")


@admin.register(ProjectDocument)
class ProjectDocumentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "project", "uploaded_by", "is_evidence", "created_at")
    list_filter = ("is_evidence", "project__tenant")
    search_fields = ("original_name", "project__code", "project__name")


@admin.register(TaskFollowUp)
class TaskFollowUpAdmin(admin.ModelAdmin):
    list_display = ("task", "owner", "follow_up_date", "status")
