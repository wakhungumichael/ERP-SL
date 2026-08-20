from django.urls import path

from . import views


urlpatterns = [
    path("dashboard/", views.InventoryDashboardView.as_view(), name="inventory-dashboard"),
    path("warehouses/", views.WarehouseListCreateView.as_view(), name="inventory-warehouse-list"),
    path("warehouses/<int:pk>/", views.WarehouseDetailView.as_view(), name="inventory-warehouse-detail"),
    path("balances/", views.InventoryBalanceListView.as_view(), name="inventory-balance-list"),
    path("movements/", views.InventoryMovementListView.as_view(), name="inventory-movement-list"),
    path("reservations/", views.InventoryReservationListView.as_view(), name="inventory-reservation-list"),
]

