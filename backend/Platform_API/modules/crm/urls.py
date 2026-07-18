from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    OrganisationViewSet,
    ContactViewSet,
    SupplierViewSet,
    LeadViewSet,
    ActivityViewSet,
    CRMDashboardView,
)

router = DefaultRouter()
router.register(r"companies",     OrganisationViewSet, basename="organisation")
router.register(r"people",        ContactViewSet,      basename="contact")
router.register(r"suppliers",     SupplierViewSet,     basename="supplier")
router.register(r"opportunities", LeadViewSet,         basename="lead")
router.register(r"follow-ups",    ActivityViewSet,     basename="activity")

urlpatterns = [
    path("dashboard/", CRMDashboardView.as_view(), name="crm-dashboard"),
    path("",            include(router.urls)),
]
