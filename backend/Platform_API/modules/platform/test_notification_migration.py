# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from importlib import import_module

from django.apps import apps
from django.contrib.auth.models import User
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase
from django.utils import timezone

from Platform_Core.models import SystemNotification, Tenant


class LegacyNotificationMigrationTests(TransactionTestCase):
    def test_duplicate_history_survives_and_unique_event_constraint_can_be_added(self):
        migration = import_module("Platform_Core.migrations.0066_system_notification_source_event_uniq")
        constraint = next(item for item in SystemNotification._meta.constraints if item.name == "uniq_notification_per_source_event")
        tenant = Tenant.objects.create(name="Legacy notices", code="legacy-notices")
        other = Tenant.objects.create(name="Other notices", code="other-notices")
        user = User.objects.create_user("legacy-notification-user")
        event = dict(tenant=tenant, recipient=user, source_type="workflow_inbox", source_id=34, title="Approval", message="Existing notification", route_path="/workflows/approvals")
        with connection.schema_editor() as editor:
            editor.remove_constraint(SystemNotification, constraint)
        restored = False
        try:
            first = SystemNotification.objects.create(**event, metadata={"workflow_id": 2})
            duplicate = SystemNotification.objects.create(**event, is_read=True, read_at=timezone.now(), metadata={"workflow_id": 2, "note": "Retain this"})
            SystemNotification.objects.create(**{**event, "tenant": other})
            SystemNotification.objects.create(**{**event, "source_id": None})
            SystemNotification.objects.create(**{**event, "source_id": None})
            fields = ["id", "tenant_id", "recipient_id", "title", "message", "route_path", "source_id", "is_read", "read_at", "created_at"]
            before = list(SystemNotification.objects.order_by("pk").values(*fields))
            with connection.schema_editor() as editor:
                migration.preserve_duplicate_notification_history(apps, editor)
                editor.add_constraint(SystemNotification, constraint)
            restored = True
            self.assertEqual(list(SystemNotification.objects.order_by("pk").values(*fields)), before)
            first.refresh_from_db()
            duplicate.refresh_from_db()
            self.assertEqual(first.source_type, "workflow_inbox")
            self.assertEqual(duplicate.source_type, "")
            self.assertEqual(duplicate.metadata["note"], "Retain this")
            self.assertEqual(duplicate.metadata[migration.LEGACY_SOURCE_KEY], {"source_type": "workflow_inbox", "source_id": 34, "canonical_notification_id": first.pk})
            with self.assertRaises(IntegrityError), transaction.atomic():
                SystemNotification.objects.create(**event)
            state = list(SystemNotification.objects.order_by("pk").values())
            with connection.schema_editor() as editor:
                migration.preserve_duplicate_notification_history(apps, editor)
            self.assertEqual(list(SystemNotification.objects.order_by("pk").values()), state)
        finally:
            if not restored:
                with connection.schema_editor() as editor:
                    migration.preserve_duplicate_notification_history(apps, editor)
                    editor.add_constraint(SystemNotification, constraint)
