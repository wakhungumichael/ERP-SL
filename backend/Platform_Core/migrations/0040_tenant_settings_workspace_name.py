# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0039_dashboard_access_permissions")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="workspace_name",
            field=models.CharField(blank=True, max_length=120),
        ),
    ]
