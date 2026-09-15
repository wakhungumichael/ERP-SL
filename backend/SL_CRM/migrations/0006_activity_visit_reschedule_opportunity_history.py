from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("SL_CRM", "0005_crm_record_ownership")]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="rescheduled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="activity",
            name="reschedule_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="activity",
            name="type",
            field=models.CharField(choices=[("call", "Phone Call"), ("email", "Email"), ("meeting", "Meeting"), ("note", "Note"), ("task", "Task"), ("visit", "Customer Visit")], default="note", max_length=20),
        ),
        migrations.CreateModel(
            name="OpportunityHistory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("change_type", models.CharField(max_length=30)),
                ("old_value", models.CharField(blank=True, default="", max_length=255)),
                ("new_value", models.CharField(blank=True, default="", max_length=255)),
                ("changed_at", models.DateTimeField(auto_now_add=True)),
                ("changed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ("opportunity", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="history", to="SL_CRM.lead")),
            ],
            options={"ordering": ["-changed_at"]},
        ),
    ]
