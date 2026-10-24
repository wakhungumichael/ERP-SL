# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.urls import path

from . import views


urlpatterns = [
    path("dashboard/", views.ProjectsDashboardAPIView.as_view(), name="projects-dashboard"),
    path("projects/", views.ProjectListCreateAPIView.as_view(), name="project-list"),
    path("projects/<int:pk>/", views.ProjectDetailAPIView.as_view(), name="project-detail"),
    path("tasks/", views.TaskListCreateAPIView.as_view(), name="project-task-list"),
    path("tasks/<int:pk>/", views.TaskDetailAPIView.as_view(), name="project-task-detail"),
    path("tasks/<int:pk>/updates/", views.TaskUpdateListCreateAPIView.as_view(), name="project-task-update-list"),
    path("tasks/<int:pk>/follow-ups/", views.TaskFollowUpListCreateAPIView.as_view(), name="project-task-followup-list"),
]
