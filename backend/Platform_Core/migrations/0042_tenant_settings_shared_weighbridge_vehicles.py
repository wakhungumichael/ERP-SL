from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0041_organization_membership_branches")]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="allow_shared_weighbridge_vehicles",
            field=models.BooleanField(default=False),
        ),
    ]
