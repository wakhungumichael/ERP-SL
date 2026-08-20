from django.apps import AppConfig


class SlTicketingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "SL_Ticketing"
    verbose_name = "SL Ticketing"
    sl_module_definition = {
        "slug": "ticketing",
        "name": "Ticketing",
        "category": "shared",
        "description": "Service tickets, issue resolution, and support workflow coordination.",
    }
