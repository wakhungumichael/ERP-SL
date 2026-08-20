from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("contenttypes", "0002_remove_content_type_name"),
        ("Platform_Core", "0017_workflow_engine_nodes"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditAccessLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("event_group", models.CharField(choices=[("access", "Access"), ("security", "Security")], default="access", max_length=20)),
                ("event_type", models.CharField(default="view", max_length=20)),
                ("request_method", models.CharField(blank=True, max_length=10)),
                ("request_path", models.CharField(max_length=500)),
                ("query_params", models.JSONField(blank=True, default=dict)),
                ("status_code", models.PositiveIntegerField(blank=True, null=True)),
                ("remote_addr", models.CharField(blank=True, max_length=64)),
                ("user_agent", models.CharField(blank=True, max_length=500)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_access_logs", to=settings.AUTH_USER_MODEL)),
                ("branch", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_access_logs", to="Platform_Core.tenantbranch")),
                ("tenant", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="audit_access_logs", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "permissions": [
                    ("view_tenant_access_logs", "Can view tenant-scoped access logs"),
                    ("view_global_access_logs", "Can view global access logs across tenants"),
                ],
            },
        ),
        migrations.CreateModel(
            name="AuditEventLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("event_group", models.CharField(choices=[("data_lifecycle", "Data Lifecycle"), ("workflow", "Workflow"), ("security", "Security"), ("access", "Access"), ("integration", "Integration"), ("system", "System")], default="data_lifecycle", max_length=40)),
                ("event_type", models.CharField(default="request", max_length=60)),
                ("status", models.CharField(choices=[("success", "Success"), ("failed", "Failed"), ("warning", "Warning")], default="success", max_length=20)),
                ("object_id", models.CharField(blank=True, max_length=64)),
                ("model_label", models.CharField(blank=True, max_length=120)),
                ("object_pk", models.CharField(blank=True, max_length=64)),
                ("object_repr", models.CharField(blank=True, max_length=255)),
                ("changes", models.JSONField(blank=True, default=dict)),
                ("previous_values", models.JSONField(blank=True, default=dict)),
                ("current_values", models.JSONField(blank=True, default=dict)),
                ("note", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_event_logs", to=settings.AUTH_USER_MODEL)),
                ("branch", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_event_logs", to="Platform_Core.tenantbranch")),
                ("content_type", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_event_logs", to="contenttypes.contenttype")),
                ("tenant", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="audit_event_logs", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "permissions": [
                    ("view_tenant_audit_logs", "Can view tenant-scoped audit logs"),
                    ("view_global_audit_logs", "Can view global audit logs across tenants"),
                ],
            },
        ),
    ]
