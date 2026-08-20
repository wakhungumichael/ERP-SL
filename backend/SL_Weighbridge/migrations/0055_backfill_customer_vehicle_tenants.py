from django.db import migrations


def backfill_customer_vehicle_tenants(apps, schema_editor):
    Transaction = apps.get_model('SL_Weighbridge', 'Transaction')
    Customer = apps.get_model('SL_Weighbridge', 'Customer')
    Vehicle = apps.get_model('SL_Weighbridge', 'Vehicle')

    customer_tenants = {}
    vehicle_tenants = {}

    for tx in Transaction.objects.exclude(tenant=None).order_by('id').values('customer_id', 'vehicle_id', 'tenant_id'):
        if tx['customer_id'] and tx['customer_id'] not in customer_tenants:
            customer_tenants[tx['customer_id']] = tx['tenant_id']
        if tx['vehicle_id'] and tx['vehicle_id'] not in vehicle_tenants:
            vehicle_tenants[tx['vehicle_id']] = tx['tenant_id']

    for customer_id, tenant_id in customer_tenants.items():
        Customer.objects.filter(pk=customer_id, tenant__isnull=True).update(tenant_id=tenant_id)

    for vehicle_id, tenant_id in vehicle_tenants.items():
        Vehicle.objects.filter(pk=vehicle_id, tenant__isnull=True).update(tenant_id=tenant_id)


class Migration(migrations.Migration):

    dependencies = [
        ('SL_Weighbridge', '0054_customer_vehicle_operation_type'),
    ]

    operations = [
        migrations.RunPython(backfill_customer_vehicle_tenants, migrations.RunPython.noop),
    ]
