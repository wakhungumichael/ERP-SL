from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("SL_CRM", "0004_lead_probability_loss_reason")]

    operations = [
        migrations.AddField(
            model_name="organisation",
            name="assigned_to",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_crm_organisations", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="contact",
            name="assigned_to",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_crm_contacts", to=settings.AUTH_USER_MODEL),
        ),
    ]
