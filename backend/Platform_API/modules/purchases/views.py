"""
Purchases module API views.

Covers:
  - Bills (vendor invoices) with line items
  - Vendors proxy (from SL_CRM Supplier model)
  - Products & Services (read from the shared SL_Sales catalog)
"""
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from SL_Procurement.models import Bill, BillLineItem
from SL_Sales.models import Product

# ── Tenant isolation (same pattern across all modules) ────────────────────────

class _NoTenantProfile:
    pass

_NO_PROFILE = _NoTenantProfile()


def _resolve_user_tenant(user):
    if user.is_superuser:
        return None
    try:
        profile = user.tenant_profile
        if profile and profile.tenant:
            return profile.tenant
    except Exception:
        pass
    return _NO_PROFILE


def _apply_tenant_filter(qs, user, filter_field="tenant"):
    resolved = _resolve_user_tenant(user)
    if resolved is None:
        return qs
    if isinstance(resolved, _NoTenantProfile):
        return qs.none()
    return qs.filter(**{filter_field: resolved})


def _tenant_or_403(user):
    resolved = _resolve_user_tenant(user)
    if isinstance(resolved, _NoTenantProfile):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("No tenant profile linked.")
    return resolved


# ── Serializers ───────────────────────────────────────────────────────────────

class BillLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillLineItem
        fields = [
            "id", "product", "description",
            "quantity", "unit_price", "tax_rate", "line_total", "sort_order",
        ]
        read_only_fields = ["id", "line_total"]


class BillSerializer(serializers.ModelSerializer):
    line_items      = BillLineItemSerializer(many=True, read_only=True)
    supplier_display = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = [
            "id", "tenant", "branch", "supplier", "supplier_name", "supplier_display",
            "bill_number", "reference", "issue_date", "due_date", "status",
            "subtotal", "tax_total", "total", "notes",
            "line_items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "bill_number",
            "subtotal", "tax_total", "total",
            "created_at", "updated_at",
        ]

    def get_supplier_display(self, obj):
        if obj.supplier:
            return obj.supplier.name
        return obj.supplier_name


class BillWriteSerializer(serializers.ModelSerializer):
    line_items = BillLineItemSerializer(many=True, required=False)

    class Meta:
        model = Bill
        fields = [
            "branch", "supplier", "supplier_name",
            "reference", "issue_date", "due_date", "status", "notes",
            "line_items",
        ]

    def _sync_lines(self, instance, lines_data):
        instance.line_items.all().delete()
        for line_data in lines_data:
            BillLineItem.objects.create(bill=instance, **line_data)
        instance.recalculate()

    def create(self, validated_data):
        lines_data = validated_data.pop("line_items", [])
        bill = Bill.objects.create(**validated_data)
        self._sync_lines(bill, lines_data)
        return bill

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("line_items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


# ── Bills ─────────────────────────────────────────────────────────────────────

class BillListCreateView(APIView):
    """
    GET  /api/purchases/bills/   — list bills
    POST /api/purchases/bills/   — create bill with line items
    Query params: status, supplier_id, date_from, date_to
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            Bill.objects.prefetch_related("line_items").select_related("supplier"),
            request.user,
        ).order_by("-created_at")
        p = request.query_params
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if sid := p.get("supplier_id"):
            qs = qs.filter(supplier_id=sid)
        if df := p.get("date_from"):
            qs = qs.filter(issue_date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(issue_date__lte=dt)
        return Response(BillSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_403(request.user)
        ser = BillWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(
            tenant=tenant if tenant is not None else None,
            created_by=request.user,
        )
        return Response(BillSerializer(obj).data, status=status.HTTP_201_CREATED)


class BillDetailView(APIView):
    """GET / PATCH / DELETE /api/purchases/bills/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            Bill.objects.prefetch_related("line_items").select_related("supplier"),
            user,
        )
        try:
            return qs.get(pk=pk)
        except Bill.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(BillSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = BillWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response(BillSerializer(ser.save()).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Vendors proxy ─────────────────────────────────────────────────────────────

class VendorListView(APIView):
    """
    GET /api/purchases/vendors/
    Returns CRM suppliers scoped to the user's tenant.
    Query params: search
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            from SL_CRM.models import Supplier
        except ImportError:
            return Response({"vendors": []})

        qs = Supplier.objects.all().order_by("name")
        # Supplier has a tenant FK via CRM — filter if available
        resolved = _resolve_user_tenant(request.user)
        if isinstance(resolved, _NoTenantProfile):
            return Response({"vendors": []})
        if resolved is not None:
            try:
                qs = qs.filter(tenant=resolved)
            except Exception:
                pass  # Supplier may not have tenant FK yet

        if q := request.query_params.get("search"):
            qs = qs.filter(name__icontains=q)

        return Response({
            "vendors": [
                {
                    "id": s.pk,
                    "name": s.name,
                    "email": getattr(s, "email", ""),
                    "phone": getattr(s, "phone", ""),
                    "contact_person": getattr(s, "contact_person", ""),
                }
                for s in qs[:200]
            ]
        })


# ── Products (shared catalog, purchase side) ──────────────────────────────────

class PurchaseProductListView(APIView):
    """
    GET /api/purchases/products/
    Read-only view of the shared product catalog for purchase line-item dropdowns.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            Product.objects.filter(is_active=True),
            request.user,
        ).order_by("name")

        if q := request.query_params.get("search"):
            qs = qs.filter(name__icontains=q)

        return Response({
            "products": [
                {
                    "id": p.pk,
                    "name": p.name,
                    "code": p.code,
                    "unit_price": float(p.unit_price),
                    "tax_rate": float(p.tax_rate),
                    "unit": p.unit,
                    "product_type": p.product_type,
                }
                for p in qs[:200]
            ]
        })
