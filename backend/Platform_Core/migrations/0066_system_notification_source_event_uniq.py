# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0065_merge_setup_release"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="systemnotification",
            constraint=models.UniqueConstraint(
                fields=["tenant", "recipient", "source_type", "source_id"],
                condition=models.Q(source_type__gt=""),
                name="uniq_notification_per_source_event",
            ),
        ),
    ]
