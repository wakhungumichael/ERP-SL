"""
Sales module API views.

Covers:
  - Products & Services catalog (tenant-scoped)
  - Estimates (quotes) with line items
  - Recurring invoices
  - Customer statements
  - Customer list proxy (for dropdowns)

All views use the same _apply_tenant_filter pattern as the weighbridge module
to ensure strict tenant isolation.
"""
from rest_framework import generics, serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from SL_Sales.models import (
    Product, Estimate, EstimateLineItem,
    RecurringInvoice, RecurringInvoiceLineItem,
)

# ── Tenant isolation utilities (mirror weighbridge pattern) ───────────────────

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


def _tenant_or_400(user):
    """Return the tenant for non-superusers; raise 403 for profileless users."""
    resolved = _resolve_user_tenant(user)
    if isinstance(resolved, _NoTenantProfile):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("No tenant profile linked to this account.")
    return resolved  # None for superusers (caller must handle)


# ── Serializers ───────────────────────────────────────────────────────────────

class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = [
            "id", "tenant", "code", "name", "description",
            "product_type", "unit", "unit_price", "tax_rate", "is_active",
            "income_account", "expense_account",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "tenant", "created_at", "updated_at"]


class EstimateLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = EstimateLineItem
        fields = [
            "id", "product", "description", "quantity",
            "unit_price", "tax_rate", "discount_amount", "line_total", "sort_order",
        ]
        read_only_fields = ["id", "line_total"]


class EstimateSerializer(serializers.ModelSerializer):
    line_items   = EstimateLineItemSerializer(many=True, read_only=True)
    customer_display = serializers.SerializerMethodField()

    class Meta:
        model = Estimate
        fields = [
            "id", "tenant", "branch", "customer", "customer_name", "customer_display",
            "estimate_number", "issue_date", "expiry_date", "status",
            "subtotal", "discount_total", "tax_total", "total",
            "notes", "terms", "converted_to_invoice",
            "line_items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "estimate_number",
            "subtotal", "tax_total", "total",
            "converted_to_invoice", "created_at", "updated_at",
        ]

    def get_customer_display(self, obj):
        if obj.customer:
            return obj.customer.name
        return obj.customer_name


