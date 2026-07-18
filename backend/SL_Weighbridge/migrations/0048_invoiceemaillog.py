from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('SL_Weighbridge', '0047_invoice_overhaul'),
    ]

    operations = [
        migrations.CreateModel(
            name='InvoiceEmailLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('recipient', models.EmailField(max_length=255)),
                ('sent_at', models.DateTimeField(auto_now_add=True)),
                ('success', models.BooleanField(default=False)),
                ('failure_reason', models.TextField(blank=True, null=True)),
                ('invoice', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='email_logs',
                    to='SL_Weighbridge.invoice',
                )),
            ],
            options={
                'ordering': ['-sent_at'],
            },
        ),
    ]
