import json
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

try:
    from SL_Procurement.models import PurchaseOrder, PurchaseOrderItem
    HAS_PROCUREMENT_MODELS = True
except ImportError:
    HAS_PROCUREMENT_MODELS = False


# ── Serializers ────────────────────────────────────────────────────────────────

class POItemSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PurchaseOrderItem
        fields = ["id", "description", "unit", "quantity", "unit_price", "total"]
        read_only_fields = ["id", "total"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items        = POItemSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    class Meta:
        model  = PurchaseOrder
        fields = [
            "id", "reference", "supplier_name", "supplier_email", "supplier_phone",
            "status", "order_date", "expected_date", "total_amount", "currency",
            "notes", "created_by", "created_by_name", "items", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "created_by", "created_by_name"]


class PurchaseOrderWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PurchaseOrder
        fields = [
            "reference", "supplier_name", "supplier_email", "supplier_phone",
            "status", "order_date", "expected_date", "total_amount", "currency", "notes",
        ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_reference():
    """Auto-generate PO reference like PO-0042."""
    if not HAS_PROCUREMENT_MODELS:
        return "PO-0001"
    last = PurchaseOrder.objects.order_by("-id").first()
    n = (last.id + 1) if last else 1
    return f"PO-{n:04d}"


# ── Views ──────────────────────────────────────────────────────────────────────

class ProcurementDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _apply_po_tenant_filter(request, qs):
        """
        Three-state queryset filter for PurchaseOrder tables.
        - Superuser               → unfiltered
        - Non-superuser w/ profile → filtered via created_by chain
        - Non-superuser w/o profile → qs.none() (deny-all)
        """
        if request.user.is_superuser:
            return qs
        try:
            profile = request.user.tenant_profile
            if profile and profile.tenant:
                return qs.filter(created_by__tenant_profile__tenant=profile.tenant)
        except Exception:
            pass
        return qs.none()

    def get(self, request):
        if not HAS_PROCUREMENT_MODELS:
            return Response({
                "counts": {"total": 0, "draft": 0, "submitted": 0, "approved": 0, "received": 0, "cancelled": 0},
                "total_value": 0.0,
                "recent": [],
            })
        qs = self._apply_po_tenant_filter(request, PurchaseOrder.objects.all())
        status_counts = {s: qs.filter(status=s).count() for s in ["Draft", "Submitted", "Approved", "Received", "Cancelled"]}
        total_val = float(sum(po.total_amount for po in qs.filter(status__in=["Approved", "Received"])))
        recent = PurchaseOrderSerializer(qs.order_by("-created_at")[:5], many=True).data
        return Response({
            "counts": {
                "total":     qs.count(),
                "draft":     status_counts.get("Draft", 0),
                "submitted": status_counts.get("Submitted", 0),
                "approved":  status_counts.get("Approved", 0),
                "received":  status_counts.get("Received", 0),
                "cancelled": status_counts.get("Cancelled", 0),
            },
            "total_value": total_val,
            "recent": list(recent),
        })


class PurchaseOrderListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"results": [], "count": 0})

        # ── Tenant isolation guard ────────────────────────────────────────────
        # - Superusers: global access
        # - Profiled non-superusers: scoped to their tenant (param check too)
        # - Profileless non-superusers: deny-all via _apply_po_tenant_filter
        if not request.user.is_superuser:
            tenant_code_param = request.query_params.get("tenant_code")
            user_tenant = None
            try:
                profile = request.user.tenant_profile
                if profile and profile.tenant:
                    user_tenant = profile.tenant
            except Exception:
                pass
            if tenant_code_param and user_tenant and tenant_code_param != user_tenant.code:
                return Response({"results": [], "count": 0})

        qs = ProcurementDashboardView._apply_po_tenant_filter(
            request,
            PurchaseOrder.objects.prefetch_related("items").order_by("-created_at"),
        )

        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if q := request.query_params.get("search"):
            from django.db.models import Q
            qs = qs.filter(Q(reference__icontains=q) | Q(supplier_name__icontains=q) | Q(notes__icontains=q))
        data = PurchaseOrderSerializer(qs, many=True).data
        return Response({"results": list(data), "count": len(data)})

    def post(self, request):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Procurement module not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        body = request.data
        items_data = body.get("items", [])

        # Auto-reference if not provided
        ref = body.get("reference") or _next_reference()
        write_data = {**body, "reference": ref}
        write_data.pop("items", None)

        ser = PurchaseOrderWriteSerializer(data=write_data)
        ser.is_valid(raise_exception=True)
        po = ser.save(created_by=request.user)

        # Save items
        for item in items_data:
            PurchaseOrderItem.objects.create(
                order=po,
                description=item.get("description", ""),
                unit=item.get("unit", "pcs"),
                quantity=item.get("quantity", 1),
                unit_price=item.get("unit_price", 0),
                total=0,  # calculated in model.save()
            )
        po.recalculate_total()
        return Response(PurchaseOrderSerializer(po).data, status=status.HTTP_201_CREATED)


class PurchaseOrderDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        """
        Fetch a PurchaseOrder by PK with tenant scoping.

        - Superusers: global access
        - Profiled non-superusers: only POs in their own tenant (others → None/404)
        - Profileless non-superusers: deny-all → qs.none() → always None/404
        """
        qs = ProcurementDashboardView._apply_po_tenant_filter(
            request, PurchaseOrder.objects.prefetch_related("items")
        )
        try:
            return qs.get(pk=pk)
        except PurchaseOrder.DoesNotExist:
            return None

    def get(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po = self._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PurchaseOrderSerializer(po).data)

    def patch(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po = self._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        body = {**request.data}
        items_data = body.pop("items", None)
        ser = PurchaseOrderWriteSerializer(po, data=body, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        if items_data is not None:
            po.items.all().delete()
            for item in items_data:
                PurchaseOrderItem.objects.create(
                    order=po,
                    description=item.get("description", ""),
                    unit=item.get("unit", "pcs"),
                    quantity=item.get("quantity", 1),
                    unit_price=item.get("unit_price", 0),
                    total=0,
                )
            po.recalculate_total()
        return Response(PurchaseOrderSerializer(po).data)

    def delete(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response(status=status.HTTP_204_NO_CONTENT)
        po = self._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PurchaseOrderStatusView(APIView):
    """PATCH /api/procurement/orders/<pk>/status/  { status: 'Approved' }"""
    permission_classes = [IsAuthenticated]

    ALLOWED_TRANSITIONS = {
        "Draft":     ["Submitted", "Cancelled"],
        "Submitted": ["Approved", "Cancelled", "Draft"],
        "Approved":  ["Received", "Cancelled"],
        "Received":  [],
        "Cancelled": ["Draft"],
    }

    def patch(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            qs = ProcurementDashboardView._apply_po_tenant_filter(
                request, PurchaseOrder.objects.all()
            )
            po = qs.get(pk=pk)
        except PurchaseOrder.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        new_status = request.data.get("status")
        allowed = self.ALLOWED_TRANSITIONS.get(po.status, [])
        if new_status not in allowed:
            return Response(
                {"error": f"Cannot transition from '{po.status}' to '{new_status}'. Allowed: {allowed}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        po.status = new_status
        po.save(update_fields=["status", "updated_at"])
        return Response(PurchaseOrderSerializer(po).data)