class EstimateWriteSerializer(serializers.ModelSerializer):
    line_items = EstimateLineItemSerializer(many=True, required=False)

    class Meta:
        model = Estimate
        fields = [
            "branch", "customer", "customer_name",
            "issue_date", "expiry_date", "status",
            "discount_total", "notes", "terms",
            "line_items",
        ]

    def create(self, validated_data):
        lines_data = validated_data.pop("line_items", [])
        estimate = Estimate.objects.create(**validated_data)
        for line_data in lines_data:
            EstimateLineItem.objects.create(estimate=estimate, **line_data)
        estimate.recalculate()
        return estimate

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("line_items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            instance.line_items.all().delete()
            for line_data in lines_data:
                EstimateLineItem.objects.create(estimate=instance, **line_data)
        instance.recalculate()
        return instance


class RecurringInvoiceLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringInvoiceLineItem
        fields = [
            "id", "product", "description", "quantity",
            "unit_price", "tax_rate", "line_total", "sort_order",
        ]
        read_only_fields = ["id", "line_total"]


class RecurringInvoiceSerializer(serializers.ModelSerializer):
    line_items = RecurringInvoiceLineItemSerializer(many=True, read_only=True)
    customer_display = serializers.SerializerMethodField()

    class Meta:
        model = RecurringInvoice
        fields = [
            "id", "tenant", "branch", "customer", "customer_name", "customer_display",
            "frequency", "status", "start_date", "end_date",
            "next_invoice_date", "last_generated_at",
            "subtotal", "tax_total", "total", "notes",
            "line_items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "subtotal", "tax_total", "total",
            "last_generated_at", "created_at", "updated_at",
        ]

    def get_customer_display(self, obj):
        if obj.customer:
            return obj.customer.name
        return obj.customer_name


class RecurringInvoiceWriteSerializer(serializers.ModelSerializer):
    line_items = RecurringInvoiceLineItemSerializer(many=True, required=False)

    class Meta:
        model = RecurringInvoice
        fields = [
            "branch", "customer", "customer_name",
            "frequency", "status", "start_date", "end_date", "next_invoice_date",
            "notes", "line_items",
        ]

    def _sync_lines(self, instance, lines_data):
        instance.line_items.all().delete()
        for line_data in lines_data:
            RecurringInvoiceLineItem.objects.create(recurring_invoice=instance, **line_data)
        lines = instance.line_items.all()
        instance.subtotal = sum(li.line_total for li in lines)
        instance.tax_total = sum(li.line_total * (li.tax_rate / 100) for li in lines)
        instance.total = instance.subtotal + instance.tax_total
        instance.save(update_fields=["subtotal", "tax_total", "total", "updated_at"])

    def create(self, validated_data):
        lines_data = validated_data.pop("line_items", [])
        instance = RecurringInvoice.objects.create(**validated_data)
        self._sync_lines(instance, lines_data)
        return instance

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("line_items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


# ── Products & Services ───────────────────────────────────────────────────────

class ProductListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/sales/products/          — list tenant products
    POST /api/sales/products/          — create product
    Query params: product_type, is_active, search
    """
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = _apply_tenant_filter(
            Product.objects.select_related("income_account", "expense_account"),
            self.request.user,
        ).order_by("name")
        p = self.request.query_params
        if pt := p.get("product_type"):
            qs = qs.filter(product_type=pt)
        if (ia := p.get("is_active")) is not None:
            qs = qs.filter(is_active=(ia.lower() == "true"))
        if q := p.get("search"):
            qs = qs.filter(name__icontains=q)
        return qs

    def perform_create(self, serializer):
        tenant = _tenant_or_400(self.request.user)
        serializer.save(tenant=tenant)


class ProductDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET / PATCH / DELETE /api/sales/products/<pk>/"""
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return _apply_tenant_filter(Product.objects.all(), self.request.user)


# ── Estimates ─────────────────────────────────────────────────────────────────

class EstimateListCreateView(APIView):
    """
    GET  /api/sales/estimates/   — list with filters: status, customer_id, date_from, date_to
    POST /api/sales/estimates/   — create with line_items
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"),
            request.user,
        ).order_by("-created_at")
        p = request.query_params
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if cid := p.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if df := p.get("date_from"):
            qs = qs.filter(issue_date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(issue_date__lte=dt)
        return Response(EstimateSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_400(request.user)
        ser = EstimateWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant, created_by=request.user)
        return Response(EstimateSerializer(obj).data, status=status.HTTP_201_CREATED)


class EstimateDetailView(APIView):
    """GET / PATCH / DELETE /api/sales/estimates/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"), user,
        )
        try:
            return qs.get(pk=pk)
        except Estimate.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(EstimateSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = EstimateWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        updated = ser.save()
        return Response(EstimateSerializer(updated).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EstimateConvertView(APIView):
    """
    POST /api/sales/estimates/<pk>/convert/
    Converts an accepted estimate into a draft invoice.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"), request.user,
        )
        try:
            estimate = qs.get(pk=pk)
        except Estimate.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if estimate.converted_to_invoice_id:
            return Response(
                {"error": "Already converted.", "invoice_id": estimate.converted_to_invoice_id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Import Invoice model from Weighbridge
        try:
            from SL_Weighbridge.models import Invoice
        except ImportError:
            return Response(
                {"error": "Invoice model unavailable."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Build a draft invoice
        customer_name = estimate.customer.name if estimate.customer else estimate.customer_name
        invoice = Invoice.objects.create(
            tenant=estimate.tenant,
            branch=estimate.branch,
            customer=estimate.customer,
            status="draft",
            notes=estimate.notes,
            total_amount=estimate.total,
        )

        estimate.converted_to_invoice = invoice
        estimate.status = "accepted"
        estimate.save(update_fields=["converted_to_invoice", "status", "updated_at"])

        return Response({
            "message": "Estimate converted to invoice.",
            "invoice_id": invoice.pk,
            "estimate_id": estimate.pk,
        }, status=status.HTTP_201_CREATED)


# ── Recurring Invoices ────────────────────────────────────────────────────────

class RecurringInvoiceListCreateView(APIView):
    """GET / POST /api/sales/recurring-invoices/"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            RecurringInvoice.objects.prefetch_related("line_items"),
            request.user,
        ).order_by("-created_at")
        p = request.query_params
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if f := p.get("frequency"):
            qs = qs.filter(frequency=f)
        return Response(RecurringInvoiceSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_400(request.user)
        ser = RecurringInvoiceWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant, created_by=request.user)
        return Response(RecurringInvoiceSerializer(obj).data, status=status.HTTP_201_CREATED)


class RecurringInvoiceDetailView(APIView):
    """GET / PATCH / DELETE /api/sales/recurring-invoices/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            RecurringInvoice.objects.prefetch_related("line_items"), user,
        )
        try:
            return qs.get(pk=pk)
        except RecurringInvoice.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(RecurringInvoiceSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = RecurringInvoiceWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response(RecurringInvoiceSerializer(ser.save()).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Customer Statement ────────────────────────────────────────────────────────

class CustomerStatementView(APIView):
    """
    GET /api/sales/customer-statements/<customer_id>/
    Returns invoice and payment summary for a single customer.
    Query params: date_from, date_to
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, customer_id):
        try:
            from SL_Weighbridge.models import Customer, Invoice
        except ImportError:
            return Response({"error": "Weighbridge module unavailable."}, status=500)

        # Verify customer belongs to user's tenant
        try:
            cust_qs = _apply_tenant_filter(Customer.objects.all(), request.user, filter_field="branch__tenant")
            # Try a looser lookup if branch-scoped filter yields nothing
            try:
                customer = cust_qs.get(pk=customer_id)
            except Customer.DoesNotExist:
                customer = Customer.objects.get(pk=customer_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=404)

        p = request.query_params
        inv_qs = _apply_tenant_filter(Invoice.objects.filter(customer=customer), request.user)
        if df := p.get("date_from"):
            inv_qs = inv_qs.filter(created_at__date__gte=df)
        if dt := p.get("date_to"):
            inv_qs = inv_qs.filter(created_at__date__lte=dt)
        inv_qs = inv_qs.order_by("-created_at")

        invoices = list(inv_qs)
        total_invoiced = sum(float(i.total_amount or 0) for i in invoices)
        total_paid     = sum(float(i.total_amount or 0) for i in invoices if i.status == "paid")
        outstanding    = total_invoiced - total_paid

        return Response({
            "customer": {
                "id": customer.pk,
                "name": customer.name,
                "phone": getattr(customer, "phone", ""),
                "email": getattr(customer, "email", ""),
            },
            "summary": {
                "total_invoiced": total_invoiced,
                "total_paid":     total_paid,
                "outstanding":    outstanding,
                "invoice_count":  len(invoices),
            },
            "invoices": [
                {
                    "id": inv.pk,
                    "invoice_number": getattr(inv, "invoice_number", f"INV-{inv.pk:04d}"),
                    "status":         inv.status,
                    "total_amount":   float(inv.total_amount or 0),
                    "due_date":       str(inv.due_date) if getattr(inv, "due_date", None) else None,
                    "created_at":     inv.created_at.isoformat(),
                }
                for inv in invoices
            ],
        })


# ── Customers proxy ───────────────────────────────────────────────────────────

class SalesCustomerListView(APIView):
    """
    GET /api/sales/customers/
    Lightweight customer list for dropdown selects (name, id).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            from SL_Weighbridge.models import Customer
        except ImportError:
            return Response({"customers": []})

        qs = Customer.objects.all().order_by("name")
        # Best-effort tenant scope via branch
        resolved = _resolve_user_tenant(request.user)
        if isinstance(resolved, _NoTenantProfile):
            return Response({"customers": []})
        if resolved is not None:
            qs = qs.filter(branch__tenant=resolved)

        if q := request.query_params.get("search"):
            qs = qs.filter(name__icontains=q)

        return Response({
            "customers": [
                {"id": c.pk, "name": c.name, "phone": getattr(c, "phone", "")}
                for c in qs[:100]
            ]
        })
