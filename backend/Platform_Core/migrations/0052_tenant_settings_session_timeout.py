# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0051_organization_branch_role_assignment"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="session_timeout_minutes",
            field=models.PositiveIntegerField(default=30),
        ),
    ]
