"""Annual procurement plans derived from approved organization budgets."""
import csv
from decimal import Decimal
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from Platform_API.modules.budgeting.planning import can, require, tenant_for
from Platform_API.modules.budgeting.views import BudgetPagination
from Platform_Core.models import Tenant
from Platform_Core.organization import branch_allowed_for_user
from SL_Budgeting.models import Budget
from SL_Procurement.models import ProcurementPlan, ProcurementPlanLine


def annual_budgets(user):
    qs = Budget.objects.filter(tenant=tenant_for(user), department__isnull=True, period_type='annual', approval_status='approved', status='active').select_related('branch').prefetch_related('lines__account')
    return qs.filter(pk__in=[row.pk for row in qs if not row.branch_id or branch_allowed_for_user(user, row.branch)])


def plans_for(user):
    qs = ProcurementPlan.objects.filter(tenant=tenant_for(user)).select_related('annual_budget__branch').prefetch_related('lines__budget_line__account')
    return qs.filter(pk__in=[row.pk for row in qs if not row.annual_budget.branch_id or branch_allowed_for_user(user, row.annual_budget.branch)])


class PlanLineSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='budget_line.account.name', read_only=True)
    department_code = serializers.CharField(source='budget_line.cost_center', read_only=True)
    class Meta:
        model = ProcurementPlanLine
        fields = ['id','budget_line','account_name','department_code','description','category','quantity','unit','estimated_amount','procurement_method','planned_date','notes']
        read_only_fields = ['id']


class PlanSerializer(serializers.ModelSerializer):
    lines = PlanLineSerializer(many=True, read_only=True)
    budget_name = serializers.CharField(source='annual_budget.name', read_only=True)
    currency = serializers.CharField(source='annual_budget.currency', read_only=True)
    total_amount = serializers.SerializerMethodField()
    access = serializers.SerializerMethodField()
    def get_total_amount(self, obj):
        return str(sum((row.estimated_amount for row in obj.lines.all()), Decimal('0')))
    def get_access(self, obj):
        user = self.context['request'].user
        editable = obj.status in {'draft','rejected'}
        return {'can_edit': editable and can(user, 'change_procurementplan', 'SL_Procurement'), 'can_submit': editable and can(user, 'submit_procurementplan', 'SL_Procurement')}
    class Meta:
        model = ProcurementPlan
        fields = ['id','annual_budget','budget_name','name','code','currency','status','total_amount','lines','access','approved_by','approved_at']


class PlanWriteSerializer(serializers.ModelSerializer):
    lines = PlanLineSerializer(many=True, required=False)
    class Meta:
        model = ProcurementPlan
        fields = ['annual_budget','name','code','lines']
        validators = []
    def validate(self, attrs):
        user = self.context['request'].user
        tenant = tenant_for(user)
        obj = self.instance
        budget = attrs.get('annual_budget', obj.annual_budget if obj else None)
        if not budget or not annual_budgets(user).filter(pk=budget.pk).exists():
            raise ValidationError({'annual_budget': 'Choose an approved active annual budget.'})
        if obj and obj.status not in {'draft','rejected'}:
            raise ValidationError({'plan': 'Submitted and approved plans cannot be edited.'})
        others = ProcurementPlan.objects.filter(tenant=tenant)
        if obj: others = others.exclude(pk=obj.pk)
        if others.filter(annual_budget=budget).exists():
            raise ValidationError({'annual_budget': 'A procurement plan already exists for this annual budget.'})
        if others.filter(code=attrs.get('code', obj.code if obj else '')).exists():
            raise ValidationError({'code': 'This plan code is already in use.'})
        totals = {}
        for line in attrs.get('lines', []):
            allocation = line['budget_line']
            if allocation.budget_id != budget.pk:
                raise ValidationError({'lines': 'All items must use allocations from the selected annual budget.'})
            amount = line['estimated_amount']
            if amount <= 0 or line.get('quantity', 1) <= 0:
                raise ValidationError({'lines': 'Quantity and estimated amount must be positive.'})
            if date := line.get('planned_date'):
                if not budget.start_date <= date <= budget.end_date:
                    raise ValidationError({'lines': 'Planned dates must fall within the annual budget period.'})
            totals[allocation.pk] = totals.get(allocation.pk, Decimal('0')) + amount
            if totals[allocation.pk] > allocation.allocated_amount:
                raise ValidationError({'lines': 'Planned spending exceeds an annual budget allocation.'})
        if obj and budget.pk != obj.annual_budget_id and 'lines' not in attrs:
            raise ValidationError({'lines': 'Replace items when changing the annual budget.'})
        return attrs
    def create(self, data):
        lines = data.pop('lines', None)
        obj = ProcurementPlan.objects.create(**data)
        if lines is None:
            lines = [{'budget_line': row, 'description': row.notes or row.account.name, 'category':'other', 'estimated_amount': row.allocated_amount, 'procurement_method':'other'} for row in obj.annual_budget.lines.select_related('account').filter(allocated_amount__gt=0)]
        for line in lines: ProcurementPlanLine.objects.create(plan=obj, **line)
        return obj
    def update(self, obj, data):
        lines = data.pop('lines', None)
        for key,value in data.items(): setattr(obj, key, value)
        obj.save()
        if lines is not None:
            obj.lines.all().delete()
            for line in lines: ProcurementPlanLine.objects.create(plan=obj, **line)
        return obj


