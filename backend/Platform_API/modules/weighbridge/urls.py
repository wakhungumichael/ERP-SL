from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/",                              views.WeighbridgeDashboardView.as_view(),        name="wb-dashboard"),
    path("transactions/",                           views.TransactionListCreateView.as_view(),       name="wb-transactions"),
    path("transactions/export/csv/",               views.TransactionExportCSVView.as_view(),        name="wb-transactions-export-csv"),
    path("transactions/workflow-context/",          views.WorkflowContextView.as_view(),             name="wb-workflow-context"),
    path("transactions/capture-weight/",            views.CaptureWeightView.as_view(),               name="wb-capture-weight"),
    path("transactions/<int:pk>/",                  views.TransactionDetailView.as_view(),           name="wb-transaction-detail"),
    path("transactions/<int:pk>/approve/",          views.TransactionApproveView.as_view(),          name="wb-transaction-approve"),
    path("transactions/<int:pk>/recall/",           views.TransactionRecallView.as_view(),           name="wb-transaction-recall"),
    path("transactions/<int:pk>/email-receipt/",   views.TransactionEmailReceiptView.as_view(),     name="wb-transaction-email-receipt"),
    path("transactions/<int:pk>/receive-payment/", views.TransactionReceivePaymentView.as_view(),   name="wb-transaction-receive-payment"),
    path("branches/",                               views.BranchListView.as_view(),                            name="wb-branches"),
    path("vehicle-types/",                          views.VehicleTypeListView.as_view(),                       name="wb-vehicle-types"),
    path("vehicle-types/<int:pk>/",                 views.VehicleTypeCreateUpdateDeleteView.as_view(),         name="wb-vehicle-type-detail"),
    path("items/",                                  views.ItemListCreateView.as_view(),                        name="wb-items"),
    path("items/<int:pk>/",                         views.ItemDetailView.as_view(),                            name="wb-item-detail"),
    path("indicator-configs/",                      views.IndicatorConfigListCreateView.as_view(),             name="wb-indicator-configs"),
    path("indicator-configs/<int:pk>/",             views.IndicatorConfigDetailView.as_view(),                 name="wb-indicator-config-detail"),
    path("discounts/",                              views.CustomerVehicleTypeDiscountListCreateView.as_view(), name="wb-discounts"),
    path("discounts/<int:pk>/",                     views.CustomerVehicleTypeDiscountDetailView.as_view(),     name="wb-discount-detail"),
    path("customers/",                              views.CustomerListCreateView.as_view(),      name="wb-customers"),
    path("customers/<int:pk>/",                     views.CustomerDetailView.as_view(),          name="wb-customer-detail"),
    path("vehicles/",                               views.VehicleListCreateView.as_view(),       name="wb-vehicles"),
    path("vehicles/<int:pk>/",                      views.VehicleDetailView.as_view(),           name="wb-vehicle-detail"),
    path("live-weight/",                            views.LiveWeightView.as_view(),              name="wb-live-weight"),
]
