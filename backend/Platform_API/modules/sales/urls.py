from django.urls import path
from . import views

urlpatterns = [
    # Products & Services
    path("products/",         views.ProductListCreateView.as_view(),  name="sales-product-list"),
    path("products/<int:pk>/",views.ProductDetailView.as_view(),      name="sales-product-detail"),

    # Estimates
    path("estimates/",                          views.EstimateListCreateView.as_view(),  name="estimate-list"),
    path("estimates/<int:pk>/",                 views.EstimateDetailView.as_view(),      name="estimate-detail"),
    path("estimates/<int:pk>/document/",        views.EstimateDocumentView.as_view(),    name="estimate-document"),
    path("estimates/<int:pk>/email/",           views.EstimateEmailView.as_view(),       name="estimate-email"),
    path("estimates/<int:pk>/convert/",         views.EstimateConvertView.as_view(),     name="estimate-convert"),
    path("estimates/<int:pk>/convert-to-order/", views.EstimateConvertToSalesOrderView.as_view(), name="estimate-convert-to-order"),

    # Sales orders
    path("sales-orders/",                        views.SalesOrderListCreateView.as_view(),   name="sales-order-list"),
    path("sales-orders/<int:pk>/",               views.SalesOrderDetailView.as_view(),       name="sales-order-detail"),
    path("sales-orders/<int:pk>/convert/",       views.SalesOrderConvertToInvoiceView.as_view(), name="sales-order-convert"),

    # Recurring invoices
    path("recurring-invoices/",           views.RecurringInvoiceListCreateView.as_view(), name="recurring-invoice-list"),
    path("recurring-invoices/<int:pk>/",  views.RecurringInvoiceDetailView.as_view(),     name="recurring-invoice-detail"),

    # Aging report
    path("aging/", views.AgingReportView.as_view(), name="sales-aging"),

    # Customer statements (per-customer invoice/payment summary)
    path("customer-statements/<int:customer_id>/", views.CustomerStatementView.as_view(), name="customer-statement"),
    path("customer-statements/<int:customer_id>/document/", views.CustomerStatementDocumentView.as_view(), name="customer-statement-document"),

    # Customers proxy (for dropdowns)
    path("customers/", views.SalesCustomerListView.as_view(), name="sales-customers"),
    path("customers/<int:pk>/", views.SalesCustomerDetailView.as_view(), name="sales-customer-detail"),
]
