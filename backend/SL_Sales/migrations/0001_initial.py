from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('Platform_Core', '0006_tenant_user_profile_branch_settings'),
        ('SL_Weighbridge', '0050_overweight_surveillance'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── Product ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='Product',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(blank=True, max_length=50)),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('product_type', models.CharField(choices=[('product', 'Product'), ('service', 'Service')], default='service', max_length=20)),
                ('unit', models.CharField(blank=True, max_length=50)),
                ('unit_price', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_rate', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='products', to='Platform_Core.tenant')),
                ('income_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='income_products', to='Platform_Core.account')),
                ('expense_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='expense_products', to='Platform_Core.account')),
            ],
            options={'ordering': ['tenant_id', 'name']},
        ),
        migrations.AddConstraint(
            model_name='product',
            constraint=models.UniqueConstraint(fields=['tenant', 'code'], condition=models.Q(code__gt=''), name='product_unique_code_per_tenant'),
        ),

        # ── Estimate ─────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='Estimate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('customer_name', models.CharField(blank=True, max_length=200)),
                ('estimate_number', models.CharField(blank=True, max_length=50)),
                ('issue_date', models.DateField(default=django.utils.timezone.now)),
                ('expiry_date', models.DateField(blank=True, null=True)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('sent', 'Sent'), ('accepted', 'Accepted'), ('declined', 'Declined'), ('expired', 'Expired')], default='draft', max_length=20)),
                ('subtotal', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('discount_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('notes', models.TextField(blank=True)),
                ('terms', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='estimates', to='Platform_Core.tenant')),
                ('branch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='estimates', to='SL_Weighbridge.branch')),
                ('customer', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='estimates', to='SL_Weighbridge.customer')),
                ('converted_to_invoice', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='source_estimate', to='SL_Weighbridge.invoice')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_estimates', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='estimate',
            constraint=models.UniqueConstraint(fields=['tenant', 'estimate_number'], condition=models.Q(estimate_number__gt=''), name='estimate_unique_number_per_tenant'),
        ),

        # ── EstimateLineItem ──────────────────────────────────────────────────
        migrations.CreateModel(
            name='EstimateLineItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('description', models.CharField(blank=True, max_length=300)),
                ('quantity', models.DecimalField(decimal_places=3, default=1, max_digits=10)),
                ('unit_price', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_rate', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('discount_amount', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('line_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('sort_order', models.PositiveIntegerField(default=0)),
                ('estimate', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='line_items', to='SL_Sales.estimate')),
                ('product', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='estimate_lines', to='SL_Sales.product')),
            ],
            options={'ordering': ['sort_order', 'id']},
        ),

        # ── RecurringInvoice ─────────────────────────────────────────────────
        migrations.CreateModel(
            name='RecurringInvoice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('customer_name', models.CharField(blank=True, max_length=200)),
                ('frequency', models.CharField(choices=[('weekly', 'Weekly'), ('monthly', 'Monthly'), ('quarterly', 'Quarterly'), ('yearly', 'Yearly')], default='monthly', max_length=20)),
                ('status', models.CharField(choices=[('active', 'Active'), ('paused', 'Paused'), ('ended', 'Ended')], default='active', max_length=20)),
                ('start_date', models.DateField(default=django.utils.timezone.now)),
                ('end_date', models.DateField(blank=True, null=True)),
                ('next_invoice_date', models.DateField(default=django.utils.timezone.now)),
                ('last_generated_at', models.DateTimeField(blank=True, null=True)),
                ('subtotal', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='recurring_invoices', to='Platform_Core.tenant')),
                ('branch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='recurring_invoices', to='SL_Weighbridge.branch')),
                ('customer', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='recurring_invoices', to='SL_Weighbridge.customer')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_recurring_invoices', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),

        # ── RecurringInvoiceLineItem ──────────────────────────────────────────
        migrations.CreateModel(
            name='RecurringInvoiceLineItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('description', models.CharField(blank=True, max_length=300)),
                ('quantity', models.DecimalField(decimal_places=3, default=1, max_digits=10)),
                ('unit_price', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('tax_rate', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('line_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('sort_order', models.PositiveIntegerField(default=0)),
                ('recurring_invoice', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='line_items', to='SL_Sales.recurringinvoice')),
                ('product', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='recurring_lines', to='SL_Sales.product')),
            ],
            options={'ordering': ['sort_order', 'id']},
        ),
    ]
