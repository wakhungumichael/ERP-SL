from django.apps import AppConfig


class SlInventoryConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_Inventory"
    sl_module_definition = {
        "slug": "inventory",
        "name": "Inventory",
        "category": "shared",
        "description": "Stock items, inventory movements, warehouse balances, and product availability.",
    }
