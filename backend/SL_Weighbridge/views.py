from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .models import IndicatorConfig, Transaction
from .serializers import TransactionSerializer, IndicatorConfigSerializer
from .utils import capture_weight_from_indicator
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import Transaction
from .serializers import TransactionSerializer
from datetime import timedelta
from django.utils.timezone import now

from django.http import Http404, JsonResponse, StreamingHttpResponse
from threading import Thread
from .utils import capture_weight_from_indicator
from .utils import capture_real_time_weight_from_indicator
from .utils import get_indicator_live_weight_stream_url, get_indicator_live_weight_url, parse_indicator_response

import serial
import logging
import requests
from django.contrib.admin.views.decorators import staff_member_required
from django.views.decorators.http import require_GET


# views.py

from rest_framework.response import Response
from rest_framework.decorators import api_view
from rest_framework import status
from .utils import capture_weight_from_indicator
from .models import IndicatorConfig

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .utils import capture_weight_from_indicator
from .models import IndicatorConfig


from rest_framework import generics
from .models import Transaction
from .serializers import TransactionSerializer
from .filters import TransactionFilter
from django_filters.rest_framework import DjangoFilterBackend

from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Transaction
from Platform_API.modules.mixins import NO_TENANT_ACCESS, resolve_user_tenant


logger = logging.getLogger(__name__)


def _legacy_scope_queryset(request, qs, filter_field="tenant"):
    resolved = resolve_user_tenant(request.user)
    if resolved is NO_TENANT_ACCESS:
        return qs.none()
    if resolved is None:
        return qs
    return qs.filter(**{filter_field: resolved})


class TransactionListAPI(generics.ListAPIView):
    queryset = Transaction.objects.all().select_related(
        'branch', 'customer', 'vehicle', 'item', 'vehicle_type', 'workflow_step', 'created_by', 'last_modified_by'
    ).order_by('-created_at', '-id')
    serializer_class = TransactionSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_class = TransactionFilter

    def get_queryset(self):
        return _legacy_scope_queryset(self.request, super().get_queryset())



class RecentTransactionAPIView(APIView):
    def get(self, request):
        vehicle_id = request.GET.get('vehicle_id')
        if not vehicle_id:
            return Response([])

        tx = (
            _legacy_scope_queryset(request, Transaction.objects.filter(vehicle_id=vehicle_id))
            .order_by('-created_at')
            .first()
        )

        if tx:
            serializer = TransactionSerializer(tx)
            return Response([serializer.data])
        return Response([])


