from django.apps import AppConfig


class SLSalesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_Sales"
    verbose_name = "SL Sales"
    sl_module_definition = {
        "slug": "sales",
        "name": "Sales",
        "category": "shared",
        "description": "Sales orders, products, recurring billing, and customer commerce flows.",
    }
