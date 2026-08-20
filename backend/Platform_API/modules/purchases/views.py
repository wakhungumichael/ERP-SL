"""
Purchases module API views.

Covers:
  - Bills (vendor invoices) with line items
  - Vendors proxy (from SL_CRM Supplier model)
  - Products & Services (read from the shared SL_Sales catalog)
"""
from decimal import Decimal

from django.utils import timezone

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_Core.accounting import assert_posting_allowed, sync_bill_posting
from Platform_Core.models import TenantSettings
from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    apply_tenant_filter as _apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403 as _tenant_or_403,
)
from SL_Procurement.models import Bill, BillLineItem, MatchException, PaymentQueueItem
from SL_Sales.models import Product
from SL_Budgeting.models import BudgetCommitment


def _get_tenant_default_tax_rate(tenant):
    if tenant is None:
        return Decimal("0.00")
    try:
        settings_obj = TenantSettings.objects.only("default_tax_rate").get(tenant=tenant)
        return settings_obj.default_tax_rate if settings_obj.default_tax_rate is not None else Decimal("0.00")
    except TenantSettings.DoesNotExist:
        return Decimal("0.00")


def _apply_default_tax_to_lines(lines_data, tenant):
    default_tax_rate = _get_tenant_default_tax_rate(tenant)
    normalized_lines = []
    for line_data in lines_data:
        line_copy = dict(line_data)
        if "tax_rate" not in line_copy or line_copy.get("tax_rate") in (None, ""):
            line_copy["tax_rate"] = default_tax_rate
        normalized_lines.append(line_copy)
    return normalized_lines


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
    purchase_order_reference = serializers.CharField(source="purchase_order.reference", read_only=True)
    goods_receipt_number = serializers.CharField(source="goods_receipt.receipt_number", read_only=True)
    payment_queue_status = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = [
            "id", "tenant", "branch", "supplier", "supplier_name", "supplier_display",
            "purchase_order", "purchase_order_reference", "goods_receipt", "goods_receipt_number",
            "bill_number", "reference", "issue_date", "due_date", "status",
            "subtotal", "tax_total", "total", "match_status", "payment_queue_status", "notes",
            "line_items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "bill_number",
            "subtotal", "tax_total", "total", "match_status",
            "created_at", "updated_at",
        ]

    def get_supplier_display(self, obj):
        if obj.supplier:
            return obj.supplier.name
        return obj.supplier_name

    def get_payment_queue_status(self, obj):
        queue_item = obj.payment_queue_items.order_by("-created_at").first()
        return queue_item.status if queue_item else None


class BillWriteSerializer(serializers.ModelSerializer):
    line_items = BillLineItemSerializer(many=True, required=False)

    class Meta:
        model = Bill
        fields = [
            "branch", "supplier", "supplier_name",
            "purchase_order", "goods_receipt",
            "reference", "issue_date", "due_date", "status", "notes",
            "line_items",
        ]

    def _sync_lines(self, instance, lines_data):
        instance.line_items.all().delete()
        for line_data in _apply_default_tax_to_lines(lines_data, instance.tenant):
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


def _safe_decimal(value):
    return Decimal(str(value or 0))


def _clear_match_exceptions(bill):
    MatchException.objects.filter(bill=bill).delete()


def _create_match_exception(*, bill, exception_type, message, purchase_order=None, goods_receipt=None, line_reference="", variance_percent=Decimal("0.00"), details=None):
    MatchException.objects.create(
        tenant=bill.tenant,
        purchase_order=purchase_order,
        goods_receipt=goods_receipt,
        bill=bill,
        exception_type=exception_type,
        message=message,
        line_reference=line_reference,
        variance_percent=variance_percent,
        details=details or {},
    )


def _run_three_way_match(bill, *, tolerance_percent=Decimal("2.00")):
    _clear_match_exceptions(bill)
    po = bill.purchase_order
    grn = bill.goods_receipt
    status_value = "matched"

    if not po:
        _create_match_exception(bill=bill, exception_type="missing_po", message="Bill is not linked to a purchase order.")
        status_value = "exception"
    if not grn:
        _create_match_exception(bill=bill, exception_type="missing_receipt", message="Bill is not linked to a goods receipt note.", purchase_order=po)
        status_value = "exception"
    if not po or not grn:
        bill.match_status = status_value
        bill.save(update_fields=["match_status", "updated_at"])
        return {"status": status_value, "exceptions": list(bill.match_exceptions.values("id", "exception_type", "message"))}

    po_lines = {line.description.strip().lower(): line for line in po.items.all()}
    grn_lines = {line.description.strip().lower(): line for line in grn.lines.all()}

    for bill_line in bill.line_items.all():
        key = bill_line.description.strip().lower()
        po_line = po_lines.get(key)
        grn_line = grn_lines.get(key)

        if not po_line or not grn_line:
            _create_match_exception(
                bill=bill,
                purchase_order=po,
                goods_receipt=grn,
                exception_type="line_missing",
                message=f"Line '{bill_line.description}' is missing from PO or GRN.",
                line_reference=bill_line.description,
            )
            status_value = "exception"
            continue

        bill_qty = _safe_decimal(bill_line.quantity)
        grn_qty = _safe_decimal(grn_line.accepted_quantity or grn_line.received_quantity)
        po_qty = _safe_decimal(po_line.quantity)
        bill_price = _safe_decimal(bill_line.unit_price)
        po_price = _safe_decimal(po_line.unit_price)

        if po_qty and bill_qty != grn_qty:
            variance = abs((bill_qty - grn_qty) / po_qty) * Decimal("100")
            if variance > tolerance_percent:
                _create_match_exception(
                    bill=bill,
                    purchase_order=po,
                    goods_receipt=grn,
                    exception_type="quantity_variance",
                    message=f"Quantity variance on '{bill_line.description}'.",
                    line_reference=bill_line.description,
                    variance_percent=variance,
                    details={"bill_quantity": str(bill_qty), "received_quantity": str(grn_qty)},
                )
                status_value = "exception"

        if po_price:
            price_variance = abs((bill_price - po_price) / po_price) * Decimal("100")
            if price_variance > tolerance_percent:
                _create_match_exception(
                    bill=bill,
                    purchase_order=po,
                    goods_receipt=grn,
                    exception_type="price_variance",
                    message=f"Price variance on '{bill_line.description}'.",
                    line_reference=bill_line.description,
                    variance_percent=price_variance,
                    details={"bill_price": str(bill_price), "po_price": str(po_price)},
                )
                status_value = "exception"

    bill.match_status = status_value
    bill.save(update_fields=["match_status", "updated_at"])
    return {"status": status_value, "exceptions": list(bill.match_exceptions.values("id", "exception_type", "message", "variance_percent"))}


