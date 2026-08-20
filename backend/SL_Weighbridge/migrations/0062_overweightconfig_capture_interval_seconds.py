from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0061_alter_transaction_branch_remove_default"),
    ]

    operations = [
        migrations.AddField(
            model_name="overweightconfig",
            name="capture_interval_seconds",
            field=models.IntegerField(
                default=45,
                help_text="Minimum number of seconds between repeated vehicle-presence captures for the same branch and weight.",
            ),
        ),
    ]
