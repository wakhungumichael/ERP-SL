from django.contrib import admin

from .models import Budget, BudgetCheckLog, BudgetCommitment, BudgetLine


class BudgetLineInline(admin.TabularInline):
    model = BudgetLine
    extra = 0
    fields = [
        "account",
        "cost_center",
        "project_code",
        "period_year",
        "period_month",
        "allocated_amount",
        "committed_amount",
        "obligated_amount",
        "actual_amount",
    ]


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "tenant", "period_type", "control_mode", "status", "start_date", "end_date"]
    list_filter = ["status", "control_mode", "period_type", "tenant"]
    search_fields = ["code", "name", "tenant__name"]
    inlines = [BudgetLineInline]


@admin.register(BudgetCommitment)
class BudgetCommitmentAdmin(admin.ModelAdmin):
    list_display = ["tenant", "budget_line", "source_type", "source_reference", "state", "amount", "created_at"]
    list_filter = ["tenant", "source_type", "state"]
    search_fields = ["source_reference", "budget_line__budget__code", "budget_line__account__code"]


@admin.register(BudgetCheckLog)
class BudgetCheckLogAdmin(admin.ModelAdmin):
    list_display = ["tenant", "budget_line", "requisition_reference", "amount", "result", "created_at"]
    list_filter = ["tenant", "result"]
    search_fields = ["requisition_reference", "message"]

