from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0047_system_notification"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="document_status_policy",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
