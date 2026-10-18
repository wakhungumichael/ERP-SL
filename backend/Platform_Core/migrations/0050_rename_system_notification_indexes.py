# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0049_audit_export_permission"),
    ]

    operations = [
        migrations.RenameIndex(
            model_name="systemnotification",
            old_name="Platform_Co_tenant__c8d80d_idx",
            new_name="Platform_Co_tenant__a76cda_idx",
        ),
        migrations.RenameIndex(
            model_name="systemnotification",
            old_name="Platform_Co_source__36c6c4_idx",
            new_name="Platform_Co_source__fc29e1_idx",
        ),
    ]