@staff_member_required
@require_GET
def admin_live_weight_stream(request):
    stream_url = get_indicator_live_weight_stream_url()

    if not stream_url:
        return JsonResponse(
            {"error": "Live weight stream URL is not configured."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    def stream_events():
        try:
            with requests.get(
                stream_url,
                stream=True,
                headers={"Accept": "text/event-stream"},
                timeout=(5, 30),
            ) as upstream:
                upstream.raise_for_status()

                for line in upstream.iter_lines(decode_unicode=True):
                    if line is None:
                        continue

                    if line == "":
                        yield "\n"
                        continue

                    yield f"{line}\n"
        except requests.RequestException:
            logger.exception("Unable to connect to upstream live weight stream")
            yield 'event: error\ndata: {"error":"Unable to connect to live weight stream."}\n\n'

    response = StreamingHttpResponse(
        stream_events(),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


@require_GET
def admin_live_weight(request):
    live_weight_url = get_indicator_live_weight_url()

    if not live_weight_url:
        return JsonResponse(
            {"error": "Live weight URL is not configured in Indicator Settings."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    try:
        response = requests.get(live_weight_url, timeout=5)
        response.raise_for_status()
        data = parse_indicator_response(response)
        return JsonResponse(data)
    except ValueError as exc:
        logger.exception("Invalid live weight response from upstream")
        return JsonResponse({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except requests.RequestException as exc:
        logger.exception("Unable to fetch live weight from upstream")
        return JsonResponse(
            {"error": f"Unable to fetch live weight: {exc}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(['GET'])
def get_weight(request):
    """API endpoint to get the weight from the indicator."""
    try:
        # Fetch the indicator configuration (ensure only one exists or modify as needed)
        indicator_config = IndicatorConfig.objects.first()
        
        if not indicator_config:
            return Response({'error': 'Indicator configuration not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        # Capture weight
        weight = capture_weight_from_indicator(indicator_config)

        # Check for specific conditions
        if weight is None:
            return Response({'message': 'Weight not detected, trying again...'}, status=status.HTTP_204_NO_CONTENT)
        elif weight == 0:
            return Response({'message': 'Weight is zero, please ensure the load is settled.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response({'weight': weight}, status=status.HTTP_200_OK)

    except serial.SerialException:
        return Response({'error': 'Serial port not available. Please check the connection.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# Capture Weight API
@api_view(['POST'])
def capture_weight_api(request):
    try:
        indicator_config = IndicatorConfig.objects.first()  # Fetch the first indicator config
        if not indicator_config:
            return Response({'success': False, 'message': 'No indicator configuration found.'}, status=status.HTTP_404_NOT_FOUND)

        weight = capture_weight_from_indicator(indicator_config)
        if weight is None:
            return Response({'success': False, 'message': 'Failed to capture weight.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Create or update the transaction
        transaction_id = request.data.get('transaction_id')
        if transaction_id:
            transaction = Transaction.objects.get(pk=transaction_id)
        else:
            transaction = Transaction(
                branch_id=request.data.get('branch_id'),
                customer_id=request.data.get('customer_id'),
                vehicle_id=request.data.get('vehicle_id'),
                item_id=request.data.get('item_id'),
                operator=request.data.get('operator'),
                vehicle_type_id=request.data.get('vehicle_type_id'),
                weight_type=request.data.get('weight_type', 'First Weight'),
            )
            transaction.save()

        # Assign weight and save
        if transaction.weight_type == 'First Weight':
            transaction.gross_weight = weight
            transaction.gross_weight_date = timezone.now()
            transaction.tare_weight = 0
            transaction.net_weight = 0
        elif transaction.weight_type == 'Second Weight':
            try:
                first_weight_transaction = Transaction.objects.filter(
                    customer=transaction.customer,
                    vehicle=transaction.vehicle,
                    weight_type='First Weight',
                    tare_weight=0
                ).latest('gross_weight_date')
                transaction.tare_weight = weight
                transaction.tare_weight_date = timezone.now()
                transaction.gross_weight = first_weight_transaction.gross_weight
                transaction.calculate_net_weight()
                first_weight_transaction.tare_weight = weight
                first_weight_transaction.tare_weight_date = timezone.now()
                first_weight_transaction.calculate_net_weight()
                first_weight_transaction.save()
            except Transaction.DoesNotExist:
                return Response({'success': False, 'message': 'No matching First Weight found.'}, status=status.HTTP_404_NOT_FOUND)

        transaction.save()
        return Response({'success': True, 'message': 'Weight captured successfully.', 'transaction_id': transaction.id}, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# Get Indicator Data API
@api_view(['GET'])
def get_indicator_data_api(request):
    try:
        indicators = _legacy_scope_queryset(request, IndicatorConfig.objects.all(), filter_field="branch__tenant")
        serializer = IndicatorConfigSerializer(indicators, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# Record Transaction API
@api_view(['POST'])
def record_transaction_api(request):
    serializer = TransactionSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response({'success': True, 'message': 'Transaction recorded successfully.'}, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)







from django.http import HttpResponse
from django.conf import settings
import os

def serve_media(request, path):
    file_path = os.path.join(settings.MEDIA_ROOT, path)
    if os.path.exists(file_path):
        with open(file_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type="image/jpeg")
            response['Content-Disposition'] = f'inline; filename="{os.path.basename(file_path)}"'
            return response
    raise Http404("File does not exist")





from django.http import JsonResponse
from .models import Transaction

def get_first_weight_data(request):
    vehicle_id = request.GET.get('vehicle_id')
    if not vehicle_id:
        return JsonResponse({'success': False, 'error': 'No vehicle ID provided.'})

    try:
        transaction = Transaction.objects.filter(
            vehicle_id=vehicle_id,
            weight_type="First Weight",
            paired=False,
            gross_weight__isnull=False,
            status="Completed"
        ).order_by('-gross_weight_date').first()

        if transaction:
            data = {
                'success': True,
                'gross_weight': transaction.gross_weight,
                'gross_weight_date': transaction.gross_weight_date.isoformat(),
                'net_weight': transaction.net_weight,
                # Add more fields as needed
            }
            return JsonResponse(data)
        else:
            return JsonResponse({'success': False, 'error': 'No matching transaction found.'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})









@api_view(['GET'])
def get_transaction_data(request, vehicle_id):
    # Fetch the most recent transaction for the vehicle
    transaction = Transaction.objects.filter(
        vehicle_id=vehicle_id,
        weight_type="First Weight",  
        paired=False,
        gross_weight__isnull=False,
        gross_weight_date__gte=now() - timedelta(days=3)
    ).order_by('-gross_weight_date').first()

    if not transaction:
        return Response({'error': 'No recent transaction found.'}, status=404)

    # Serialize the transaction data
    serializer = TransactionSerializer(transaction)
    return Response(serializer.data)







from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Sum, Q
from django.utils import timezone
from datetime import datetime, timedelta
from django.http import JsonResponse
from django.contrib.auth.models import User
from .models import Transaction, Invoice, Customer, Vehicle, Item
import json

@login_required
def dashboard(request):
    """Main dashboard with role-based reports"""
    user = request.user
    today = timezone.now().date()
    week_ago = today - timedelta(days=7)
    month_ago = today - timedelta(days=30)
    
    # Base statistics
    context = {
        'user': user,
        'today': today,
    }
    
    # Common stats for all users
    context.update({
        'total_transactions': _legacy_scope_queryset(request, Transaction.objects.all()).count(),
        'pending_invoices': Invoice.objects.filter(status='Pending').count(),
        'total_customers': _legacy_scope_queryset(request, Customer.objects.all()).count(),
        'total_vehicles': _legacy_scope_queryset(request, Vehicle.objects.all()).count(),
    })
    
    # Today's stats
    today_transactions = _legacy_scope_queryset(request, Transaction.objects.filter(created_at__date=today))
    context.update({
        'today_transactions': today_transactions.count(),
        'today_revenue': today_transactions.aggregate(Sum('charge'))['charge__sum'] or 0,
        'today_pending': today_transactions.filter(payment_status='Pending').count(),
    })
    
    # Week stats
    week_transactions = _legacy_scope_queryset(request, Transaction.objects.filter(created_at__date__gte=week_ago))
    context.update({
        'week_transactions': week_transactions.count(),
        'week_revenue': week_transactions.aggregate(Sum('charge'))['charge__sum'] or 0,
    })
    
    # Month stats
    month_transactions = _legacy_scope_queryset(request, Transaction.objects.filter(created_at__date__gte=month_ago))
    context.update({
        'month_transactions': month_transactions.count(),
        'month_revenue': month_transactions.aggregate(Sum('charge'))['charge__sum'] or 0,
    })
    
    # Role-specific data
    if user.is_superuser or user.groups.filter(name='Manager').exists():
        # Manager/Admin reports
        context.update(get_manager_reports(today, week_ago, month_ago))
    
    if user.groups.filter(name='Teller').exists() or user.is_staff:
        # Teller reports
        context.update(get_teller_reports(user, today, week_ago, month_ago))
    
    # Recent transactions for all
    context['recent_transactions'] = _legacy_scope_queryset(request, Transaction.objects.select_related(
        'vehicle', 'item'
    )).order_by('-created_at')[:10]
    
    return render(request, 'reports/dashboard.html', context)

def get_manager_reports(today, week_ago, month_ago):
    """Generate manager-specific reports"""
    # Payment method analysis
    payment_methods = Transaction.objects.filter(
        payment_status='Paid'
    ).values('payment_method').annotate(
        count=Count('id'),
        total_amount=Sum('charge')
    ).order_by('-total_amount')
    
    # Top customers by revenue
    top_customers = Customer.objects.annotate(
        total_revenue=Sum('invoice__transactions__charge'),
        transaction_count=Count('invoice__transactions')
    ).filter(total_revenue__gt=0).order_by('-total_revenue')[:10]
    
    # Top items by volume
    top_items = Item.objects.annotate(
        total_weight=Sum('transaction__net_weight'),
        transaction_count=Count('transaction'),
        total_revenue=Sum('transaction__charge')
    ).filter(total_weight__gt=0).order_by('-total_revenue')[:10]
    
    # Vehicle utilization
    vehicle_stats = Vehicle.objects.annotate(
        trip_count=Count('transaction'),
        total_weight=Sum('transaction__net_weight'),
        total_revenue=Sum('transaction__charge')
    ).filter(trip_count__gt=0).order_by('-trip_count')[:10]
    
    # Operator performance
    operator_stats = Transaction.objects.values('operator').annotate(
        transaction_count=Count('id'),
        total_revenue=Sum('charge'),
        avg_weight=Sum('net_weight') / Count('id')
    ).order_by('-transaction_count')[:10]
    
    # Outstanding invoices
    outstanding_invoices = Invoice.objects.filter(
        status='Pending'
    ).select_related('customer').order_by('-issued_date')[:20]
    
    return {
        'payment_methods': payment_methods,
        'top_customers': top_customers,
        'top_items': top_items,
        'vehicle_stats': vehicle_stats,
        'operator_stats': operator_stats,
        'outstanding_invoices': outstanding_invoices,
        'is_manager': True,
    }

def get_teller_reports(user, today, week_ago, month_ago):
    """Generate teller-specific reports"""
    # Filter transactions by operator (assuming username matches operator field)
    user_transactions = Transaction.objects.filter(operator=user.username)
    
    # User performance stats
    user_today = user_transactions.filter(created_at__date=today)
    user_week = user_transactions.filter(created_at__date__gte=week_ago)
    user_month = user_transactions.filter(created_at__date__gte=month_ago)
    
    # Daily performance for the last 7 days
    daily_performance = []
    for i in range(7):
        date = today - timedelta(days=i)
        day_transactions = user_transactions.filter(created_at__date=date)
        daily_performance.append({
            'date': date,
            'count': day_transactions.count(),
            'revenue': day_transactions.aggregate(Sum('charge'))['charge__sum'] or 0
        })
    
    return {
        'user_total_transactions': user_transactions.count(),
        'user_today_transactions': user_today.count(),
        'user_week_transactions': user_week.count(),
        'user_month_transactions': user_month.count(),
        'user_today_revenue': user_today.aggregate(Sum('charge'))['charge__sum'] or 0,
        'user_week_revenue': user_week.aggregate(Sum('charge'))['charge__sum'] or 0,
        'user_month_revenue': user_month.aggregate(Sum('charge'))['charge__sum'] or 0,
        'daily_performance': daily_performance,
        'is_teller': True,
    }

@login_required
def transaction_report(request):
    """Detailed transaction report with filtering"""
    transactions = Transaction.objects.select_related(
        'vehicle', 'item'
    ).order_by('-created_at')
    
    # Apply filters
    if request.GET.get('status'):
        transactions = transactions.filter(payment_status=request.GET.get('status'))
    
    if request.GET.get('operator'):
        transactions = transactions.filter(operator__icontains=request.GET.get('operator'))
    
    if request.GET.get('date_from'):
        date_from = datetime.strptime(request.GET.get('date_from'), '%Y-%m-%d').date()
        transactions = transactions.filter(created_at__date__gte=date_from)
    
    if request.GET.get('date_to'):
        date_to = datetime.strptime(request.GET.get('date_to'), '%Y-%m-%d').date()
        transactions = transactions.filter(created_at__date__lte=date_to)
    
    # Summary statistics
    summary = transactions.aggregate(
        total_count=Count('id'),
        total_revenue=Sum('charge'),
        total_weight=Sum('net_weight'),
        avg_charge=Sum('charge') / Count('id') if transactions.count() > 0 else 0
    )
    
    context = {
        'transactions': transactions[:100],  # Limit to 100 for performance
        'summary': summary,
        'filters': request.GET,
        'operators': Transaction.objects.values_list('operator', flat=True).distinct(),
    }
    
    return render(request, 'reports/transaction_report.html', context)

@login_required
def invoice_report(request):
    """Detailed invoice report with filtering"""
    invoices = Invoice.objects.select_related('customer').prefetch_related(
        'transactions'
    ).order_by('-issued_date')
    
    # Apply filters
    if request.GET.get('status'):
        invoices = invoices.filter(status=request.GET.get('status'))
    
    if request.GET.get('customer'):
        invoices = invoices.filter(customer__name__icontains=request.GET.get('customer'))
    
    if request.GET.get('date_from'):
        date_from = datetime.strptime(request.GET.get('date_from'), '%Y-%m-%d').date()
        invoices = invoices.filter(issued_date__date__gte=date_from)
    
    if request.GET.get('date_to'):
        date_to = datetime.strptime(request.GET.get('date_to'), '%Y-%m-%d').date()
        invoices = invoices.filter(issued_date__date__lte=date_to)
    
    # Summary statistics
    summary = invoices.aggregate(
        total_count=Count('id'),
        total_amount=Sum('total_amount'),
        pending_count=Count('id', filter=Q(status='Pending')),
        paid_count=Count('id', filter=Q(status='Paid')),
    )
    
    context = {
        'invoices': invoices[:100],  # Limit to 100 for performance
        'summary': summary,
        'filters': request.GET,
        'customers': Customer.objects.values_list('name', flat=True).distinct(),
    }
    
    return render(request, 'reports/invoice_report.html', context)

@login_required
def revenue_chart_data(request):
    """API endpoint for revenue chart data"""
    days = int(request.GET.get('days', 30))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)
    
    # Daily revenue data
    daily_data = []
    for i in range(days):
        date = start_date + timedelta(days=i)
        day_revenue = Transaction.objects.filter(
            created_at__date=date,
            payment_status='Paid'
        ).aggregate(Sum('charge'))['charge__sum'] or 0
        
        daily_data.append({
            'date': date.strftime('%Y-%m-%d'),
            'revenue': float(day_revenue)
        })
    
    return JsonResponse({'daily_revenue': daily_data})

@login_required
def user_performance_report(request):
    """User performance report for managers"""
    if not (request.user.is_superuser or request.user.groups.filter(name='Manager').exists()):
        return render(request, 'reports/access_denied.html')
    
    # Get all operators and their performance
    operators = Transaction.objects.values('operator').annotate(
        total_transactions=Count('id'),
        total_revenue=Sum('charge'),
        avg_weight=Sum('net_weight') / Count('id'),
        pending_count=Count('id', filter=Q(payment_status='Pending')),
        paid_count=Count('id', filter=Q(payment_status='Paid')),
    ).order_by('-total_transactions')
    
    # Add efficiency metrics
    for operator in operators:
        if operator['total_transactions'] > 0:
            operator['efficiency'] = (operator['paid_count'] / operator['total_transactions']) * 100
            operator['avg_revenue'] = operator['total_revenue'] / operator['total_transactions']
        else:
            operator['efficiency'] = 0
            operator['avg_revenue'] = 0
    
    context = {
        'operators': operators,
        'title': 'User Performance Report'
    }
    
    return render(request, 'reports/user_performance.html', context)





import os
from django.conf import settings
from django.http import FileResponse
from .models import Transaction
import csv

def generate_transaction_report(request):
    # Define path
    output_dir = os.path.join(settings.MEDIA_ROOT, 'generated_reports')
    os.makedirs(output_dir, exist_ok=True)  # ✅ Ensure directory exists

    report_path = os.path.join(output_dir, 'report_1.csv')

    # Write to file
    with open(report_path, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['ID', 'Customer', 'Gross Weight', 'Date'])

        for tx in Transaction.objects.all()[:100]:
            writer.writerow([tx.id, tx.customer.name, tx.gross_weight, tx.gross_weight_date])

    # Return as download
    return FileResponse(open(report_path, 'rb'), as_attachment=True, filename="transaction_report.csv")




import csv
from django.http import HttpResponse
from .models import Transaction
from django.contrib.admin.views.decorators import staff_member_required

@staff_member_required
def export_transaction_report_csv(request):
    filters = {}

    if request.GET.get('from'):
        filters['created_at__gte'] = request.GET.get('from')
    if request.GET.get('to'):
        filters['created_at__lte'] = request.GET.get('to')
    if request.GET.get('teller'):
        filters['created_by_id'] = request.GET.get('teller')
    if request.GET.get('branch'):
        filters['branch_id'] = request.GET.get('branch')
    if request.GET.get('weight_type'):
        filters['weight_type'] = request.GET.get('weight_type')
    if request.GET.get('status'):
        filters['status'] = request.GET.get('status')
    if request.GET.get('payment_mode'):
        filters['payment_mode'] = request.GET.get('payment_mode')
    if request.GET.get('payment_status'):
        filters['payment_status'] = request.GET.get('payment_status')

    queryset = Transaction.objects.filter(**filters)

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename=transactions.csv'

    writer = csv.writer(response)
    writer.writerow(['ID', 'Customer', 'Vehicle', 'Gross', 'Tare', 'Net', 'Weight Type', 'Charge', 'Operator', 'Date'])

    for t in queryset:
        writer.writerow([
            t.id,
            t.customer.name,
            t.vehicle.plate_number,
            t.gross_weight,
            t.tare_weight,
            t.net_weight,
            t.weight_type,
            t.charge,
            t.operator,
            t.created_at.strftime('%Y-%m-%d %H:%M'),
        ])

    return response





from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import render
from django.utils import timezone
from django.db.models import Sum, Count, Q
from django.db.models.functions import TruncDay
from .models import Transaction, Invoice, VehiclePresence, Report, Branch, Vehicle, Item, Customer
from django.contrib.auth.models import User
import json


@staff_member_required
def report_dashboard(request):
    now = timezone.now()
    transactions = Transaction.objects.all()
    filters = {}

    # 📅 Filters from GET
    date_from = request.GET.get('from')
    date_to = request.GET.get('to')
    teller = request.GET.get('teller')
    branch = request.GET.get('branch')
    item = request.GET.get('item')
    vehicle = request.GET.get('vehicle')
    customer = request.GET.get('customer')
    weight_type = request.GET.get('weight_type')
    status = request.GET.get('status')
    payment_mode = request.GET.get('payment_mode')
    payment_status = request.GET.get('payment_status')

    # 🧪 Apply filters
    if date_from:
        filters['created_at__gte'] = date_from
    if date_to:
        filters['created_at__lte'] = date_to
    if teller:
        filters['created_by_id'] = teller
    if branch:
        filters['branch_id'] = branch
    if item:
        filters['item_id'] = item
    if vehicle:
        filters['vehicle_id'] = vehicle
    if customer:
        filters['customer_id'] = customer
    if weight_type:
        filters['weight_type'] = weight_type
    if status:
        filters['status'] = status
    if payment_mode:
        filters['payment_mode'] = payment_mode
    if payment_status:
        filters['payment_status'] = payment_status

    filtered_transactions = transactions.filter(**filters)

    # 📊 Aggregates
    transaction_stats = filtered_transactions.aggregate(
        total_gross=Sum('gross_weight'),
        total_net=Sum('net_weight'),
        total_transactions=Count('id'),
        total_amount=Sum('charge'),
    )

    invoice_stats = Invoice.objects.filter(transactions__in=filtered_transactions).distinct().aggregate(
        total_invoiced=Sum('total_amount'),
        count=Count('id')
    )

    vehicle_count = VehiclePresence.objects.filter(
        timestamp__gte=date_from, timestamp__lte=date_to
    ).count() if date_from and date_to else None

    shift_data = filtered_transactions.values('created_by__username').annotate(total=Count('id'))

    # 📈 Chart Data
    daily_data = filtered_transactions.annotate(
        day=TruncDay('created_at')
    ).values('day').annotate(
        total=Count('id'),
        amount=Sum('charge')
    ).order_by('day')

    chart_labels = [d['day'].strftime('%Y-%m-%d') for d in daily_data]
    chart_values = [d['total'] for d in daily_data]
    amount_values = [float(d['amount'] or 0) for d in daily_data]

    # ✅ Context to render
    context = {
        'transaction_stats': transaction_stats,
        'invoice_stats': invoice_stats,
        'vehicle_count': vehicle_count,
        'shift_data': shift_data,
        'reports': Report.objects.order_by('-generated_at')[:10],
        'filters': request.GET,
        'tellers': User.objects.all(),
        'branches': Branch.objects.all(),
        'items': Item.objects.all(),
        'vehicles': Vehicle.objects.all(),
        'customers': Customer.objects.all(),

        # Chart.js Data
        'chart_labels': json.dumps(chart_labels),
        'chart_values': json.dumps(chart_values),
        'amount_values': json.dumps(amount_values),
    }

    return render(request, 'admin/reports/dashboard.html', context)




from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.contrib.admin.views.decorators import staff_member_required
from django.http import HttpResponse, JsonResponse, FileResponse
from django.db.models import Sum, Count, Q
from django.db.models.functions import TruncDay
from django.utils import timezone
from .models import Transaction, Invoice, VehiclePresence, Report, Branch, Vehicle, Item, Customer
from django.contrib.auth.models import User
import csv, json

def apply_common_filters(queryset, request):
    if request.GET.get('from'):
        queryset = queryset.filter(created_at__gte=request.GET.get('from'))
    if request.GET.get('to'):
        queryset = queryset.filter(created_at__lte=request.GET.get('to'))
    if request.GET.get('teller'):
        queryset = queryset.filter(created_by_id=request.GET.get('teller'))
    if request.GET.get('branch'):
        queryset = queryset.filter(branch_id=request.GET.get('branch'))
    if request.GET.get('item'):
        queryset = queryset.filter(item_id=request.GET.get('item'))
    if request.GET.get('vehicle'):
        queryset = queryset.filter(vehicle_id=request.GET.get('vehicle'))
    if request.GET.get('customer'):
        queryset = queryset.filter(customer_id=request.GET.get('customer'))
    if request.GET.get('weight_type'):
        queryset = queryset.filter(weight_type=request.GET.get('weight_type'))
    if request.GET.get('status'):
        queryset = queryset.filter(status=request.GET.get('status'))
    if request.GET.get('payment_mode'):
        queryset = queryset.filter(payment_mode=request.GET.get('payment_mode'))
    if request.GET.get('payment_status'):
        queryset = queryset.filter(payment_status=request.GET.get('payment_status'))
    return queryset

@staff_member_required
def report_dashboard(request):
    transactions = Transaction.objects.select_related('vehicle', 'customer', 'item', 'branch', 'created_by')
    transactions = apply_common_filters(transactions, request)

    invoices = Invoice.objects.select_related('customer').prefetch_related('transactions')
    if request.GET.get('from'):
        invoices = invoices.filter(issued_date__gte=request.GET.get('from'))
    if request.GET.get('to'):
        invoices = invoices.filter(issued_date__lte=request.GET.get('to'))

    vehicle_presences = VehiclePresence.objects.select_related('vehicle')
    if request.GET.get('from'):
        vehicle_presences = vehicle_presences.filter(timestamp__gte=request.GET.get('from'))
    if request.GET.get('to'):
        vehicle_presences = vehicle_presences.filter(timestamp__lte=request.GET.get('to'))

    daily_data = transactions.annotate(
        day=TruncDay('created_at')
    ).values('day').annotate(
        total=Count('id'),
        amount=Sum('charge')
    ).order_by('day')

    chart_labels = [d['day'].strftime('%Y-%m-%d') for d in daily_data]
    chart_values = [d['total'] for d in daily_data]
    amount_values = [float(d['amount'] or 0) for d in daily_data]

    pie_data = transactions.values('payment_mode').annotate(total=Count('id'))
    pie_labels = [p['payment_mode'] for p in pie_data]
    pie_values = [p['total'] for p in pie_data]

    context = {
        'transactions': transactions[:100],
        'invoices': invoices[:100],
        'vehicle_presences': vehicle_presences[:100],
        'transaction_stats': transactions.aggregate(Sum('gross_weight'), Sum('net_weight'), Count('id'), Sum('charge')),
        'invoice_stats': invoices.aggregate(Sum('total_amount'), Count('id')),
        'vehicle_count': vehicle_presences.count(),
        'tellers': User.objects.all(),
        'branches': Branch.objects.all(),
        'items': Item.objects.all(),
        'vehicles': Vehicle.objects.all(),
        'customers': Customer.objects.all(),
        'filters': request.GET,
        'chart_labels': json.dumps(chart_labels),
        'chart_values': json.dumps(chart_values),
        'amount_values': json.dumps(amount_values),
        'pie_labels': json.dumps(pie_labels),
        'pie_values': json.dumps(pie_values),
    }

    return render(request, 'admin/reports/dashboard.html', context)

@staff_member_required
def export_transaction_report_csv(request):
    transactions = Transaction.objects.select_related('vehicle', 'customer', 'item', 'branch', 'created_by')
    transactions = apply_common_filters(transactions, request)

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename=transactions.csv'
    writer = csv.writer(response)
    writer.writerow(['ID', 'Customer', 'Vehicle', 'Gross', 'Tare', 'Net', 'Weight Type', 'Charge', 'Operator', 'Date'])

    for t in transactions:
        writer.writerow([
            t.id,
            t.customer.name,
            t.vehicle.number_plate,
            t.gross_weight,
            t.tare_weight,
            t.net_weight,
            t.weight_type,
            t.charge,
            t.operator,
            t.created_at.strftime('%Y-%m-%d %H:%M'),
        ])

    return response

@staff_member_required
def generate_vehicle_presence_report(request):
    date_from = request.GET.get('from')
    date_to = request.GET.get('to')

    if not date_from or not date_to:
        return HttpResponse("Missing 'from' or 'to' date.", status=400)

    presences = VehiclePresence.objects.select_related('vehicle').filter(
        timestamp__date__gte=date_from,
        timestamp__date__lte=date_to
    )

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename=vehicle_presence_report.csv'
    writer = csv.writer(response)
    writer.writerow(['ID', 'Vehicle Plate', 'Timestamp'])

    for vp in presences:
        writer.writerow([
            vp.id,
            getattr(vp.vehicle, 'number_plate', 'N/A'),
            vp.timestamp.strftime('%Y-%m-%d %H:%M:%S')
        ])

    return response

@staff_member_required
def generate_invoice_report(request):
    invoices = Invoice.objects.select_related('customer').prefetch_related('transactions')
    if request.GET.get('from'):
        invoices = invoices.filter(issued_date__gte=request.GET.get('from'))
    if request.GET.get('to'):
        invoices = invoices.filter(issued_date__lte=request.GET.get('to'))
    if request.GET.get('customer'):
        invoices = invoices.filter(customer_id=request.GET.get('customer'))

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename=invoices.csv'
    writer = csv.writer(response)
    writer.writerow(['ID', 'Customer', 'Total Amount', 'Issued Date', 'Status'])

    for inv in invoices:
        writer.writerow([
            inv.id,
            inv.customer.name,
            inv.total_amount,
            inv.issued_date.strftime('%Y-%m-%d'),
            inv.status
        ])

    return response

@staff_member_required
def generate_discrepancy_report(request):
    transactions = Transaction.objects.select_related('vehicle', 'customer').filter(
        Q(gross_weight__gt=0) & Q(tare_weight__gt=0) & Q(net_weight=0)
    )
    transactions = apply_common_filters(transactions, request)

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename=discrepancy_report.csv'
    writer = csv.writer(response)
    writer.writerow(['ID', 'Vehicle', 'Customer', 'Gross', 'Tare', 'Net', 'Date'])

    for t in transactions:
        writer.writerow([
            t.id,
            getattr(t.vehicle, 'number_plate', 'N/A'),
            t.customer.name,
            t.gross_weight,
            t.tare_weight,
            t.net_weight,
            t.created_at.strftime('%Y-%m-%d %H:%M'),
        ])

    return response
# views.py
from django.views.generic import TemplateView
from unfold.views import UnfoldModelAdminViewMixin

class LiveDashboardView(UnfoldModelAdminViewMixin, TemplateView):
    title = "📡 Live Dashboard"
    permission_required = ("SL_Weighbridge.view_transaction",)
    template_name = "admin/custom/live_dashboard.html"



from django.template.loader import render_to_string
from django.http import HttpResponse
from .models import Transaction

try:
    from weasyprint import HTML
except ImportError:
    HTML = None

import datetime

def export_transaction_report_pdf(request):
    if HTML is None:
        return HttpResponse(
            "PDF generation is unavailable because WeasyPrint is not installed on this server.",
            status=503,
        )

    transactions = Transaction.objects.all().order_by('-weight_date')  # ✅ use a valid date field like 'weight_date'

    # Optional: Filter by date range from GET params
    from_date = request.GET.get('from')
    to_date = request.GET.get('to')
    if from_date and to_date:
        try:
            from_date_obj = datetime.datetime.strptime(from_date, '%Y-%m-%d').date()
            to_date_obj = datetime.datetime.strptime(to_date, '%Y-%m-%d').date()
            transactions = transactions.filter(weight_date__range=(from_date_obj, to_date_obj))  # ✅ replace 'date__range'
        except ValueError:
            pass  # Optionally handle error

    # Render HTML
    html_string = render_to_string('SL_Weighbridge/transactions_pdf_template.html', {
        'transactions': transactions,
        'from_date': from_date,
        'to_date': to_date
    })
    print(html_string)


    try:
        # ✅ Create HTML object correctly
        html = HTML(string=html_string, base_url=request.build_absolute_uri('/'))
        pdf = html.write_pdf()

        # Return PDF as response
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = 'inline; filename="transaction_report.pdf"'
        return response

    except Exception as e:
        return HttpResponse(f"Error generating PDF: {e}", status=500)
