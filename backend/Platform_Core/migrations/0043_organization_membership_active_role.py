# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0042_tenant_settings_shared_weighbridge_vehicles")]

    operations = [
        migrations.AddField(
            model_name="organizationmembership",
            name="active_role_group_name",
            field=models.CharField(blank=True, max_length=150),
        ),
    ]
