# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.urls import path

from . import views


urlpatterns = [
    path("dashboard/", views.ProjectsDashboardAPIView.as_view(), name="projects-dashboard"),
    path("reports/", views.ProjectsReportsAPIView.as_view(), name="projects-reports"),
    path("projects/export/", views.ProjectExportAPIView.as_view(), name="project-export"),
    path("tasks/export/", views.TaskExportAPIView.as_view(), name="project-task-export"),
    path("follow-ups/", views.TaskFollowUpWorkspaceAPIView.as_view(), name="projects-followup-workspace"),
    path("projects/", views.ProjectListCreateAPIView.as_view(), name="project-list"),
    path("projects/<int:pk>/", views.ProjectDetailAPIView.as_view(), name="project-detail"),
    path("projects/<int:pk>/milestones/", views.ProjectMilestoneListCreateAPIView.as_view(), name="project-milestone-list"),
    path("projects/<int:pk>/members/", views.ProjectMemberListCreateAPIView.as_view(), name="project-member-list"),
    path("tasks/", views.TaskListCreateAPIView.as_view(), name="project-task-list"),
    path("tasks/<int:pk>/", views.TaskDetailAPIView.as_view(), name="project-task-detail"),
    path("tasks/<int:pk>/updates/", views.TaskUpdateListCreateAPIView.as_view(), name="project-task-update-list"),
    path("tasks/<int:pk>/follow-ups/", views.TaskFollowUpListCreateAPIView.as_view(), name="project-task-followup-list"),
    path("tasks/<int:pk>/follow-ups/<int:follow_up_id>/complete/", views.TaskFollowUpCompleteAPIView.as_view(), name="project-task-followup-complete"),
    path("tasks/<int:pk>/comments/", views.TaskCommentListCreateAPIView.as_view(), name="project-task-comment-list"),
    path("tasks/<int:pk>/attachments/", views.TaskAttachmentListCreateAPIView.as_view(), name="project-task-attachment-list"),
    path("tasks/<int:pk>/assignees/", views.TaskAssigneeListAPIView.as_view(), name="project-task-assignee-list"),
    path("tasks/<int:pk>/assign/", views.TaskAssignmentAPIView.as_view(), name="project-task-assign"),
    path("tasks/<int:pk>/structure/", views.TaskStructureAPIView.as_view(), name="project-task-structure"),
    path("tickets/<int:ticket_id>/tasks/", views.TicketTaskListCreateAPIView.as_view(), name="project-ticket-task-list"),
]
