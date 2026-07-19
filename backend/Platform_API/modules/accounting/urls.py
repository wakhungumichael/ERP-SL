from django.urls import path
from . import views

urlpatterns = [
    # Dashboard (existing)
    path("dashboard/", views.AccountingDashboardView.as_view(), name="accounting-dashboard"),

    # Ledger stub (backward compat)
    path("ledger/", views.AccountingLedgerView.as_view(), name="accounting-ledger"),

    # Chart of Accounts
    path("chart-of-accounts/",          views.ChartOfAccountsView.as_view(), name="chart-of-accounts"),
    path("chart-of-accounts/<int:pk>/", views.AccountDetailView.as_view(),   name="account-detail"),

    # Journal Entries (Transactions)
    path("transactions/",           views.JournalEntryListCreateView.as_view(), name="journal-entries"),
    path("transactions/<int:pk>/",  views.JournalEntryDetailView.as_view(),     name="journal-entry-detail"),

    # Journals (for dropdowns)
    path("journals/", views.JournalListView.as_view(), name="journals"),
]
