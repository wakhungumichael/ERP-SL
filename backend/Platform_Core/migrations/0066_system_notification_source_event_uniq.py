# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


LEGACY_SOURCE_KEY = "_migration_0066_original_source"


def preserve_duplicate_notification_history(apps, schema_editor):
    """Detach duplicate legacy event keys without deleting notifications."""
    Notification = apps.get_model("Platform_Core", "SystemNotification")
    records = Notification.objects.using(schema_editor.connection.alias)
    duplicates = list(
        records.filter(source_type__gt="", source_id__isnull=False)
        .values("tenant_id", "recipient_id", "source_type", "source_id")
        .annotate(total=models.Count("pk")).filter(total__gt=1).order_by()
    )
    for event in duplicates:
        event.pop("total")
        ids = list(records.filter(**event).order_by("pk").values_list("pk", flat=True))
        for notification in records.filter(pk__in=ids[1:]).iterator():
            original = notification.metadata
            metadata = dict(original) if isinstance(original, dict) else {"legacy_metadata": original}
            source = {"source_type": notification.source_type, "source_id": notification.source_id, "canonical_notification_id": ids[0]}
            if LEGACY_SOURCE_KEY in metadata:
                source["previous_value"] = metadata[LEGACY_SOURCE_KEY]
            metadata[LEGACY_SOURCE_KEY] = source
            records.filter(pk=notification.pk).update(source_type="", metadata=metadata)


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0065_merge_setup_release"),
    ]

    operations = [
        migrations.RunPython(preserve_duplicate_notification_history, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="systemnotification",
            constraint=models.UniqueConstraint(
                fields=["tenant", "recipient", "source_type", "source_id"],
                condition=models.Q(source_type__gt=""),
                name="uniq_notification_per_source_event",
            ),
        ),
    ]
