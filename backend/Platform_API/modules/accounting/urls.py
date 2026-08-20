from django.urls import path
from . import views

urlpatterns = [
    # Dashboard (existing)
    path("dashboard/", views.AccountingDashboardView.as_view(), name="accounting-dashboard"),
    path("overview/", views.FinanceOverviewView.as_view(), name="accounting-overview"),
    path("reports/trial-balance/", views.TrialBalanceReportView.as_view(), name="accounting-trial-balance"),
    path("reports/income-statement/", views.IncomeStatementReportView.as_view(), name="accounting-income-statement"),
    path("reports/income-statement/comparative/", views.ComparativeIncomeStatementReportView.as_view(), name="accounting-income-statement-comparative"),
    path("reports/balance-sheet/", views.BalanceSheetReportView.as_view(), name="accounting-balance-sheet"),
    path("reports/balance-sheet/comparative/", views.ComparativeBalanceSheetReportView.as_view(), name="accounting-balance-sheet-comparative"),
    path("reports/general-ledger/", views.GeneralLedgerReportView.as_view(), name="accounting-general-ledger"),
    path("reports/retained-earnings-rollforward/", views.RetainedEarningsRollforwardReportView.as_view(), name="accounting-retained-earnings-rollforward"),
    path("financial-years/", views.FinancialYearListCreateView.as_view(), name="accounting-financial-years"),
    path("financial-years/<int:pk>/", views.FinancialYearDetailView.as_view(), name="accounting-financial-year-detail"),
    path("financial-years/<int:pk>/generate-periods/", views.FinancialYearGeneratePeriodsView.as_view(), name="accounting-financial-year-generate-periods"),
    path("periods/", views.AccountingPeriodListCreateView.as_view(), name="accounting-periods"),
    path("periods/<int:pk>/", views.AccountingPeriodDetailView.as_view(), name="accounting-period-detail"),
    path("periods/<int:pk>/open/", views.AccountingPeriodOpenView.as_view(), name="accounting-period-open"),
    path("periods/<int:pk>/close/", views.AccountingPeriodCloseView.as_view(), name="accounting-period-close"),
    path("periods/<int:pk>/lock/", views.AccountingPeriodLockView.as_view(), name="accounting-period-lock"),
    path("period-audit-log/", views.AccountingPeriodAuditLogListView.as_view(), name="accounting-period-audit-log"),
    path("period-close/preview/", views.PeriodClosePreviewView.as_view(), name="accounting-period-close-preview"),
    path("period-close/close/", views.PeriodCloseExecuteView.as_view(), name="accounting-period-close-close"),
    path("reconciliation/sessions/", views.BankReconciliationSessionListCreateView.as_view(), name="accounting-reconciliation-sessions"),
    path("reconciliation/sessions/<int:pk>/", views.BankReconciliationSessionDetailView.as_view(), name="accounting-reconciliation-session-detail"),
    path("reconciliation/sessions/<int:session_pk>/lines/", views.BankReconciliationLineListCreateView.as_view(), name="accounting-reconciliation-lines"),
    path("reconciliation/lines/<int:pk>/", views.BankReconciliationLineDetailView.as_view(), name="accounting-reconciliation-line-detail"),
    path("reconciliation/lines/<int:pk>/candidates/", views.BankReconciliationLineCandidatesView.as_view(), name="accounting-reconciliation-line-candidates"),
    path("reconciliation/lines/<int:pk>/match/", views.BankReconciliationLineMatchView.as_view(), name="accounting-reconciliation-line-match"),
    path("reconciliation/lines/<int:pk>/unmatch/", views.BankReconciliationLineUnmatchView.as_view(), name="accounting-reconciliation-line-unmatch"),

    # Ledger stub (backward compat)
    path("ledger/", views.AccountingLedgerView.as_view(), name="accounting-ledger"),

    # Chart of Accounts
    path("chart-of-accounts/",          views.ChartOfAccountsView.as_view(), name="chart-of-accounts"),
    path("chart-of-accounts/<int:pk>/", views.AccountDetailView.as_view(),   name="account-detail"),
    path("chart-of-accounts/<int:pk>/activity/", views.AccountActivityView.as_view(), name="account-activity"),
    path("posting-rules/",              views.AccountingPostingRuleListCreateView.as_view(), name="accounting-posting-rules"),
    path("posting-rules/<int:pk>/",     views.AccountingPostingRuleDetailView.as_view(), name="accounting-posting-rule-detail"),
    path("setup/bootstrap/",            views.AccountingSetupBootstrapView.as_view(), name="accounting-setup-bootstrap"),
    path("resync/",                     views.AccountingResyncView.as_view(), name="accounting-resync"),

    # Journal Entries (Transactions)
    path("transactions/",           views.JournalEntryListCreateView.as_view(), name="journal-entries"),
    path("transactions/<int:pk>/",  views.JournalEntryDetailView.as_view(),     name="journal-entry-detail"),
    path("transactions/<int:pk>/post/", views.JournalEntryPostView.as_view(),   name="journal-entry-post"),
    path("transactions/<int:pk>/reverse/", views.JournalEntryReverseView.as_view(), name="journal-entry-reverse"),

    # Journals (for dropdowns)
    path("journals/", views.JournalListView.as_view(), name="journals"),
]
