from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/",             views.ProcurementDashboardView.as_view(),    name="procurement-dashboard"),
    path("orders/",                views.PurchaseOrderListCreateView.as_view(), name="procurement-orders"),
    path("orders/<int:pk>/",       views.PurchaseOrderDetailView.as_view(),     name="procurement-order-detail"),
    path("orders/<int:pk>/status/",views.PurchaseOrderStatusView.as_view(),     name="procurement-order-status"),
]
