from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

try:
    from SL_HR.models import PayPeriod, PayRecord
    HAS_HR_MODELS = True
except ImportError:
    HAS_HR_MODELS = False

User = get_user_model()


# ── Serializers ────────────────────────────────────────────────────────────────

class PayRecordSerializer(serializers.ModelSerializer):
    employee_name     = serializers.SerializerMethodField()
    employee_username = serializers.CharField(source="employee.username", read_only=True)
    employee_email    = serializers.CharField(source="employee.email", read_only=True)

    def get_employee_name(self, obj):
        return obj.employee.get_full_name() or obj.employee.username

    class Meta:
        model  = PayRecord
        fields = [
            "id", "employee", "employee_name", "employee_username", "employee_email",
            "basic_pay", "allowances", "deductions", "net_pay", "notes",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class PayPeriodSerializer(serializers.ModelSerializer):
    record_count = serializers.SerializerMethodField()
    total_net    = serializers.SerializerMethodField()

    def get_record_count(self, obj):
        return obj.records.count()

    def get_total_net(self, obj):
        return float(sum(r.net_pay for r in obj.records.all()))

    class Meta:
        model  = PayPeriod
        fields = [
            "id", "name", "period_start", "period_end", "status", "notes",
            "record_count", "total_net", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


# ── Views ──────────────────────────────────────────────────────────────────────

class PayPeriodListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_HR_MODELS:
            return Response({"results": [], "count": 0})
        periods = PayPeriod.objects.prefetch_related("records").order_by("-period_start")
        data = PayPeriodSerializer(periods, many=True).data
        return Response({"results": list(data), "count": len(data)})

    def post(self, request):
        if not HAS_HR_MODELS:
            return Response({"error": "HR module not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        ser = PayPeriodSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        period = ser.save()
        # Auto-create pay records for all active users if requested
        if request.data.get("auto_populate"):
            users = User.objects.filter(is_active=True)
            for u in users:
                PayRecord.objects.get_or_create(period=period, employee=u)
        return Response(PayPeriodSerializer(period).data, status=status.HTTP_201_CREATED)


class PayPeriodDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, pk):
        try:
            return PayPeriod.objects.prefetch_related("records__employee").get(pk=pk)
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
        period.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PayRecordListCreateView(APIView):
    """List / create pay records for a given pay period."""
    permission_classes = [IsAuthenticated]

    def get(self, request, period_pk):
        if not HAS_HR_MODELS:
            return Response({"results": [], "count": 0})
        records = PayRecord.objects.filter(period_id=period_pk).select_related("employee")
        data = PayRecordSerializer(records, many=True).data
        return Response({"results": list(data), "count": len(data)})

    def post(self, request, period_pk):
        if not HAS_HR_MODELS:
            return Response({"error": "HR module not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            period = PayPeriod.objects.get(pk=period_pk)
        except PayPeriod.DoesNotExist:
            return Response({"error": "Period not found."}, status=status.HTTP_404_NOT_FOUND)
        data = {**request.data, "period": period.pk}
        ser = PayRecordSerializer(data=data)
        ser.is_valid(raise_exception=True)
        record = ser.save()
        return Response(PayRecordSerializer(record).data, status=status.HTTP_201_CREATED)


class PayRecordDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, period_pk, pk):
        if not HAS_HR_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            record = PayRecord.objects.get(pk=pk, period_id=period_pk)
        except PayRecord.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = PayRecordSerializer(record, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(PayRecordSerializer(record).data)

    def delete(self, request, period_pk, pk):
        if not HAS_HR_MODELS:
            return Response(status=status.HTTP_204_NO_CONTENT)
        try:
            record = PayRecord.objects.get(pk=pk, period_id=period_pk)
        except PayRecord.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        record.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HRDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        total_staff  = User.objects.filter(is_active=True).count()
        total_all    = User.objects.count()
        admin_count  = User.objects.filter(is_staff=True).count()

        payroll_summary = {"total_periods": 0, "completed_periods": 0, "total_net_last": 0.0, "last_period": None}
        if HAS_HR_MODELS:
            periods = PayPeriod.objects.prefetch_related("records").order_by("-period_start")
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
