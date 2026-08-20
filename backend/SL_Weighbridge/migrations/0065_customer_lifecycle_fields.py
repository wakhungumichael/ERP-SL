from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0064_vehicle_is_active"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="is_deleted",
            field=models.BooleanField(default=False),
        ),
    ]
