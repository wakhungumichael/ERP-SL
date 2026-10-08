from decimal import Decimal

from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS as _NO_TENANT_ACCESS,
    apply_tenant_filter as _apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403 as _tenant_or_403,
)
from SL_Budgeting.models import Budget, BudgetCheckLog, BudgetCommitment, BudgetLine


def _apply_budget_line_tenant_filter(qs, user):
    resolved = _resolve_user_tenant(user)
    if resolved is None:
        return qs
    if resolved is _NO_TENANT_ACCESS:
        return qs.none()
    return qs.filter(budget__tenant=resolved)


def _validate_tenant_owned_relation(*, tenant, obj, label):
    if obj is None or tenant is None:
        return None
    if getattr(obj, "tenant_id", None) != tenant.id:
        return f"{label} belongs to a different tenant."
    return None


def _validate_budget_payload(*, tenant, branch=None, financial_year=None, lines=None):
    errors = {}
    branch_error = _validate_tenant_owned_relation(tenant=tenant, obj=branch, label="Branch")
    if branch_error:
        errors["branch"] = branch_error
    year_error = _validate_tenant_owned_relation(tenant=tenant, obj=financial_year, label="Financial year")
    if year_error:
        errors["financial_year"] = year_error
    for index, line in enumerate(lines or []):
        account = line.get("account")
        account_error = _validate_tenant_owned_relation(
            tenant=tenant,
            obj=account,
            label="Budget line account",
        )
        if account_error:
            errors[f"lines[{index}].account"] = account_error
    return errors


class BudgetLineSerializer(serializers.ModelSerializer):
    available_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    account_code = serializers.CharField(source="account.code", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)

    class Meta:
        model = BudgetLine
        fields = [
            "id",
            "account",
            "account_code",
            "account_name",
            "cost_center",
            "project_code",
            "period_year",
            "period_month",
            "allocated_amount",
            "committed_amount",
            "obligated_amount",
            "actual_amount",
            "available_amount",
            "notes",
            "metadata",
        ]
        read_only_fields = ["id", "available_amount"]


class BudgetSerializer(serializers.ModelSerializer):
    lines = BudgetLineSerializer(many=True, read_only=True)

    class Meta:
        model = Budget
        fields = [
            "id",
            "tenant",
            "branch",
            "financial_year",
            "name",
            "code",
            "period_type",
            "status",
            "control_mode",
            "start_date",
            "end_date",
            "currency",
            "description",
            "metadata",
            "lines",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tenant", "created_at", "updated_at"]


class BudgetWriteSerializer(serializers.ModelSerializer):
    lines = BudgetLineSerializer(many=True, required=False)

    class Meta:
        model = Budget
        fields = [
            "branch",
            "financial_year",
            "name",
            "code",
            "period_type",
            "status",
            "control_mode",
            "start_date",
            "end_date",
            "currency",
            "description",
            "metadata",
            "lines",
        ]

    def _sync_lines(self, budget, lines_data):
        budget.lines.all().delete()
        for line_data in lines_data:
            BudgetLine.objects.create(budget=budget, **line_data)

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        budget = Budget.objects.create(**validated_data)
        self._sync_lines(budget, lines_data)
        return budget

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


class BudgetDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from Platform_API.modules.mixins import require_workspace_permission

        require_workspace_permission(request.user, "can_view_budgeting_overview")
        budgets = _apply_tenant_filter(Budget.objects.all(), request.user)
        lines = _apply_budget_line_tenant_filter(BudgetLine.objects.select_related("budget"), request.user)
        commitments = _apply_tenant_filter(BudgetCommitment.objects.all(), request.user)
        checks = _apply_tenant_filter(BudgetCheckLog.objects.all(), request.user)

        allocated_total = sum((line.allocated_amount for line in lines), Decimal("0.00"))
        committed_total = sum((line.committed_amount for line in lines), Decimal("0.00"))
        obligated_total = sum((line.obligated_amount for line in lines), Decimal("0.00"))
        actual_total = sum((line.actual_amount for line in lines), Decimal("0.00"))

        return Response(
            {
                "counts": {
                    "budgets": budgets.count(),
                    "active_budgets": budgets.filter(status="active").count(),
                    "lines": lines.count(),
                    "commitments": commitments.count(),
                    "checks": checks.count(),
                },
                "totals": {
                    "allocated": allocated_total,
                    "committed": committed_total,
                    "obligated": obligated_total,
                    "actual": actual_total,
                    "available": allocated_total - (committed_total + obligated_total + actual_total),
                },
            }
        )


class BudgetListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(Budget.objects.prefetch_related("lines"), request.user).order_by("-created_at")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if q := request.query_params.get("search"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q))
        return Response(BudgetSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_403(request.user)
        serializer = BudgetWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        relation_errors = _validate_budget_payload(
            tenant=tenant,
            branch=serializer.validated_data.get("branch"),
            financial_year=serializer.validated_data.get("financial_year"),
            lines=serializer.validated_data.get("lines"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        budget = serializer.save(tenant=tenant, created_by=request.user)
        return Response(BudgetSerializer(budget).data, status=status.HTTP_201_CREATED)


class BudgetDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, user, pk):
        try:
            return _apply_tenant_filter(Budget.objects.prefetch_related("lines"), user).get(pk=pk)
        except Budget.DoesNotExist:
            return None

    def get(self, request, pk):
        budget = self._get(request.user, pk)
        if not budget:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(BudgetSerializer(budget).data)

    def patch(self, request, pk):
        budget = self._get(request.user, pk)
        if not budget:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = BudgetWriteSerializer(budget, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        relation_errors = _validate_budget_payload(
            tenant=budget.tenant,
            branch=serializer.validated_data.get("branch", budget.branch),
            financial_year=serializer.validated_data.get("financial_year", budget.financial_year),
            lines=serializer.validated_data.get("lines"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        budget = serializer.save()
        return Response(BudgetSerializer(budget).data)
