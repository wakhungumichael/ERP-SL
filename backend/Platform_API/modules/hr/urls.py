from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/",                                    views.HRDashboardView.as_view(),         name="hr-dashboard"),
    path("pay-periods/",                                  views.PayPeriodListCreateView.as_view(),  name="hr-pay-periods"),
    path("pay-periods/<int:pk>/",                         views.PayPeriodDetailView.as_view(),      name="hr-pay-period-detail"),
    path("pay-periods/<int:period_pk>/records/",          views.PayRecordListCreateView.as_view(),  name="hr-pay-records"),
    path("pay-periods/<int:period_pk>/records/<int:pk>/", views.PayRecordDetailView.as_view(),      name="hr-pay-record-detail"),
]
