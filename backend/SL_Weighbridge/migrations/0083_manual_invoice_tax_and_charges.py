from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('SL_Weighbridge', '0082_invoice_line_product_and_decimal_quantity'),
        ('SL_Sales', '0006_organisation_charges'),
    ]
    operations = [
        migrations.AddField(model_name='invoice', name='subtotal_amount', field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name='invoice', name='tax_total', field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name='invoice', name='charge_total', field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name='invoice', name='tax_mode', field=models.CharField(default='per_line', max_length=16)),
        migrations.AddField(model_name='invoice', name='combined_tax_name', field=models.CharField(blank=True, max_length=100)),
        migrations.AddField(model_name='invoice', name='combined_tax_rate', field=models.DecimalField(decimal_places=2, default=0, max_digits=5)),
        migrations.AddField(model_name='invoiceline', name='tax_rate', field=models.DecimalField(decimal_places=2, default=0, max_digits=5)),
        migrations.AddField(model_name='invoiceline', name='tax_amount', field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.CreateModel(name='InvoiceCharge', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('name', models.CharField(max_length=120)), ('calculation_type', models.CharField(default='percentage', max_length=12)),
            ('rate', models.DecimalField(decimal_places=2, default=0, max_digits=12)), ('amount', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
            ('charge_rule', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='SL_Sales.organisationcharge')),
            ('invoice', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='charges', to='SL_Weighbridge.invoice')),
        ]),
    ]
