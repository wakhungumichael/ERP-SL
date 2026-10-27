# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0066_system_notification_source_event_uniq")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="dashboard_layouts",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
