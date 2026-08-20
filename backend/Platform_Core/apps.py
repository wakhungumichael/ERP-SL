from django.apps import AppConfig
from django.db.utils import OperationalError, ProgrammingError


def sync_modules_after_migrate(sender, **kwargs):
    from .module_registry import sync_module_definitions

    try:
        sync_module_definitions()
    except (OperationalError, ProgrammingError):
        # Some migrate phases run before the platform tables exist.
        return


class PlatformCoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "Platform_Core"
    sl_module_definition = {
        "slug": "platform-core",
        "name": "Platform Core",
        "category": "core",
        "is_core": True,
        "description": "Tenant management, user auth, roles, and workspace configuration.",
    }

    def ready(self):
        from django.db.models.signals import post_migrate

        from . import audit  # noqa: F401

        audit.register_audit_signals()
        audit.register_auth_signals()
        post_migrate.connect(sync_modules_after_migrate, sender=self, dispatch_uid="platform-core-sync-modules")
