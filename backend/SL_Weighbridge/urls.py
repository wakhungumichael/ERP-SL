from django.urls import path
from . import views  
from .views import get_weight
from .views import serve_media  
from .admin import TransactionAdmin
from .views import get_transaction_data
from .views import TransactionListAPI
from .views import RecentTransactionAPIView
from .views import generate_transaction_report
from .views import export_transaction_report_csv

from .views import generate_invoice_report  # ✅ Import this at the top

from .views import generate_vehicle_presence_report
from .views import generate_discrepancy_report
from .views import report_dashboard

# urls.py
from django.urls import path
from .views import LiveDashboardView
from django.urls import path
from .views import export_transaction_report_pdf



urlpatterns = [
    path('api/capture-weight/', views.capture_weight_api, name='capture_weight_api'),
    path('api/get-indicator-data/', views.get_indicator_data_api, name='get_indicator_data'),
    path('api/record-transaction/', views.record_transaction_api, name='record_transaction_api'),
    path('api/get_weight/', get_weight, name='get_weight'),
    path('admin/live-weight/', views.admin_live_weight, name='admin_live_weight'),
    path('admin/live-weight-stream/', views.admin_live_weight_stream, name='admin_live_weight_stream'),
    path('media/<path:path>/', serve_media, name='serve_media'),
    path('api/transaction-data/<int:vehicle_id>/', get_transaction_data, name='transaction-data'),

    path('api/transactions/', TransactionListAPI.as_view(), name='transaction-list-api'),

    path('api/transactions/recent/', RecentTransactionAPIView.as_view(), name='recent_transaction'),

    path('admin/transactions/get_first_weight_data/', views.get_first_weight_data, name='get_first_weight_data'),

    path("admin/reports/generate-transaction/", generate_transaction_report, name="generate_transaction_report"),
    path('admin/reports/export-csv/', export_transaction_report_csv, name='export_transaction_report_csv'),

    path('admin/reports/generate-invoice/', generate_invoice_report, name='generate_invoice_report'),

    path('admin/reports/generate-vehicle-presence/', generate_vehicle_presence_report, name='generate_vehicle_presence_report'),

    path('admin/reports/generate-discrepancy/', generate_discrepancy_report, name='generate_discrepancy_report'),
    path('admin/reports/dashboard/', report_dashboard, name='report_dashboard'),
    path("admin/live-dashboard/", LiveDashboardView.as_view(), name="admin_live_dashboard"),

    path("admin/live-dashboard/", LiveDashboardView.as_view(), name="admin-live-dashboard"),

    # ... other routes
    path("export/transactions/pdf/", export_transaction_report_pdf, name="export_transaction_report_pdf"),

    
]




