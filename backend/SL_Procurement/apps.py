from django.apps import AppConfig

class SLProcurementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_Procurement"
    verbose_name = "SL Procurement"
    sl_module_definition = {
        "slug": "procurement",
        "name": "Procurement",
        "category": "shared",
        "description": "Purchase orders, supplier management, and goods receipt.",
    }
