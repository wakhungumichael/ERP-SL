from django.db import migrations, models
import django.db.models.deletion


def preserve_existing_workflows(apps, schema_editor):
    WorkflowDefinition = apps.get_model("Platform_Core", "WorkflowDefinition")
    # Definitions created before lifecycle support were already live in the ERP.
    WorkflowDefinition.objects.filter(is_active=True).update(status="published")
    WorkflowDefinition.objects.filter(is_active=False).update(status="inactive")


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0043_organization_membership_active_role")]

    operations = [
        migrations.AddField(
            model_name="workflowdefinition",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workflowdefinition",
            name="effective_from",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workflowdefinition",
            name="published_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workflowdefinition",
            name="revision_of",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="revisions", to="Platform_Core.workflowdefinition"),
        ),
        migrations.AddField(
            model_name="workflowdefinition",
            name="status",
            field=models.CharField(choices=[("draft", "Draft"), ("published", "Published"), ("inactive", "Inactive"), ("archived", "Archived")], default="draft", max_length=20),
        ),
        migrations.AddField(
            model_name="workflowdefinition",
            name="version_major",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="workflowdefinition",
            name="version_minor",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(preserve_existing_workflows, migrations.RunPython.noop),
        migrations.AlterModelOptions(
            name="workflowdefinition",
            options={
                "ordering": ["tenant__name", "name"],
                "permissions": [
                    ("publish_workflowdefinition", "Can publish workflow definitions"),
                    ("archive_workflowdefinition", "Can archive workflow definitions"),
                    ("duplicate_workflowdefinition", "Can duplicate workflow definitions"),
                    ("manage_workflow_nodes", "Can manage workflow nodes"),
                    ("manage_workflow_transitions", "Can manage workflow transitions"),
                    ("manage_workflow_conditions", "Can manage workflow conditions"),
                    ("manage_workflow_assignments", "Can manage workflow assignments"),
                    ("forward_workflow", "Can forward records for approval"),
                    ("approve_workflow", "Can approve assigned workflow tasks"),
                ],
            },
        ),
    ]
