# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0002_projectdocument")]

    operations = [
        migrations.CreateModel(
            name="TicketTaskStatusSyncPolicy",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("is_enabled", models.BooleanField(default=False)),
                ("target_ticket_status", models.CharField(choices=[("pending", "Pending"), ("resolved", "Resolved")], default="resolved", max_length=20)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("tenant", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="project_ticket_sync_policy", to="Platform_Core.tenant")),
            ],
        )
    ]
