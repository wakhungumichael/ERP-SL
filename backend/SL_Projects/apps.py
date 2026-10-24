# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.apps import AppConfig


class SlProjectsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_Projects"
    verbose_name = "SL Projects & Tasks"
    sl_module_definition = {
        "slug": "projects-tasks",
        "name": "Projects & Tasks",
        "category": "shared",
        "description": "Branch-aware project delivery, tasks, milestones, and follow-ups.",
    }
