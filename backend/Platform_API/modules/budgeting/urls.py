from django.urls import path

from . import views


urlpatterns = [
    path("dashboard/", views.BudgetDashboardView.as_view(), name="budgeting-dashboard"),
    path("budgets/", views.BudgetListCreateView.as_view(), name="budget-list"),
    path("budgets/<int:pk>/", views.BudgetDetailView.as_view(), name="budget-detail"),
]

