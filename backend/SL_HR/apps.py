# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.apps import AppConfig

class SLHRConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_HR"
    verbose_name = "SL HR"
    sl_module_definition = {
        "slug": "hr-payroll",
        "name": "HR & Payroll",
        "category": "shared",
        "description": "Staff management, leave tracking, and payroll processing.",
    }
