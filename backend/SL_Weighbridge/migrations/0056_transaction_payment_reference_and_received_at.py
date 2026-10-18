# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0055_backfill_customer_vehicle_tenants"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="payment_received_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="transaction",
            name="payment_reference",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
