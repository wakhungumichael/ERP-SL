from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("Platform_Core", "0016_merge_20260726_1820"),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkflowEntityBinding",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("module_slug", models.CharField(max_length=100)),
                ("entity_type", models.CharField(max_length=100)),
                ("entity_label", models.CharField(max_length=180)),
                ("route_path", models.CharField(blank=True, max_length=255)),
                ("api_base_path", models.CharField(blank=True, max_length=255)),
                ("trigger_events", models.JSONField(blank=True, default=list)),
                ("is_primary", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("workflow", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="entity_bindings", to="Platform_Core.workflowdefinition")),
            ],
            options={
                "ordering": ["workflow__name", "-is_primary", "entity_label"],
                "unique_together": {("workflow", "module_slug", "entity_type")},
            },
        ),
        migrations.CreateModel(
            name="WorkflowNodeDefinition",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("code", models.SlugField(max_length=100)),
                ("name", models.CharField(max_length=180)),
                ("node_type", models.CharField(choices=[("start", "Start"), ("approval", "Approval"), ("review", "Review"), ("condition", "Condition"), ("notification", "Notification"), ("task", "Task"), ("end", "End")], default="approval", max_length=30)),
                ("step_order", models.PositiveIntegerField(default=1)),
                ("is_initial", models.BooleanField(default=False)),
                ("approval_mode", models.CharField(choices=[("single", "Single Approver"), ("any_one", "Any One Member"), ("all_members", "All Members"), ("quorum", "Quorum")], default="single", max_length=20)),
                ("required_approvals", models.PositiveIntegerField(default=1)),
                ("min_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("max_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("cost_center", models.CharField(blank=True, max_length=120)),
                ("entry_action", models.CharField(blank=True, max_length=120)),
                ("exit_action", models.CharField(blank=True, max_length=120)),
                ("notify_dashboard", models.BooleanField(default=True)),
                ("allow_quick_action", models.BooleanField(default=True)),
                ("sla_hours", models.PositiveIntegerField(default=0)),
                ("position_x", models.IntegerField(default=0)),
                ("position_y", models.IntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("approval_group", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="workflow_node_definitions", to="auth.group")),
                ("assigned_user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="workflow_node_definitions", to=settings.AUTH_USER_MODEL)),
                ("workflow", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="nodes", to="Platform_Core.workflowdefinition")),
            ],
            options={
                "ordering": ["workflow__name", "step_order", "id"],
                "unique_together": {("workflow", "code")},
            },
        ),
        migrations.CreateModel(
            name="WorkflowTransitionDefinition",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=180)),
                ("transition_key", models.SlugField(default="next", max_length=100)),
                ("decision", models.CharField(blank=True, max_length=50)),
                ("priority", models.PositiveIntegerField(default=1)),
                ("is_default", models.BooleanField(default=False)),
                ("condition_field", models.CharField(blank=True, max_length=120)),
                ("condition_operator", models.CharField(choices=[("always", "Always"), ("eq", "Equals"), ("neq", "Not Equals"), ("gt", "Greater Than"), ("gte", "Greater Than or Equal"), ("lt", "Less Than"), ("lte", "Less Than or Equal"), ("contains", "Contains"), ("in", "In"), ("is_true", "Is True"), ("is_false", "Is False")], default="always", max_length=20)),
                ("condition_value", models.CharField(blank=True, max_length=255)),
                ("is_active", models.BooleanField(default=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("from_node", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="outgoing_transitions", to="Platform_Core.workflownodedefinition")),
                ("to_node", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="incoming_transitions", to="Platform_Core.workflownodedefinition")),
                ("workflow", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="transitions", to="Platform_Core.workflowdefinition")),
            ],
            options={
                "ordering": ["workflow__name", "priority", "id"],
            },
        ),
        migrations.AddField(
            model_name="workflowinboxitem",
            name="node_definition",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="inbox_items", to="Platform_Core.workflownodedefinition"),
        ),
    ]
