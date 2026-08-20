from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/",             views.ProcurementDashboardView.as_view(),    name="procurement-dashboard"),
    path("approval-matrix/",       views.ApprovalMatrixListCreateView.as_view(), name="procurement-approval-matrix"),
    path("approval-matrix/<int:pk>/", views.ApprovalMatrixDetailView.as_view(), name="procurement-approval-matrix-detail"),
    path("approval-groups/",       views.ApprovalGroupListView.as_view(), name="procurement-approval-groups"),
    path("receipts/",              views.GoodsReceiptListCreateView.as_view(), name="procurement-receipts"),
    path("receipts/<int:pk>/",     views.GoodsReceiptDetailView.as_view(), name="procurement-receipt-detail"),
    path("requisitions/",          views.RequisitionListCreateView.as_view(),   name="procurement-requisitions"),
    path("requisitions/<int:pk>/", views.RequisitionDetailView.as_view(),       name="procurement-requisition-detail"),
    path("requisitions/<int:pk>/status/", views.RequisitionStatusView.as_view(), name="procurement-requisition-status"),
    path("requisitions/<int:pk>/approval-action/", views.RequisitionApprovalActionView.as_view(), name="procurement-requisition-approval-action"),
    path("requisitions/<int:pk>/convert-to-order/", views.RequisitionConvertToPOView.as_view(), name="procurement-requisition-convert"),
    path("orders/",                views.PurchaseOrderListCreateView.as_view(), name="procurement-orders"),
    path("orders/<int:pk>/",       views.PurchaseOrderDetailView.as_view(),     name="procurement-order-detail"),
    path("orders/<int:pk>/document/", views.PurchaseOrderDocumentView.as_view(), name="procurement-order-document"),
    path("orders/<int:pk>/status/",views.PurchaseOrderStatusView.as_view(),     name="procurement-order-status"),
]
