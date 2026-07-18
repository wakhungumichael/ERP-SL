from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/", views.AccountingDashboardView.as_view(), name="accounting-dashboard"),
    path("ledger/",    views.AccountingLedgerView.as_view(),    name="accounting-ledger"),
]
