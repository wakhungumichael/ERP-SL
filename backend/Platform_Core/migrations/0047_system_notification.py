from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0046_workflow_inbox_deferral")]

    operations = [
        migrations.CreateModel(
            name="SystemNotification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("category", models.CharField(choices=[("workflow", "Workflow"), ("system", "System"), ("reminder", "Reminder")], default="system", max_length=30)),
                ("title", models.CharField(max_length=200)),
                ("message", models.TextField(blank=True)),
                ("route_path", models.CharField(blank=True, max_length=255)),
                ("source_type", models.CharField(blank=True, max_length=80)),
                ("source_id", models.PositiveIntegerField(blank=True, null=True)),
                ("is_read", models.BooleanField(default=False)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="system_notifications", to=settings.AUTH_USER_MODEL)),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="system_notifications", to="Platform_Core.tenant")),
            ],
            options={"ordering": ["is_read", "-created_at"]},
        ),
        migrations.AddIndex(model_name="systemnotification", index=models.Index(fields=["tenant", "recipient", "is_read"], name="Platform_Co_tenant__c8d80d_idx")),
        migrations.AddIndex(model_name="systemnotification", index=models.Index(fields=["source_type", "source_id"], name="Platform_Co_source__36c6c4_idx")),
    ]
