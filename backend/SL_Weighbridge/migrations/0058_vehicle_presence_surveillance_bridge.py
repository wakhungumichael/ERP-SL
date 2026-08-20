import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0006_tenant_user_profile_branch_settings"),
        ("SL_Weighbridge", "0057_transaction_status_lifecycle"),
    ]

    operations = [
        migrations.AddField(
            model_name="overweightevent",
            name="capture_source",
            field=models.CharField(
                choices=[("transaction", "Transaction"), ("vehicle_presence", "Vehicle Presence")],
                default="transaction",
                help_text="Whether this surveillance event came from a saved transaction or raw vehicle presence monitoring.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="vehiclepresence",
            name="branch",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vehicle_presences",
                to="SL_Weighbridge.branch",
            ),
        ),
        migrations.AddField(
            model_name="vehiclepresence",
            name="tenant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vehicle_presences",
                to="Platform_Core.tenant",
            ),
        ),
        migrations.AddField(
            model_name="vehiclepresence",
            name="overweight_event",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vehicle_presence",
                to="SL_Weighbridge.overweightevent",
            ),
        ),
    ]
