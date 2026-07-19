from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('SL_Procurement', '0001_initial'),
        ('Platform_Core', '0006_tenant_user_profile_branch_settings'),
        ('SL_Weighbridge', '0050_overweight_surveillance'),
        ('SL_CRM', '0001_initial'),
        ('SL_Sales', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Bill',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('bill_number', models.CharField(blank=True, max_length=50)),
                ('reference', models.CharField(blank=True, max_length=100, help_text='Supplier reference number')),
                ('supplier_name', models.CharField(blank=True, max_length=200)),
                ('issue_date', models.DateField(default=django.utils.timezone.now)),
                ('due_date', models.DateField(null=True, blank=True)),
                ('status', models.CharField(
                    choices=[('draft', 'Draft'), ('received', 'Received'), ('approved', 'Approved'), ('paid', 'Paid'), ('overdue', 'Overdue')],
                    default='draft', max_length=20,
                )),
                ('subtotal', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='bills', to='Platform_Core.tenant')),
                ('branch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bills', to='SL_Weighbridge.branch')),
                ('supplier', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bills', to='SL_CRM.supplier')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_bills', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='bill',
            constraint=models.UniqueConstraint(fields=['tenant', 'bill_number'], condition=models.Q(bill_number__gt=''), name='bill_unique_number_per_tenant'),
        ),
        migrations.CreateModel(
            name='BillLineItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('description', models.CharField(blank=True, max_length=300)),
                ('quantity', models.DecimalField(decimal_places=3, default=1, max_digits=10)),
                ('unit_price', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_rate', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('line_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('sort_order', models.PositiveIntegerField(default=0)),
                ('bill', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='line_items', to='SL_Procurement.bill')),
                ('product', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bill_lines', to='SL_Sales.product')),
            ],
            options={'ordering': ['sort_order', 'id']},
        ),
    ]
