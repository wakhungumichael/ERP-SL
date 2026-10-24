# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.contrib import admin

from .models import Project, ProjectMilestone, ProjectTask, TaskFollowUp


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
    list_display = ("number", "title", "tenant", "branch", "status", "primary_assignee", "due_date")
    list_filter = ("status", "priority", "tenant")
    search_fields = ("number", "title")


@admin.register(TaskFollowUp)
class TaskFollowUpAdmin(admin.ModelAdmin):
    list_display = ("task", "owner", "follow_up_date", "status")
