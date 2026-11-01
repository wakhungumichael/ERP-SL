from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0005_task_checklist_and_participant_roles")]
    operations = [
        migrations.AddField(model_name="project", name="is_general", field=models.BooleanField(default=False, editable=False)),
        migrations.AddConstraint(model_name="project", constraint=models.UniqueConstraint(fields=("tenant", "branch"), condition=models.Q(is_general=True), name="projects_one_general_per_branch")),
    ]
