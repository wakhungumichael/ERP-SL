from django.apps import AppConfig


class SlBudgetingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_Budgeting"
    sl_module_definition = {
        "slug": "budgeting",
        "name": "Budgeting & Commitments",
        "category": "shared",
        "description": "Budget setup, commitment accounting, and financial control checks.",
    }
