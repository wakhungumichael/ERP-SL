# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from decimal import Decimal

from django.db.models import Q
from django.db import transaction
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from .planning import require, can, budgets_for, budget_access, validate_budget_data, tenant_for, consolidate
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
        read_only_fields = ["id", "available_amount", "committed_amount", "obligated_amount", "actual_amount"]


class BudgetSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    total_amount = serializers.SerializerMethodField()
    access = serializers.SerializerMethodField()
    source_budgets = serializers.PrimaryKeyRelatedField(source='department_budgets', many=True, read_only=True)

    def get_total_amount(self, obj):
        return str(sum((line.allocated_amount for line in obj.lines.all()), Decimal('0')))

    def get_access(self, obj):
        request = self.context.get('request')
        return budget_access(obj, request.user) if request else {}
    lines = BudgetLineSerializer(many=True, read_only=True)

    class Meta:
        model = Budget
        fields = [
            "id",
            "department", "department_name", "annual_budget", "approval_status", "submitted_by", "approved_by", "approved_at", "total_amount", "access", "source_budgets",
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
            "department",
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

    def validate(self, attrs):
        request = self.context.get('request')
        if 'currency' in attrs:
            value = attrs['currency'].strip().upper()
            if len(value) != 3 or not value.isascii() or not value.isalpha():
                raise ValidationError({'currency': 'Use a three-letter currency code, such as KES.'})
            attrs['currency'] = value
        if request:
            tenant = tenant_for(request.user)
            errors = _validate_budget_payload(tenant=tenant, branch=attrs.get('branch', getattr(self.instance, 'branch', None)), financial_year=attrs.get('financial_year', getattr(self.instance, 'financial_year', None)), lines=attrs.get('lines'))
            if errors:
                raise ValidationError(errors)
            return validate_budget_data(self.instance, attrs, request.user)
        return attrs

    def _sync_lines(self, budget, lines_data):
        if budget.lines.filter(Q(committed_amount__gt=0) | Q(obligated_amount__gt=0) | Q(actual_amount__gt=0)).exists():
            raise ValidationError({'lines': 'Budget lines with recorded spending cannot be replaced.'})
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
        lines = _apply_budget_line_tenant_filter(BudgetLine.objects.filter(budget__department__isnull=True).select_related("budget"), request.user)
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


class BudgetPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class BudgetListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require(request.user, 'view_budget')
        qs = budgets_for(request.user).order_by('-created_at', '-pk')
        if kind := request.query_params.get('kind'):
            qs = qs.filter(department__isnull=kind == 'annual')
        if value := request.query_params.get('approval_status'):
            qs = qs.filter(approval_status=value)
        if value := request.query_params.get('search'):
            qs = qs.filter(Q(name__icontains=value) | Q(code__icontains=value) | Q(department__name__icontains=value))
        if 'page' in request.query_params:
            pager = BudgetPagination()
            rows = pager.paginate_queryset(qs, request)
            return pager.get_paginated_response(BudgetSerializer(rows, many=True, context={'request': request}).data)
        return Response(BudgetSerializer(qs, many=True, context={'request': request}).data)

    @transaction.atomic
    def post(self, request):
        require(request.user, 'add_budget')
        tenant = tenant_for(request.user)
        serializer = BudgetWriteSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        errors = _validate_budget_payload(tenant=tenant, branch=serializer.validated_data.get('branch'), financial_year=serializer.validated_data.get('financial_year'), lines=serializer.validated_data.get('lines'))
        if errors:
            raise ValidationError(errors)
        budget = serializer.save(tenant=tenant, created_by=request.user)
        return Response(BudgetSerializer(budget, context={'request': request}).data, status=201)


class BudgetDetailView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, pk):
        require(request.user, 'view_budget')
        from django.shortcuts import get_object_or_404
        return Response(BudgetSerializer(get_object_or_404(budgets_for(request.user), pk=pk), context={'request': request}).data)

    @transaction.atomic
    def patch(self, request, pk):
        from django.shortcuts import get_object_or_404
        require(request.user, 'change_budget')
        budget = get_object_or_404(budgets_for(request.user).select_for_update(of=('self',)), pk=pk)
        serializer = BudgetWriteSerializer(budget, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        errors = _validate_budget_payload(tenant=budget.tenant, branch=serializer.validated_data.get('branch', budget.branch), financial_year=serializer.validated_data.get('financial_year', budget.financial_year), lines=serializer.validated_data.get('lines'))
        if errors:
            raise ValidationError(errors)
        budget = serializer.save()
        return Response(BudgetSerializer(budget, context={'request': request}).data)


class BudgetOptionsView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        require(request.user, 'view_budget')
        from Platform_Core.models import Account, Department, FinancialYear, TenantBranch
        from Platform_Core.organization import visible_units, branch_allowed_for_user
        tenant = tenant_for(request.user)
        departments = visible_units(request.user, tenant, catalog=can(request.user, 'view_all_budget')).filter(unit_type='department', is_active=True)
        if not can(request.user, 'view_all_budget'):
            departments = departments.filter(Q(head=request.user) | Q(deputy=request.user) | Q(members=request.user)).distinct()
        return Response({'departments': list(departments.values('id','name','code')), 'branches': [{'id': row.pk, 'name': row.name} for row in TenantBranch.objects.filter(tenant=tenant, is_active=True) if branch_allowed_for_user(request.user, row)],
            'accounts': list(Account.objects.filter(tenant=tenant, allow_posting=True).values('id','code','name')),
            'financial_years': list(FinancialYear.objects.filter(tenant=tenant).values('id','name','start_date','end_date')),
            'access': {'can_create': can(request.user, 'add_budget'), 'can_consolidate': can(request.user, 'consolidate_budget')}})


class BudgetConsolidateView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        identifiers = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1).run_validation(request.data.get('budgets'))
        name = serializers.CharField(max_length=180).run_validation(request.data.get('name'))
        code = serializers.CharField(max_length=40).run_validation(request.data.get('code'))
        annual = consolidate(request.user, identifiers, name, code)
        return Response(BudgetSerializer(annual, context={'request': request}).data, status=201)
