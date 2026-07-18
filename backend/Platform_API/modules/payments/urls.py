from django.urls import path
from . import views

urlpatterns = [
    # Invoice CRUD + manual creation
    path("invoices/",                              views.InvoiceListView.as_view(),              name="invoice-list"),
    path("invoices/generate/",                     views.GenerateInvoiceView.as_view(),           name="invoice-generate"),
    path("invoices/<int:pk>/",                     views.InvoiceDetailView.as_view(),             name="invoice-detail"),
    path("invoices/<int:pk>/issue/",               views.IssueInvoiceView.as_view(),              name="invoice-issue"),
    path("invoices/<int:pk>/receive-payment/",     views.ReceivePaymentView.as_view(),            name="invoice-receive-payment"),
    path("invoices/<int:pk>/confirm/",             views.ConfirmPaymentView.as_view(),            name="invoice-confirm"),

    # Debt consolidation
    path("debt/",                                  views.DebtSummaryView.as_view(),               name="debt-summary"),
    path("debt/consolidate/",                      views.DebtConsolidateView.as_view(),           name="debt-consolidate"),


    # Supporting data
    path("uninvoiced-transactions/",               views.UninvoicedTransactionsView.as_view(),   name="uninvoiced-transactions"),
    path("customers/",                             views.CustomerListForInvoiceView.as_view(),    name="invoice-customers"),
    path("methods/",                               views.PaymentMethodListView.as_view(),         name="payment-method-list"),
    path("entries/",                               views.PaymentEntriesView.as_view(),            name="payment-entries"),
    path("provider-capabilities/",                 views.ProviderCapabilitiesView.as_view(),      name="payment-provider-capabilities"),
    path("summary/",                               views.PaymentSummaryView.as_view(),            name="payment-summary"),
]
