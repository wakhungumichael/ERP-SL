from django.urls import path
from . import views

urlpatterns = [
    # Bills (vendor invoices)
    path("bills/",              views.BillListCreateView.as_view(),  name="bill-list"),
    path("bills/<int:pk>/",     views.BillDetailView.as_view(),      name="bill-detail"),
    path("bills/<int:pk>/three-way-match/", views.BillThreeWayMatchView.as_view(), name="bill-three-way-match"),
    path("bills/<int:pk>/prepare-payment/", views.PaymentQueuePrepareView.as_view(), name="bill-prepare-payment"),
    path("payment-queue/",      views.PaymentQueueListView.as_view(), name="payment-queue-list"),

    # Vendors proxy (from CRM Suppliers)
    path("vendors/",            views.VendorListView.as_view(),      name="purchase-vendors"),

    # Products & Services (same catalog as sales)
    path("products/",           views.PurchaseProductListView.as_view(), name="purchase-products"),
]
