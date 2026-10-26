# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0058_projects_tasks_team_menu")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name=name,
            field=models.CharField(max_length=7, blank=True, default=""),
        )
        for name in ("secondary_color", "accent_color", "sidebar_color")
    ]
