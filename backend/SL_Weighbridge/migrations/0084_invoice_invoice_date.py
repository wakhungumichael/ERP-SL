# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone


def populate_invoice_dates(apps, schema_editor):
    Invoice = apps.get_model("SL_Weighbridge", "Invoice")
    Invoice.objects.using(schema_editor.connection.alias).filter(invoice_date__isnull=True).update(
        invoice_date=TruncDate(Coalesce("issued_at", "issued_date"))
    )


class Migration(migrations.Migration):
    dependencies = [("SL_Weighbridge", "0083_manual_invoice_tax_and_charges")]
    operations = [
        migrations.AddField(model_name="invoice", name="invoice_date", field=models.DateField(null=True, blank=True)),
        migrations.RunPython(populate_invoice_dates, migrations.RunPython.noop),
        migrations.AlterField(model_name="invoice", name="invoice_date", field=models.DateField(default=timezone.localdate, null=True, blank=True)),
    ]
