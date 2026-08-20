from rest_framework import serializers
from .models import Transaction, IndicatorConfig




from rest_framework import serializers
from .models import Transaction

class TransactionSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source='branch.name', read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    vehicle_plate = serializers.CharField(source='vehicle.number_plate', read_only=True)  # Adjust field name accordingly
    operator = serializers.CharField()
    item_name = serializers.CharField(source='item.name', read_only=True)
    vehicle_type_name = serializers.CharField(source='vehicle_type.name', read_only=True)
    workflow_step_name = serializers.CharField(source='workflow_step.name', read_only=True)

    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    last_modified_by_username = serializers.CharField(source='last_modified_by.username', read_only=True)

    class Meta:
        model = Transaction
        fields = [
            'id', 'branch', 'branch_name', 'customer', 'customer_name', 'vehicle', 'vehicle_plate',
            'operator', 'item', 'item_name', 'vehicle_type', 'vehicle_type_name',
            'gross_weight_date', 'tare_weight_date', 'status', 'gross_weight', 'tare_weight', 'net_weight',
            'manual_weight_capture', 'discounted', 'weight_date', 'created_by', 'created_by_username',
            'last_modified_by', 'last_modified_by_username', 'created_at', 'updated_at', 'paired', 'charge',
            'destination', 'weight_type', 'payment_mode', 'payment_status', 'payment_reference', 'payment_received_at', 'invoiced', 'workflow_step',
            'workflow_step_name', 'approval_status', 'weight_reason', 'manual_receipt',
        ]


class IndicatorConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = IndicatorConfig
        fields = '__all__'  # or specify the fields you need
