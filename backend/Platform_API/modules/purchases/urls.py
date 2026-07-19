from django.urls import path
from . import views

urlpatterns = [
    # Bills (vendor invoices)
    path("bills/",              views.BillListCreateView.as_view(),  name="bill-list"),
    path("bills/<int:pk>/",     views.BillDetailView.as_view(),      name="bill-detail"),

    # Vendors proxy (from CRM Suppliers)
    path("vendors/",            views.VendorListView.as_view(),      name="purchase-vendors"),

    # Products & Services (same catalog as sales)
    path("products/",           views.PurchaseProductListView.as_view(), name="purchase-products"),
]
