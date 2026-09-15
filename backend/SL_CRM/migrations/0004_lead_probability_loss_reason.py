from django.db import migrations, models
from django.core.validators import MinValueValidator, MaxValueValidator


class Migration(migrations.Migration):
    dependencies = [("SL_CRM", "0003_activity_workflow_fields")]

    operations = [
        migrations.AddField(
            model_name="lead",
            name="probability",
            field=models.PositiveSmallIntegerField(
                blank=True, null=True,
                validators=[MinValueValidator(0), MaxValueValidator(100)],
            ),
        ),
        migrations.AddField(
            model_name="lead",
            name="loss_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
