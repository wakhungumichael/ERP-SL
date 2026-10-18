# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0045_platform_branding_settings")]

    operations = [
        migrations.AddField(model_name="workflowinboxitem", name="defer_reason", field=models.TextField(blank=True)),
        migrations.AddField(model_name="workflowinboxitem", name="deferred_until", field=models.DateTimeField(blank=True, null=True)),
        migrations.AlterField(model_name="workflowinboxitem", name="status", field=models.CharField(choices=[("pending", "Pending"), ("deferred", "Deferred"), ("approved", "Approved"), ("rejected", "Rejected"), ("cancelled", "Cancelled"), ("completed", "Completed")], default="pending", max_length=20)),
    ]
