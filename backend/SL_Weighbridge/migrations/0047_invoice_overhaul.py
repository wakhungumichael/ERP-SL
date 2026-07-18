"""
Migration 0047: Invoice System Overhaul
- Add source_module, source_id to Invoice
- Add description, unit_price to InvoiceLine; make vehicle_type nullable
- Add auto_invoice FK to Transaction
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('SL_Weighbridge', '0046_invoice_currency_invoice_issued_at_invoice_notes_and_more'),
    ]

    operations = [
        # Invoice: source_module
        migrations.AddField(
            model_name='invoice',
            name='source_module',
            field=models.CharField(
                choices=[
                    ('weighbridge', 'Weighbridge'),
                    ('hr', 'HR'),
                    ('procurement', 'Procurement'),
                    ('crm', 'CRM'),
                    ('manual', 'Manual'),
                ],
                default='manual',
                max_length=20,
            ),
        ),
        # Invoice: source_id
        migrations.AddField(
            model_name='invoice',
            name='source_id',
            field=models.IntegerField(blank=True, null=True),
        ),
        # InvoiceLine: make vehicle_type nullable
        migrations.AlterField(
            model_name='invoiceline',
            name='vehicle_type',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                to='SL_Weighbridge.vehicletype',
            ),
        ),
        # InvoiceLine: add description
        migrations.AddField(
            model_name='invoiceline',
            name='description',
            field=models.CharField(blank=True, max_length=300),
        ),
        # InvoiceLine: add unit_price
        migrations.AddField(
            model_name='invoiceline',
            name='unit_price',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        # InvoiceLine: quantity default 1 (already 0 in db, just alter)
        migrations.AlterField(
            model_name='invoiceline',
            name='quantity',
            field=models.PositiveIntegerField(default=1),
        ),
        # Transaction: auto_invoice FK
        migrations.AddField(
            model_name='transaction',
            name='auto_invoice',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='auto_invoiced_transactions',
                to='SL_Weighbridge.invoice',
            ),
        ),
    ]
