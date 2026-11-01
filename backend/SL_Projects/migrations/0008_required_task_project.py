from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0007_assign_general_projects")]
    operations = [
        migrations.AlterField(model_name="projecttask", name="project", field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tasks", to="SL_Projects.project")),
    ]
