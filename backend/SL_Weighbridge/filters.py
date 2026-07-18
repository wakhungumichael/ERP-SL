import django_filters
from .models import Transaction

class TransactionFilter(django_filters.FilterSet):
    # For date range filtering
    gross_weight_date_after = django_filters.DateFilter(field_name='gross_weight_date', lookup_expr='gte')
    gross_weight_date_before = django_filters.DateFilter(field_name='gross_weight_date', lookup_expr='lte')

    tare_weight_date_after = django_filters.DateFilter(field_name='tare_weight_date', lookup_expr='gte')
    tare_weight_date_before = django_filters.DateFilter(field_name='tare_weight_date', lookup_expr='lte')

    # Foreign key filters by related name fields (icontains for partial matching)
    branch_name = django_filters.CharFilter(field_name='branch__name', lookup_expr='icontains')
    customer_name = django_filters.CharFilter(field_name='customer__name', lookup_expr='icontains')
    vehicle_plate = django_filters.CharFilter(field_name='vehicle__plate_number', lookup_expr='icontains')
    item_name = django_filters.CharFilter(field_name='item__name', lookup_expr='icontains')
    vehicle_type_name = django_filters.CharFilter(field_name='vehicle_type__name', lookup_expr='icontains')
    workflow_step_name = django_filters.CharFilter(field_name='workflow_step__name', lookup_expr='icontains')

    operator = django_filters.CharFilter(lookup_expr='icontains')
    status = django_filters.CharFilter(lookup_expr='iexact')
    weight_type = django_filters.CharFilter(lookup_expr='iexact')
    payment_mode = django_filters.CharFilter(lookup_expr='iexact')
    payment_status = django_filters.CharFilter(lookup_expr='iexact')
    destination = django_filters.CharFilter(lookup_expr='icontains')
    approval_status = django_filters.BooleanFilter()

    class Meta:
        model = Transaction
        fields = [
            'branch_name', 'customer_name', 'vehicle_plate', 'item_name', 'vehicle_type_name',
            'workflow_step_name', 'operator', 'status', 'weight_type', 'payment_mode', 'payment_status',
            'destination', 'approval_status',
            'gross_weight_date_after', 'gross_weight_date_before',
            'tare_weight_date_after', 'tare_weight_date_before',
        ]
