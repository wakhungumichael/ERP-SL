from django.urls import path
from . import views

urlpatterns = [
    # Products & Services
    path("products/",         views.ProductListCreateView.as_view(),  name="sales-product-list"),
    path("products/<int:pk>/",views.ProductDetailView.as_view(),      name="sales-product-detail"),

    # Estimates
    path("estimates/",                          views.EstimateListCreateView.as_view(),  name="estimate-list"),
    path("estimates/<int:pk>/",                 views.EstimateDetailView.as_view(),      name="estimate-detail"),
    path("estimates/<int:pk>/convert/",         views.EstimateConvertView.as_view(),     name="estimate-convert"),

    # Recurring invoices
    path("recurring-invoices/",           views.RecurringInvoiceListCreateView.as_view(), name="recurring-invoice-list"),
    path("recurring-invoices/<int:pk>/",  views.RecurringInvoiceDetailView.as_view(),     name="recurring-invoice-detail"),

    # Customer statements (per-customer invoice/payment summary)
    path("customer-statements/<int:customer_id>/", views.CustomerStatementView.as_view(), name="customer-statement"),

    # Customers proxy (for dropdowns)
    path("customers/", views.SalesCustomerListView.as_view(), name="sales-customers"),
]