class PlanOptionsView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        require(request.user, 'view_procurementplan', 'SL_Procurement')
        return Response({'budgets':[{'id': row.pk,'name': row.name,'code':row.code,'currency':row.currency,'lines':[{'id':line.pk,'name':line.account.name,'department':line.cost_center,'amount':str(line.allocated_amount)} for line in row.lines.all()]} for row in annual_budgets(request.user)], 'access':{'can_create': can(request.user,'add_procurementplan','SL_Procurement')}})


class PlanListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        require(request.user, 'view_procurementplan', 'SL_Procurement')
        qs = plans_for(request.user).order_by('-created_at','-pk')
        if value := request.query_params.get('search'): qs = qs.filter(Q(name__icontains=value)|Q(code__icontains=value))
        if value := request.query_params.get('status'): qs = qs.filter(status=value)
        pager = BudgetPagination()
        rows = pager.paginate_queryset(qs, request)
        return pager.get_paginated_response(PlanSerializer(rows, many=True, context={'request':request}).data)
    @transaction.atomic
    def post(self, request):
        require(request.user,'add_procurementplan','SL_Procurement')
        tenant = tenant_for(request.user)
        Tenant.objects.select_for_update(of=('self',)).get(pk=tenant.pk)
        data = PlanWriteSerializer(data=request.data, context={'request':request})
        data.is_valid(raise_exception=True)
        obj = data.save(tenant=tenant, created_by=request.user)
        return Response(PlanSerializer(obj,context={'request':request}).data,status=201)


class PlanDetailView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, pk):
        require(request.user,'view_procurementplan','SL_Procurement')
        obj = get_object_or_404(plans_for(request.user),pk=pk)
        if request.query_params.get('export') == 'csv':
            response = HttpResponse(content_type='text/csv')
            response['Content-Disposition'] = f'attachment; filename="procurement-plan-{obj.pk}.csv"'
            writer=csv.writer(response)
            writer.writerow(['Description','Department','Account','Category','Quantity','Unit','Estimated amount','Currency','Method','Planned date','Status'])
            for row in obj.lines.all():
                values=[row.description,row.budget_line.cost_center,row.budget_line.account.name,row.category,str(row.quantity),row.unit,str(row.estimated_amount),obj.annual_budget.currency,row.procurement_method,str(row.planned_date or ''),obj.status]
                writer.writerow(["'"+value if value.startswith(('=','+','-','@','\t','\r')) else value for value in values])
            return response
        return Response(PlanSerializer(obj,context={'request':request}).data)
    @transaction.atomic
    def patch(self, request, pk):
        require(request.user,'change_procurementplan','SL_Procurement')
        Tenant.objects.select_for_update(of=('self',)).get(pk=tenant_for(request.user).pk)
        obj = get_object_or_404(plans_for(request.user).select_for_update(of=('self',)),pk=pk)
        data = PlanWriteSerializer(obj,data=request.data,partial=True,context={'request':request})
        data.is_valid(raise_exception=True)
        obj=data.save()
        return Response(PlanSerializer(obj,context={'request':request}).data)
