from django.db import migrations, models


def set_existing_second_weight_defaults(apps, schema_editor):
    WeighingOperationType = apps.get_model("SL_Weighbridge", "WeighingOperationType")
    WeighingOperationType.objects.filter(flow_kind="second").update(requires_payment=False)


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0080_transaction_in_progress_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="weighingoperationtype",
            name="requires_payment",
            field=models.BooleanField(
                default=True,
                help_text="Whether transactions captured with this operation type require payment.",
            ),
        ),
        migrations.RunPython(set_existing_second_weight_defaults, migrations.RunPython.noop),
    ]
