from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0062_overweightconfig_capture_interval_seconds"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="driver_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="transaction",
            name="driver_phone",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
    ]
