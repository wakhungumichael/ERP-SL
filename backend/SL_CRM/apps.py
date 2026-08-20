from django.apps import AppConfig


class SlCrmConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_CRM"
    verbose_name = "CRM"
    sl_module_definition = {
        "slug": "crm",
        "name": "CRM",
        "category": "vertical",
        "description": "Customer, supplier, contact, and opportunity management.",
    }
