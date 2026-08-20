from decimal import Decimal

from django.db.models import Q, Sum
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS as _NO_TENANT_ACCESS,
    apply_tenant_filter as _shared_apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403 as _tenant_or_403,
)
from SL_Inventory.models import InventoryBalance, InventoryMovement, InventoryReservation, Warehouse


def _apply_tenant_filter(qs, user, field="tenant"):
    return _shared_apply_tenant_filter(qs, user, filter_field=field)


class WarehouseSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = Warehouse
        fields = [
            "id",
            "tenant",
            "branch",
            "branch_name",
            "code",
            "name",
            "warehouse_type",
            "status",
            "is_default",
            "is_virtual",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tenant", "created_at", "updated_at", "branch_name"]


class WarehouseWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["branch", "code", "name", "warehouse_type", "status", "is_default", "is_virtual", "notes"]


class InventoryBalanceSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_code = serializers.CharField(source="product.code", read_only=True)

    class Meta:
        model = InventoryBalance
        fields = [
            "id",
            "tenant",
            "warehouse",
            "warehouse_name",
            "product",
            "product_name",
            "product_code",
            "on_hand_qty",
            "reserved_qty",
            "available_qty",
            "average_cost",
            "valuation_amount",
            "last_movement_at",
            "created_at",
            "updated_at",
        ]


class InventoryMovementSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_code = serializers.CharField(source="product.code", read_only=True)

    class Meta:
        model = InventoryMovement
        fields = [
            "id",
            "tenant",
            "warehouse",
            "warehouse_name",
            "product",
            "product_name",
            "product_code",
            "movement_type",
            "reference_type",
            "reference_id",
            "reference_line_id",
            "reference_number",
            "quantity",
            "unit_cost",
            "total_cost",
            "movement_date",
            "notes",
            "created_at",
            "updated_at",
        ]


class InventoryReservationSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_code = serializers.CharField(source="product.code", read_only=True)
    sales_order_number = serializers.CharField(source="sales_order.order_number", read_only=True)

    class Meta:
        model = InventoryReservation
        fields = [
            "id",
            "tenant",
            "warehouse",
            "warehouse_name",
            "product",
            "product_name",
            "product_code",
            "sales_order",
            "sales_order_number",
            "sales_order_line",
            "quantity",
            "status",
            "reserved_at",
            "released_at",
            "consumed_at",
            "created_at",
            "updated_at",
        ]


class InventoryDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        warehouses = _apply_tenant_filter(Warehouse.objects.all(), request.user)
        balances = _apply_tenant_filter(InventoryBalance.objects.select_related("warehouse", "product"), request.user)
        movements = _apply_tenant_filter(InventoryMovement.objects.select_related("warehouse", "product"), request.user)
        reservations = _apply_tenant_filter(InventoryReservation.objects.select_related("warehouse", "product"), request.user)

        totals = balances.aggregate(
            on_hand=Sum("on_hand_qty"),
            reserved=Sum("reserved_qty"),
            available=Sum("available_qty"),
            valuation=Sum("valuation_amount"),
        )
        counts = {
            "warehouses": warehouses.count(),
            "balances": balances.count(),
            "movements": movements.count(),
            "reservations": reservations.count(),
            "active_reservations": reservations.filter(status="active").count(),
        }
        return Response(
            {
                "counts": counts,
                "totals": {
                    "on_hand": totals["on_hand"] or Decimal("0"),
                    "reserved": totals["reserved"] or Decimal("0"),
                    "available": totals["available"] or Decimal("0"),
                    "valuation": totals["valuation"] or Decimal("0"),
                },
            }
        )


class WarehouseListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(Warehouse.objects.select_related("branch"), request.user).order_by("name")
        if warehouse_type := request.query_params.get("warehouse_type"):
            qs = qs.filter(warehouse_type=warehouse_type)
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if q := request.query_params.get("search"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q) | Q(branch__name__icontains=q))
        return Response(WarehouseSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_403(request.user)
        serializer = WarehouseWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        warehouse = serializer.save(tenant=tenant)
        return Response(WarehouseSerializer(warehouse).data, status=status.HTTP_201_CREATED)


class WarehouseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, user, pk):
        try:
            return _apply_tenant_filter(Warehouse.objects.select_related("branch"), user).get(pk=pk)
        except Warehouse.DoesNotExist:
            return None

    def get(self, request, pk):
        warehouse = self._get(request.user, pk)
        if not warehouse:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(WarehouseSerializer(warehouse).data)

    def patch(self, request, pk):
        warehouse = self._get(request.user, pk)
        if not warehouse:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = WarehouseWriteSerializer(warehouse, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        warehouse = serializer.save()
        return Response(WarehouseSerializer(warehouse).data)


class InventoryBalanceListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            InventoryBalance.objects.select_related("warehouse", "product"),
            request.user,
        ).order_by("warehouse__name", "product__name")
        if warehouse_id := request.query_params.get("warehouse_id"):
            qs = qs.filter(warehouse_id=warehouse_id)
        if product_id := request.query_params.get("product_id"):
            qs = qs.filter(product_id=product_id)
        if q := request.query_params.get("search"):
            qs = qs.filter(Q(product__name__icontains=q) | Q(product__code__icontains=q) | Q(warehouse__name__icontains=q))
        return Response(InventoryBalanceSerializer(qs, many=True).data)


class InventoryMovementListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            InventoryMovement.objects.select_related("warehouse", "product"),
            request.user,
        ).order_by("-movement_date", "-id")
        if movement_type := request.query_params.get("movement_type"):
            qs = qs.filter(movement_type=movement_type)
        if reference_type := request.query_params.get("reference_type"):
            qs = qs.filter(reference_type=reference_type)
        if warehouse_id := request.query_params.get("warehouse_id"):
            qs = qs.filter(warehouse_id=warehouse_id)
        if q := request.query_params.get("search"):
            qs = qs.filter(
                Q(reference_number__icontains=q)
                | Q(product__name__icontains=q)
                | Q(product__code__icontains=q)
                | Q(warehouse__name__icontains=q)
            )
        return Response(InventoryMovementSerializer(qs, many=True).data)


class InventoryReservationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            InventoryReservation.objects.select_related("warehouse", "product", "sales_order"),
            request.user,
        ).order_by("-reserved_at", "-id")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if warehouse_id := request.query_params.get("warehouse_id"):
            qs = qs.filter(warehouse_id=warehouse_id)
        if q := request.query_params.get("search"):
            qs = qs.filter(
                Q(product__name__icontains=q)
                | Q(product__code__icontains=q)
                | Q(sales_order__order_number__icontains=q)
                | Q(warehouse__name__icontains=q)
            )
        return Response(InventoryReservationSerializer(qs, many=True).data)
