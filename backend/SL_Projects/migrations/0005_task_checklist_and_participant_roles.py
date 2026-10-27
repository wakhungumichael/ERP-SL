# Generated for evidence-based task progress and multi-user responsibility.
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("SL_Projects", "0004_alter_projecttask_options"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="taskcollaborator",
            name="participation_role",
            field=models.CharField(
                choices=[("accountable", "Accountable assignee"), ("supporting", "Supporting participant")],
                default="supporting",
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name="TaskChecklistItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=255)),
                ("is_completed", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("completed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="completed_project_checklist_items", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_project_checklist_items", to=settings.AUTH_USER_MODEL)),
                ("task", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="checklist_items", to="SL_Projects.projecttask")),
            ],
            options={"ordering": ("id",)},
        ),
    ]
