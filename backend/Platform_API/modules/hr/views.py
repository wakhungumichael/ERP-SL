# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    resolve_user_tenant,
)
from Platform_Core.models import OrganizationMembership

try:
    from SL_HR.models import PayPeriod, PayRecord
    HAS_HR_MODELS = True
except ImportError:
    HAS_HR_MODELS = False

User = get_user_model()


def _resolved_tenant_or_403(user):
    tenant = resolve_user_tenant(user)
    if tenant is NO_TENANT_ACCESS:
        raise PermissionDenied("No organization linked to this account.")
    if tenant is None:
        raise PermissionDenied("Platform superadmins must choose an organization-specific HR context.")
    return tenant


def _user_belongs_to_tenant(user_obj, tenant):
    return OrganizationMembership.objects.filter(
        user=user_obj,
        tenant=tenant,
        is_active=True,
    ).exists()


class PayrollPermission(BasePermission):
    def has_permission(self, request, view):
        from .workforce import can
        model = 'payrecord' if isinstance(view, (PayRecordListCreateView, PayRecordDetailView)) else 'payperiod'
        action = {'GET': 'view', 'POST': 'add', 'PATCH': 'change', 'DELETE': 'delete'}.get(request.method, 'view')
        return can(request.user, f'{action}_{model}')


# ── Serializers ────────────────────────────────────────────────────────────────

class PayRecordSerializer(serializers.ModelSerializer):
    employee_name     = serializers.SerializerMethodField()
    employee_username = serializers.CharField(source="employee.username", read_only=True)
    employee_email    = serializers.CharField(source="employee.email", read_only=True)

    def get_employee_name(self, obj):
        return obj.employee.get_full_name() or obj.employee.username

    def validate(self, data):
        from decimal import Decimal
        values = {name: data.get(name, getattr(self.instance, name, Decimal('0'))) for name in ['basic_pay', 'allowances', 'deductions']}
        if any(value < 0 for value in values.values()) or values['deductions'] > values['basic_pay'] + values['allowances']:
            raise ValidationError({'pay': 'Use non-negative pay values; deductions cannot exceed gross pay.'})
        data['net_pay'] = values['basic_pay'] + values['allowances'] - values['deductions']
        return data

    class Meta:
        model  = PayRecord
        fields = [
            "id", "employee", "employee_name", "employee_username", "employee_email",
            "basic_pay", "allowances", "deductions", "net_pay", "notes",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "net_pay", "created_at", "updated_at"]