def _actualize_budget_from_bill(bill):
    po = bill.purchase_order
    if not po:
        return False
    commitment = BudgetCommitment.objects.filter(
        tenant=bill.tenant,
        source_type="purchase_order",
        source_reference=po.reference,
        state="obligated",
    ).select_related("budget_line").first()
    if not commitment:
        return False

    budget_line = commitment.budget_line
    amount = Decimal(str(bill.total or commitment.amount or 0))
    previous_amount = Decimal(str(commitment.amount or 0))

    budget_line.obligated_amount = max(Decimal("0.00"), Decimal(str(budget_line.obligated_amount or 0)) - previous_amount)
    budget_line.actual_amount = Decimal(str(budget_line.actual_amount or 0)) + amount
    budget_line.save(update_fields=["obligated_amount", "actual_amount", "updated_at"])

    commitment.state = "actual"
    commitment.source_type = "bill"
    commitment.source_reference = bill.bill_number or f"bill:{bill.pk}"
    commitment.amount = amount
    commitment.released_at = timezone.now()
    commitment.save(update_fields=["state", "source_type", "source_reference", "amount", "released_at", "updated_at"])
    return True


def _prepare_payment_queue(bill, *, prepared_by=None):
    supplier_name = bill.supplier.name if bill.supplier else bill.supplier_name
    status_value = "ready" if bill.match_status == "matched" and bill.status in {"approved", "paid"} else "blocked"
    queue_item, _ = PaymentQueueItem.objects.update_or_create(
        tenant=bill.tenant,
        bill=bill,
        defaults={
            "supplier_name": supplier_name or "Unknown Supplier",
            "amount": bill.total,
            "due_date": bill.due_date,
            "status": "paid" if bill.status == "paid" else status_value,
            "prepared_by": prepared_by,
            "prepared_at": timezone.now(),
            "metadata": {"match_status": bill.match_status, "bill_status": bill.status},
        },
    )
    return queue_item


def _finalize_bill_controls(bill, *, prepared_by=None):
    if bill.match_status == "matched" and bill.status in {"approved", "paid"}:
        _actualize_budget_from_bill(bill)
        return _prepare_payment_queue(bill, prepared_by=prepared_by)
    if bill.status in {"approved", "paid"}:
        return _prepare_payment_queue(bill, prepared_by=prepared_by)
    return None


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
        if assert_posting_allowed is not None:
            try:
                assert_posting_allowed(
                    tenant=tenant if tenant is not None else None,
                    posting_date=ser.validated_data.get("issue_date"),
                    source_label="bill",
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(
            tenant=tenant if tenant is not None else None,
            created_by=request.user,
        )
        try:
            sync_bill_posting(obj)
        except Exception:
            pass
        _run_three_way_match(obj)
        _finalize_bill_controls(obj, prepared_by=request.user)
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
        if assert_posting_allowed is not None:
            try:
                assert_posting_allowed(
                    tenant=getattr(obj, "tenant", None),
                    posting_date=ser.validated_data.get("issue_date") or obj.issue_date,
                    source_label="bill update",
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        updated = ser.save()
        try:
            sync_bill_posting(updated)
        except Exception:
            pass
        _run_three_way_match(updated)
        _finalize_bill_controls(updated, prepared_by=request.user)
        return Response(BillSerializer(updated).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BillThreeWayMatchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        obj = BillDetailView()._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        tolerance = Decimal(str(request.data.get("tolerance_percent", "2.00")))
        result = _run_three_way_match(obj, tolerance_percent=tolerance)
        _finalize_bill_controls(obj, prepared_by=request.user)
        return Response(
            {
                "bill": BillSerializer(obj).data,
                "match_result": result,
            }
        )


class PaymentQueueListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            PaymentQueueItem.objects.select_related("bill"),
            request.user,
        ).order_by("status", "due_date", "-created_at")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        return Response(
            {
                "results": [
                    {
                        "id": item.id,
                        "bill_id": item.bill_id,
                        "bill_number": item.bill.bill_number,
                        "supplier_name": item.supplier_name,
                        "amount": item.amount,
                        "due_date": item.due_date,
                        "status": item.status,
                        "payment_reference": item.payment_reference,
                        "notes": item.notes,
                    }
                    for item in qs
                ],
                "count": qs.count(),
            }
        )


class PaymentQueuePrepareView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        obj = BillDetailView()._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        queue_item = _finalize_bill_controls(obj, prepared_by=request.user)
        if queue_item is None:
            return Response(
                {"error": "Bill must be matched and at least approved before payment preparation."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"bill": BillSerializer(obj).data, "payment_queue_status": queue_item.status})


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
        if resolved is NO_TENANT_ACCESS:
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
