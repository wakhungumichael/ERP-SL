from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0060_seed_indicator_from_legacy_live_stable_settings"),
    ]

    operations = [
        migrations.AlterField(
            model_name="transaction",
            name="branch",
            field=models.ForeignKey(on_delete=models.CASCADE, to="SL_Weighbridge.branch"),
        ),
    ]