class PayPeriodSerializer(serializers.ModelSerializer):
    record_count = serializers.SerializerMethodField()
    total_net    = serializers.SerializerMethodField()

    def get_record_count(self, obj):
        return obj.records.count()

    def get_total_net(self, obj):
        return float(sum(r.net_pay for r in obj.records.all()))

    def validate(self, data):
        start = data.get('period_start', getattr(self.instance, 'period_start', None))
        end = data.get('period_end', getattr(self.instance, 'period_end', None))
        if start and end and end < start:
            raise ValidationError({'period_end': 'Period end must not precede the start.'})
        if self.instance and self.instance.status == 'Completed':
            raise ValidationError({'status': 'Completed payroll periods are locked.'})
        return data

    class Meta:
        model  = PayPeriod
        fields = [
            "id", "name", "period_start", "period_end", "status", "notes",
            "record_count", "total_net", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


# ── Views ──────────────────────────────────────────────────────────────────────

class PayPeriodListCreateView(APIView):
    permission_classes = [IsAuthenticated, PayrollPermission]

    def get(self, request):
        if not HAS_HR_MODELS:
            return Response({"results": [], "count": 0})
        tenant = _resolved_tenant_or_403(request.user)
        periods = PayPeriod.objects.filter(tenant=tenant).prefetch_related("records").order_by("-period_start")
        data = PayPeriodSerializer(periods, many=True).data
        return Response({"results": list(data), "count": len(data)})

    def post(self, request):
        if not HAS_HR_MODELS:
            return Response({"error": "HR module not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        tenant = _resolved_tenant_or_403(request.user)
        ser = PayPeriodSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        period = ser.save(tenant=tenant)
        # Auto-create pay records for all active users if requested
        if request.data.get("auto_populate"):
            users = User.objects.filter(
                is_active=True,
                organization_memberships__tenant=tenant,
                organization_memberships__is_active=True,
            ).distinct()
            for u in users:
                PayRecord.objects.get_or_create(period=period, employee=u)
        return Response(PayPeriodSerializer(period).data, status=status.HTTP_201_CREATED)


class PayPeriodDetailView(APIView):
    permission_classes = [IsAuthenticated, PayrollPermission]

    def _get(self, pk):
        tenant = _resolved_tenant_or_403(self.request.user)
        try:
            return PayPeriod.objects.prefetch_related("records__employee").get(pk=pk, tenant=tenant)
        except PayPeriod.DoesNotExist:
            return None

    def get(self, request, pk):
        if not HAS_HR_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        period = self._get(pk)
        if not period:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        data = PayPeriodSerializer(period).data
        data["records"] = PayRecordSerializer(period.records.all(), many=True).data
        return Response(data)

    def patch(self, request, pk):
        if not HAS_HR_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        period = self._get(pk)
        if not period:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = PayPeriodSerializer(period, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(PayPeriodSerializer(period).data)

    def delete(self, request, pk):
        if not HAS_HR_MODELS:
            return Response(status=status.HTTP_204_NO_CONTENT)
        period = self._get(pk)
        if not period:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if period.status != "Draft":
            raise ValidationError({"status": "Only draft payroll periods may be deleted."})
        period.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PayRecordListCreateView(APIView):
    """List / create pay records for a given pay period."""
    permission_classes = [IsAuthenticated, PayrollPermission]

    def get(self, request, period_pk):
        if not HAS_HR_MODELS:
            return Response({"results": [], "count": 0})
        tenant = _resolved_tenant_or_403(request.user)
        records = PayRecord.objects.filter(period_id=period_pk, period__tenant=tenant).select_related("employee")
        data = PayRecordSerializer(records, many=True).data
        return Response({"results": list(data), "count": len(data)})

    def post(self, request, period_pk):
        if not HAS_HR_MODELS:
            return Response({"error": "HR module not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        tenant = _resolved_tenant_or_403(request.user)
        try:
            period = PayPeriod.objects.get(pk=period_pk, tenant=tenant)
        except PayPeriod.DoesNotExist:
            return Response({"error": "Period not found."}, status=status.HTTP_404_NOT_FOUND)
        if period.status == "Completed":
            raise ValidationError({"status": "Completed payroll records are locked."})
        employee_id = request.data.get("employee")
        if employee_id:
            employee = User.objects.filter(pk=employee_id).first()
            if employee is None:
                return Response({"error": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)
            if not _user_belongs_to_tenant(employee, tenant):
                raise ValidationError({"employee": "Employee must belong to the same organization."})
        data = request.data.copy()
        ser = PayRecordSerializer(data=data)
        ser.is_valid(raise_exception=True)
        if period.records.filter(employee=ser.validated_data["employee"]).exists():
            raise ValidationError({"employee": "This employee already has a record in this period."})
        record = ser.save(period=period)
        return Response(PayRecordSerializer(record).data, status=status.HTTP_201_CREATED)


class PayRecordDetailView(APIView):
    permission_classes = [IsAuthenticated, PayrollPermission]

    def patch(self, request, period_pk, pk):
        if not HAS_HR_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        tenant = _resolved_tenant_or_403(request.user)
        try:
            record = PayRecord.objects.get(pk=pk, period_id=period_pk, period__tenant=tenant)
        except PayRecord.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if record.period.status == "Completed":
            raise ValidationError({"status": "Completed payroll records are locked."})
        employee_id = request.data.get("employee")
        if employee_id:
            employee = User.objects.filter(pk=employee_id).first()
            if employee is None:
                return Response({"error": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)
            if not _user_belongs_to_tenant(employee, tenant):
                raise ValidationError({"employee": "Employee must belong to the same organization."})
        ser = PayRecordSerializer(record, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(PayRecordSerializer(record).data)

    def delete(self, request, period_pk, pk):
        if not HAS_HR_MODELS:
            return Response(status=status.HTTP_204_NO_CONTENT)
        tenant = _resolved_tenant_or_403(request.user)
        try:
            record = PayRecord.objects.get(pk=pk, period_id=period_pk, period__tenant=tenant)
        except PayRecord.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        record.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HRDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from Platform_API.modules.mixins import require_workspace_permission

        require_workspace_permission(request.user, "can_view_hr_overview")
        tenant = _resolved_tenant_or_403(request.user)
        memberships = OrganizationMembership.objects.filter(tenant=tenant, is_active=True)
        user_ids = memberships.values_list("user_id", flat=True)
        total_staff = User.objects.filter(id__in=user_ids, is_active=True).distinct().count()
        total_all = User.objects.filter(id__in=user_ids).distinct().count()
        admin_count = memberships.filter(is_org_admin=True).values("user_id").distinct().count()

        payroll_summary = {"total_periods": 0, "completed_periods": 0, "total_net_last": 0.0, "last_period": None}
        if HAS_HR_MODELS:
            periods = PayPeriod.objects.filter(tenant=tenant).prefetch_related("records").order_by("-period_start")
            payroll_summary["total_periods"]     = periods.count()
            payroll_summary["completed_periods"] = periods.filter(status="Completed").count()
            last = periods.first()
            if last:
                payroll_summary["total_net_last"] = float(sum(r.net_pay for r in last.records.all()))
                payroll_summary["last_period"]    = {"id": last.id, "name": last.name, "status": last.status}

        return Response({
            "staff": {
                "total":    total_all,
                "active":   total_staff,
                "inactive": total_all - total_staff,
                "admins":   admin_count,
            },
            "payroll": payroll_summary,
        })
