# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0079_dedupe_weighing_operation_types"),
    ]

    operations = [
        migrations.AlterField(
            model_name="transaction",
            name="status",
            field=models.CharField(
                choices=[
                    ("Draft", "Draft"),
                    ("In Progress", "In Progress"),
                    ("Recalled", "Recalled"),
                    ("Rejected", "Rejected"),
                    ("Completed", "Completed"),
                ],
                default="Draft",
                max_length=20,
            ),
        ),
    ]
