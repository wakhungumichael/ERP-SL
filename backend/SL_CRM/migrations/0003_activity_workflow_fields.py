from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("SL_CRM", "0002_lead_products"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="status",
            field=models.CharField(
                choices=[("open", "Open"), ("completed", "Completed"), ("cancelled", "Cancelled")],
                default="open",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="activity",
            name="outcome",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="activity",
            name="notes",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="activity",
            name="next_action",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="activity",
            name="next_action_date",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="activity",
            name="assigned_to",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_crm_activities",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
