"""Organization-specific project-module configuration."""
from copy import deepcopy
from .task_types import TASK_TYPES


def default_task_types():
    return [{**deepcopy(row), "is_active": True} for row in TASK_TYPES if row["value"] != "other"]


def default_task_statuses():
    return ["draft", "todo", "in_progress", "blocked", "reopened", "in_review", "completed", "cancelled"]


def get_project_settings(tenant):
    from .models import ProjectModuleSettings
    return ProjectModuleSettings.objects.filter(tenant=tenant).first() or ProjectModuleSettings(tenant=tenant)


def active_task_types(config):
    types = [{key: row[key] for key in ("value", "label", "category")} for row in config.task_types if row.get("is_active", True)]
    if config.allow_custom_task_types:
        types.append({"value": "other", "label": "Other (type your own)", "category": "Custom"})
    return types
