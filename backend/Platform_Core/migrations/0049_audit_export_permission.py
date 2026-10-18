# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0048_tenant_settings_document_status_policy"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="auditeventlog",
            options={
                "ordering": ["-created_at", "-id"],
                "permissions": [
                    ("view_tenant_audit_logs", "Can view tenant-scoped audit logs"),
                    ("view_global_audit_logs", "Can view global audit logs across tenants"),
                    ("export_audit_logs", "Can export audit logs"),
                ],
            },
        ),
    ]
