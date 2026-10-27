# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.urls import path
from . import views, workforce

urlpatterns = [
    path('settings/', workforce.HRSettingsView.as_view(), name='hr-settings'),
    path('employees/', workforce.EmployeeListView.as_view(), name='hr-employees'),
    path('employees/<int:pk>/', workforce.EmployeeDetailView.as_view(), name='hr-employee'),
    path('employees/<int:pk>/documents/', workforce.EmployeeDocumentsView.as_view(), name='hr-employee-documents'),
    path('employees/<int:pk>/documents/<int:document_id>/', workforce.EmployeeDocumentView.as_view(), name='hr-employee-document'),
    path('leave/', workforce.LeaveListView.as_view(), name='hr-leave'),
    path('leave/<int:pk>/action/', workforce.LeaveActionView.as_view(), name='hr-leave-action'),
    path('leave/allocations/', workforce.LeaveAllocationView.as_view(), name='hr-leave-allocation'),
    path('requests/', workforce.EmployeeServiceView.as_view(), name='hr-requests'),
    path('requests/<int:pk>/', workforce.EmployeeServiceDetailView.as_view(), name='hr-request'),
    path('my-payslips/', workforce.MyPayslipsView.as_view(), name='hr-my-payslips'),
    path("dashboard/",                                    views.HRDashboardView.as_view(),         name="hr-dashboard"),
    path("pay-periods/",                                  views.PayPeriodListCreateView.as_view(),  name="hr-pay-periods"),
    path("pay-periods/<int:pk>/",                         views.PayPeriodDetailView.as_view(),      name="hr-pay-period-detail"),
    path("pay-periods/<int:period_pk>/records/",          views.PayRecordListCreateView.as_view(),  name="hr-pay-records"),
    path("pay-periods/<int:period_pk>/records/<int:pk>/", views.PayRecordDetailView.as_view(),      name="hr-pay-record-detail"),
]
