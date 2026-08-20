from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0068_repair_reference_tenant_schema"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehiclepresence",
            name="client",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vehicle_presences",
                to="SL_Weighbridge.company",
            ),
        ),
        migrations.AddField(
            model_name="vehiclepresence",
            name="station",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vehicle_presence_stations",
                to="SL_Weighbridge.branch",
            ),
        ),
    ]
