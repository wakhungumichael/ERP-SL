import csv
import json as _json
import urllib.request
import urllib.error
from datetime import timedelta

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from SL_Weighbridge.models import Branch, Customer, IndicatorConfig, Item, Transaction, Vehicle, VehicleType


# ── Pagination ────────────────────────────────────────────────────────────────

class StandardPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200


# ── Serializers ───────────────────────────────────────────────────────────────

class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "address", "email", "phone"]


class VehicleTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleType
        fields = ["id", "name", "description", "charge", "max_gross_weight", "max_tare_weight"]


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ["id", "name", "description"]


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "name", "address", "phone_number", "email", "discounted", "charge"]


class CustomerInputSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["name", "address", "phone_number", "email", "discounted", "charge"]


class VehicleSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    vehicle_type_name = serializers.SerializerMethodField()

    def get_vehicle_type_name(self, obj):
        return getattr(getattr(obj, "vehicle_type", None), "name", "")

    class Meta:
        model = Vehicle
        fields = ["id", "number_plate", "customer", "customer_name", "vehicle_type", "vehicle_type_name"]


class TransactionSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_email = serializers.CharField(source="customer.email", read_only=True, default=None)
    vehicle_plate = serializers.CharField(source="vehicle.number_plate", read_only=True)
    item_name = serializers.SerializerMethodField()
    vehicle_type_name = serializers.SerializerMethodField()
    auto_invoice_id = serializers.SerializerMethodField()

    def get_item_name(self, obj):
        return getattr(getattr(obj, "item", None), "name", "")

    def get_vehicle_type_name(self, obj):
        return getattr(getattr(obj, "vehicle_type", None), "name", "")

    def get_auto_invoice_id(self, obj):
        return getattr(obj, "auto_invoice_id", None)


    class Meta:
        model = Transaction
        fields = [
            "id", "branch", "branch_name",
            "customer", "customer_name", "customer_email",
            "vehicle", "vehicle_plate",
            "vehicle_type", "vehicle_type_name",
            "operator", "item", "item_name",
            "gross_weight", "tare_weight", "net_weight",
            "gross_weight_date", "tare_weight_date",
            "status", "weight_type", "payment_mode", "payment_status",
            "charge", "destination", "invoiced", "approval_status",
            "manual_weight_capture", "weight_reason",
            "paired", "paired_first_transaction",
            "auto_invoice_id",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


# ── Views ─────────────────────────────────────────────────────────────────────

class WeighbridgeDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        month_start = today.replace(day=1)

        qs = Transaction.objects.all()
        if branch_id := request.query_params.get("branch_id"):
            qs = qs.filter(branch_id=branch_id)

        today_qs = qs.filter(created_at__date=today)
        month_qs = qs.filter(created_at__date__gte=month_start)

        status_breakdown = [
            {"status": s, "count": qs.filter(status=s).count()}
            for s in ["Pending", "Completed"]
        ]

        recent = TransactionSerializer(qs.order_by("-created_at")[:10], many=True).data

        return Response({
            "totals": {
                "transactions_today": today_qs.count(),
                "transactions_this_month": month_qs.count(),
                "net_weight_today": float(
                    sum(t.net_weight or 0 for t in today_qs.filter(net_weight__isnull=False))
                ),
                "pending_payments": qs.filter(payment_status="Pending").count(),
                "total_charge": float(
                    sum(t.charge or 0 for t in month_qs.filter(status="Completed"))
                ),
            },
            "status_breakdown": status_breakdown,
            "recent_transactions": recent,
        })


class TransactionListCreateView(generics.ListCreateAPIView):
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        from django.db.models import Q
        qs = Transaction.objects.select_related(
            "branch", "customer", "vehicle", "item", "vehicle_type"
        ).order_by("-created_at")
        params = self.request.query_params

        # ── Basic filters ──────────────────────────────────────────────────
        if branch_id := params.get("branch_id"):
            qs = qs.filter(branch_id=branch_id)
        if s := params.get("status"):
            qs = qs.filter(status=s)
        if ps := params.get("payment_status"):
            qs = qs.filter(payment_status=ps)
        if customer_id := params.get("customer_id"):
            qs = qs.filter(customer_id=customer_id)
        if weight_type := params.get("weight_type"):
            qs = qs.filter(weight_type=weight_type)
        if search := params.get("search"):
            qs = qs.filter(
                Q(vehicle__number_plate__icontains=search) |
                Q(customer__name__icontains=search) |
                Q(operator__icontains=search)
            )

        # ── Date / time range filter ────────────────────────────────────────
        # date_field choices: created_at | gross_weight_date | tare_weight_date | updated_at
        VALID_DATE_FIELDS = {
            "created_at":       "created_at",
            "gross_weight_date": "gross_weight_date",
            "tare_weight_date":  "tare_weight_date",
            "updated_at":        "updated_at",
        }
        db_field = VALID_DATE_FIELDS.get(params.get("date_field", ""), "created_at")
        date_from = params.get("date_from")
        date_to   = params.get("date_to")
        time_from = params.get("time_from") or "00:00"
        time_to   = params.get("time_to")   or "23:59"

        if date_from:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_from}T{time_from}:00")
                if dt:
                    if is_naive(dt):
                        dt = make_aware(dt)
                    qs = qs.filter(**{f"{db_field}__gte": dt})
            except Exception:
                pass
        if date_to:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_to}T{time_to}:59")
                if dt:
                    if is_naive(dt):
                        dt = make_aware(dt)
                    qs = qs.filter(**{f"{db_field}__lte": dt})
            except Exception:
                pass

        return qs


class TransactionDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]
    queryset = Transaction.objects.select_related("branch", "customer", "vehicle", "item", "vehicle_type")


class WorkflowContextView(APIView):
    """
    GET /api/commercial-weighbridge/transactions/workflow-context/?vehicle_id=<id>

    Returns workflow context for a vehicle:
    - whether it has a valid pending First Weight awaiting a Second Weight
    - the First Weight transaction details needed for pairing
    - recommended next action (first_weight or second_weight)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        vehicle_id = request.query_params.get("vehicle_id")
        if not vehicle_id:
            return Response(
                {"error": "vehicle_id query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            vehicle = Vehicle.objects.select_related("customer", "vehicle_type").get(pk=vehicle_id)
        except Vehicle.DoesNotExist:
            return Response({"error": f"Vehicle {vehicle_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        # Determine the configurable age window for matching first weights
        max_age_days = 3
        try:
            cfg = IndicatorConfig.objects.filter(branch__isnull=False).first() or IndicatorConfig.objects.first()
            if cfg and cfg.max_first_weight_age_days:
                max_age_days = cfg.max_first_weight_age_days
        except Exception:
            pass

        age_cutoff = timezone.now() - timedelta(days=max_age_days)

        # Most recent unpaired Pending First Weight for this vehicle within age window
        first_weight_tx = (
            Transaction.objects.select_related("branch", "customer", "vehicle", "item", "vehicle_type")
            .filter(
                vehicle=vehicle,
                weight_type="First Weight",
                status="Pending",
                paired=False,
                created_at__gte=age_cutoff,
            )
            .order_by("-created_at")
            .first()
        )

        has_pending = first_weight_tx is not None

        return Response({
            "vehicle_id": vehicle.id,
            "vehicle_plate": vehicle.number_plate,
            "customer_id": vehicle.customer_id,
            "customer_name": vehicle.customer.name if vehicle.customer else "",
            "vehicle_type_id": vehicle.vehicle_type_id,
            "vehicle_type_name": getattr(vehicle.vehicle_type, "name", ""),
            "has_pending_first_weight": has_pending,
            "workflow_recommendation": "second_weight" if has_pending else "first_weight",
            "first_weight_transaction": TransactionSerializer(first_weight_tx).data if has_pending else None,
            "max_first_weight_age_days": max_age_days,
            "message": (
                f"Vehicle {vehicle.number_plate} has a pending first weight of "
                f"{first_weight_tx.gross_weight} kg (TX-{first_weight_tx.id:05d}). "
                "Proceed to capture second weight to complete the transaction."
                if has_pending else
                f"No pending first weight found for {vehicle.number_plate} within the last {max_age_days} days. "
                "Start a new first weight transaction."
            ),
        })


class CaptureWeightView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/capture-weight/

    Captures stable weight from the branch indicator integration.
    Flow: Frontend → this endpoint → backend integration resolution → indicator source.

    Request body:
      branch_id         (int, optional if transaction_id given)
      transaction_id    (int, optional) — reads branch from this transaction
      apply_weight      (bool, default false) — if true AND stable, persist weight to transaction

    Response includes the live reading plus whether it was applied to the transaction.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        branch_id = request.data.get("branch_id")
        transaction_id = request.data.get("transaction_id")
        apply_weight = bool(request.data.get("apply_weight", False))

        tx = None
        branch = None

        # Resolve transaction
        if transaction_id:
            try:
                tx = Transaction.objects.select_related("branch").get(pk=transaction_id)
                branch = tx.branch
            except Transaction.DoesNotExist:
                return Response(
                    {"error": f"Transaction {transaction_id} not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # Resolve branch directly if not already resolved via transaction
        if not branch and branch_id:
            try:
                branch = Branch.objects.get(pk=branch_id)
            except Branch.DoesNotExist:
                return Response(
                    {"error": f"Branch {branch_id} not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # ── Attempt real indicator read ───────────────────────────────────────
        captured_weight = None
        stable = False
        source = "stub"
        indicator_meta = {}

        # 1. Local IndicatorConfig HTTP URL (stable_weight_url first, then live_weight_url)
        try:
            cfg = (
                IndicatorConfig.objects.filter(branch=branch).first()
                if branch
                else IndicatorConfig.objects.first()
            )
            if cfg and cfg.connection_type == "HTTP":
                url = (cfg.stable_weight_url or cfg.live_weight_url or "").strip()
                if url:
                    reading = _fetch_indicator_url(url)
                    captured_weight = reading["weight"]
                    stable = reading["stable"]
                    source = cfg.indicator_name
        except Exception:
            pass

        # 2. Platform_Core integration fallback
        if captured_weight is None:
            try:
                from Platform_Core.integrations import resolve_indicator_for_branch
                if branch:
                    reading = resolve_indicator_for_branch(branch)
                    captured_weight = reading.get("weight")
                    stable = reading.get("stable", False)
                    source = reading.get("source", "integration")
                    indicator_meta = reading.get("meta", {})
            except Exception:
                pass

        # ── Optionally apply stable weight to transaction ─────────────────────
        updated_transaction = None
        if apply_weight and stable and captured_weight is not None and tx:
            if tx.weight_type == "Second Weight":
                tx.tare_weight = int(captured_weight)
                if tx.gross_weight:
                    tx.net_weight = abs(int(tx.gross_weight) - int(captured_weight))
                if tx.paired_first_transaction_id:
                    paired = tx.paired_first_transaction
                    if paired:
                        paired.tare_weight = int(captured_weight)
                        paired.net_weight = tx.net_weight
                        paired.status = "Completed"
                        paired.paired = True
                        paired.save(update_fields=["tare_weight", "net_weight", "status", "paired", "updated_at"])
                tx.status = "Completed"
                tx.paired = True
            else:
                tx.gross_weight = int(captured_weight)

            tx.manual_weight_capture = False
            tx.save()

            # ── Auto-create draft invoice when a charge-bearing transaction completes ──
            # Only invoice the transaction that carries the actual charge (charge > 0).
            # In a paired First/Second Weight workflow the charge lives on the First Weight
            # record; the Second Weight record has charge=0 and should not generate its
            # own invoice.
            if tx.status == "Completed":
                try:
                    from Platform_API.modules.payments.views import create_draft_invoice_for_transaction
                    charge_tx = tx
                    if tx.weight_type == "Second Weight" and tx.paired_first_transaction_id:
                        # The charge is on the first-weight record
                        first = tx.paired_first_transaction
                        if first and float(first.charge or 0) > 0:
                            charge_tx = first
                        elif float(tx.charge or 0) <= 0:
                            charge_tx = None  # nothing to invoice
                    # Only create if the chosen transaction actually has a charge
                    if charge_tx and float(charge_tx.charge or 0) > 0:
                        create_draft_invoice_for_transaction(charge_tx)
                except Exception:
                    pass

            updated_transaction = TransactionSerializer(tx).data

        return Response({
            "captured_weight": captured_weight,
            "unit": "kg",
            "stable": stable,
            "source": source,
            "branch_id": branch.id if branch else None,
            "transaction_id": tx.id if tx else None,
            "applied": updated_transaction is not None,
            "transaction": updated_transaction,
            "indicator_meta": indicator_meta,
            "timestamp": timezone.now().isoformat(),
        })


class TransactionApproveView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/approve/

    Marks a transaction as approved (approval_status = True).
    Requires: superadmin, tenant_admin, or the Django permission
    SL_Weighbridge.can_approve_pending_transactions.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = Transaction.objects.get(pk=pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (
            request.user.is_superuser
            or request.user.is_staff
            or request.user.has_perm("SL_Weighbridge.can_approve_pending_transactions")
        ):
            return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        if tx.approval_status:
            return Response({"error": "Transaction is already approved.", "transaction": TransactionSerializer(tx).data}, status=status.HTTP_400_BAD_REQUEST)

        tx.approval_status = True
        tx.save(update_fields=["approval_status", "updated_at"])
        return Response({"message": "Transaction approved.", "transaction": TransactionSerializer(tx).data})


class TransactionRecallView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/recall/

    Recalls a Completed transaction back to Pending, clearing tare/net weights
    and unpairing the first-weight record so it can be re-weighed.
    Requires: superadmin, tenant_admin, or the Django permission
    SL_Weighbridge.can_recall_completed_transactions.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = Transaction.objects.get(pk=pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (
            request.user.is_superuser
            or request.user.is_staff
            or request.user.has_perm("SL_Weighbridge.can_recall_completed_transactions")
        ):
            return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        if tx.status != "Completed":
            return Response(
                {"error": "Only Completed transactions can be recalled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Void any auto-generated draft invoice ────────────────────────────
        # Un-pair the associated first-weight transaction if this is a second weight.
        # The charge (and therefore the auto_invoice) lives on the first-weight record
        # for paired transactions, so we must void that record's invoice too.
        def _void_auto_invoice(record):
            """Void the auto_invoice on `record` and clear the FK."""
            try:
                inv = getattr(record, "auto_invoice", None)
                if inv is None and record.auto_invoice_id:
                    from SL_Weighbridge.models import Invoice as _Inv
                    inv = _Inv.objects.filter(pk=record.auto_invoice_id).first()
                if inv:
                    inv.status = "void"
                    inv.save(update_fields=["status"])
                record.auto_invoice = None
                record.invoiced = False
                record.save(update_fields=["auto_invoice", "invoiced", "updated_at"])
            except Exception:
                pass

        if tx.weight_type == "Second Weight" and tx.paired_first_transaction_id:
            try:
                first = tx.paired_first_transaction
                _void_auto_invoice(first)
                first.status = "Pending"
                first.tare_weight = None
                first.net_weight = None
                first.paired = False
                first.approval_status = False
                first.save(update_fields=["status", "tare_weight", "net_weight", "paired", "approval_status", "updated_at"])
            except Exception:
                pass

        # Void the invoice on the recalled transaction itself (covers single-weight flow)
        _void_auto_invoice(tx)

        tx.status = "Pending"
        tx.approval_status = False
        tx.tare_weight = None
        tx.net_weight = None
        tx.tare_weight_date = None
        tx.paired = False
        tx.save()
        return Response({"message": "Transaction recalled to Pending.", "transaction": TransactionSerializer(tx).data})


class TransactionEmailReceiptView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/email-receipt/

    Sends a weighbridge receipt email for the given transaction.
    Body (optional): { "email": "override@example.com" }
    Falls back to the customer's email if no override is provided.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = Transaction.objects.select_related(
                "branch", "customer", "vehicle", "item", "vehicle_type"
            ).get(pk=pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        # Resolve recipient
        recipient = (request.data.get("email") or "").strip()
        if not recipient and tx.customer:
            recipient = (tx.customer.email or "").strip()
        if not recipient:
            return Response(
                {"error": "No email address available. Provide one or update the customer record."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tx_num = str(tx.id).zfill(5)
        branch_name = tx.branch.name if tx.branch else "Main Branch"
        plate = tx.vehicle.number_plate if tx.vehicle else "—"
        customer_name = tx.customer.name if tx.customer else "—"
        item_name = tx.item.name if tx.item else "—"
        vtype = tx.vehicle_type.name if tx.vehicle_type else "—"

        def _kg(v):
            if v is None:
                return "—"
            return f"{v:,} kg"

        def _kes(v):
            if v is None:
                return "—"
            try:
                return f"KES {float(v):,.2f}"
            except Exception:
                return str(v)

        def _dt(v):
            if not v:
                return "—"
            return v.strftime("%d %b %Y %H:%M") if hasattr(v, "strftime") else str(v)

        is_completed = tx.status == "Completed"
        status_color = "#16a34a" if is_completed else "#d97706"

        subject = f"Weighbridge Receipt — TX#{tx_num}"

        # Plain text
        sep = "=" * 44
        body = "\n".join([
            sep, f"  SL-ERP  WEIGHBRIDGE RECEIPT", f"  {branch_name}", sep,
            f"Transaction #:  {tx_num}",
            f"Status:         {tx.status}",
            "",
            "--- VEHICLE & CUSTOMER ---",
            f"Plate:          {plate}",
            f"Vehicle Type:   {vtype}",
            f"Customer:       {customer_name}",
            f"Item:           {item_name}",
            f"Destination:    {tx.destination or '—'}",
            f"Operator:       {tx.operator or '—'}",
            "",
            "--- WEIGHTS ---",
            f"Gross Weight:   {_kg(tx.gross_weight)}",
            f"Tare Weight:    {_kg(tx.tare_weight)}",
            f"Net Weight:     {_kg(tx.net_weight)}",
            "",
            "--- PAYMENT ---",
            f"Mode:           {tx.payment_mode or '—'}",
            f"Payment Status: {tx.payment_status or '—'}",
            f"CHARGE:         {_kes(tx.charge)}",
            "",
            "--- TIMESTAMPS ---",
            f"First Weight:   {_dt(tx.gross_weight_date or tx.created_at)}",
            f"Second Weight:  {_dt(tx.tare_weight_date)}",
            "",
            sep,
            "Thank you for using our weighbridge.",
            "SL-ERP OPERATIONS PLATFORM",
            sep,
        ])

        # HTML
        html_body = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f9fafb;font-family:'Courier New',monospace;">
<div style="max-width:480px;margin:0 auto;background:#fff;border:2px solid #000;padding:24px;">
  <div style="text-align:center;border-bottom:2px dashed #000;padding-bottom:12px;margin-bottom:16px;">
    <div style="font-size:22px;font-weight:bold;letter-spacing:3px;">SL-ERP</div>
    <div style="font-size:14px;margin-top:2px;">WEIGHBRIDGE TICKET</div>
    <div style="font-size:11px;color:#666;margin-top:3px;">{branch_name}</div>
  </div>
  <div style="text-align:center;font-size:28px;font-weight:bold;letter-spacing:6px;margin:10px 0;">#{tx_num}</div>
  <div style="text-align:center;margin-bottom:16px;">
    <span style="border:2px solid {status_color};color:{status_color};padding:3px 16px;font-weight:bold;font-size:12px;letter-spacing:2px;text-transform:uppercase;">{tx.status}</span>
  </div>
  <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:14px;">
    <tr><td style="color:#555;padding:3px 0;">Plate Number</td><td style="font-weight:bold;text-align:right;">{plate}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Vehicle Type</td><td style="font-weight:bold;text-align:right;">{vtype}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Customer</td><td style="font-weight:bold;text-align:right;">{customer_name}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Item / Commodity</td><td style="font-weight:bold;text-align:right;">{item_name}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Destination</td><td style="font-weight:bold;text-align:right;">{tx.destination or '—'}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Operator</td><td style="font-weight:bold;text-align:right;">{tx.operator or '—'}</td></tr>
  </table>
  <div style="background:#f5f5f5;border:1px solid #000;padding:12px;margin:12px 0;text-align:center;">
    <div style="display:flex;justify-content:space-around;margin-bottom:10px;">
      <div><div style="font-size:10px;color:#666;text-transform:uppercase;">Gross</div><div style="font-weight:bold;font-size:15px;">{_kg(tx.gross_weight)}</div><div style="font-size:9px;color:#999;">{_dt(tx.gross_weight_date)}</div></div>
      <div style="font-size:20px;font-weight:bold;display:flex;align-items:center;">−</div>
      <div><div style="font-size:10px;color:#666;text-transform:uppercase;">Tare</div><div style="font-weight:bold;font-size:15px;">{_kg(tx.tare_weight)}</div><div style="font-size:9px;color:#999;">{_dt(tx.tare_weight_date)}</div></div>
    </div>
    <div style="border-top:1px solid #000;padding-top:8px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#555;">NET WEIGHT</div>
      <div style="font-size:26px;font-weight:bold;">{_kg(tx.net_weight)}</div>
    </div>
  </div>
  <div style="border-top:2px solid #000;padding-top:10px;margin-top:10px;font-size:15px;font-weight:bold;display:flex;justify-content:space-between;">
    <span>CHARGE</span><span>{_kes(tx.charge)}</span>
  </div>
  <div style="font-size:12px;color:#555;margin-top:4px;display:flex;justify-content:space-between;">
    <span>Mode</span><span>{tx.payment_mode or '—'}</span>
  </div>
  <div style="text-align:center;font-size:10px;margin-top:16px;color:#666;border-top:1px dashed #000;padding-top:10px;">
    <div>Thank you for using our weighbridge</div>
    <div style="font-weight:bold;letter-spacing:1px;margin-top:4px;">SL-ERP OPERATIONS PLATFORM</div>
  </div>
</div>
</body></html>"""

        try:
            from django.core.mail import EmailMultiAlternatives
            from django.conf import settings as dj_settings
            from_email = getattr(dj_settings, "DEFAULT_FROM_EMAIL", "noreply@sl-erp.com")
            msg = EmailMultiAlternatives(subject=subject, body=body, from_email=from_email, to=[recipient])
            msg.attach_alternative(html_body, "text/html")
            msg.send(fail_silently=False)
            return Response({"message": f"Receipt sent to {recipient}."})
        except Exception as exc:
            return Response({"error": f"Could not send email: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TransactionExportCSVView(APIView):
    """
    GET /api/commercial-weighbridge/transactions/export/csv/

    Exports transactions matching the current filter params as a CSV file.
    Accepts the same query params as TransactionListCreateView.
    Capped at 10 000 rows.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Transaction.objects.select_related(
            "branch", "customer", "vehicle", "item", "vehicle_type"
        ).order_by("-created_at")

        params = request.query_params
        from django.db.models import Q

        if branch_id := params.get("branch_id"):
            qs = qs.filter(branch_id=branch_id)
        if s := params.get("status"):
            qs = qs.filter(status=s)
        if ps := params.get("payment_status"):
            qs = qs.filter(payment_status=ps)
        if wt := params.get("weight_type"):
            qs = qs.filter(weight_type=wt)
        if cid := params.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if search := params.get("search"):
            qs = qs.filter(
                Q(vehicle__number_plate__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(operator__icontains=search)
            )

        # Date / time range (same logic as list view)
        VALID_DATE_FIELDS = {
            "created_at": "created_at",
            "gross_weight_date": "gross_weight_date",
            "tare_weight_date": "tare_weight_date",
            "updated_at": "updated_at",
        }
        db_field = VALID_DATE_FIELDS.get(params.get("date_field", ""), "created_at")
        date_from = params.get("date_from")
        date_to   = params.get("date_to")
        time_from = params.get("time_from") or "00:00"
        time_to   = params.get("time_to")   or "23:59"

        if date_from:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_from}T{time_from}:00")
                if dt and is_naive(dt):
                    dt = make_aware(dt)
                if dt:
                    qs = qs.filter(**{f"{db_field}__gte": dt})
            except Exception:
                pass
        if date_to:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_to}T{time_to}:59")
                if dt and is_naive(dt):
                    dt = make_aware(dt)
                if dt:
                    qs = qs.filter(**{f"{db_field}__lte": dt})
            except Exception:
                pass

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="transactions.csv"'

        writer = csv.writer(response)
        writer.writerow([
            "TX ID", "Vehicle Plate", "Customer", "Branch", "Item", "Vehicle Type",
            "Weight Type", "Gross Weight (kg)", "Tare Weight (kg)", "Net Weight (kg)",
            "Charge (KES)", "Destination", "Operator",
            "Payment Mode", "Payment Status", "Status", "Approved",
            "Manual Capture", "Weight Reason",
            "Gross Weight Date", "Tare Weight Date", "Created At", "Updated At",
        ])

        for tx in qs[:10_000]:
            writer.writerow([
                tx.id,
                tx.vehicle.number_plate if tx.vehicle else "",
                tx.customer.name if tx.customer else "",
                tx.branch.name if tx.branch else "",
                tx.item.name if tx.item else "",
                tx.vehicle_type.name if tx.vehicle_type else "",
                tx.weight_type,
                tx.gross_weight or "",
                tx.tare_weight or "",
                tx.net_weight or "",
                tx.charge or "",
                tx.destination or "",
                tx.operator or "",
                tx.payment_mode or "",
                tx.payment_status or "",
                tx.status,
                "Yes" if tx.approval_status else "No",
                "Yes" if tx.manual_weight_capture else "No",
                tx.weight_reason or "",
                tx.gross_weight_date.isoformat() if tx.gross_weight_date else "",
                tx.tare_weight_date.isoformat() if tx.tare_weight_date else "",
                tx.created_at.isoformat() if tx.created_at else "",
                tx.updated_at.isoformat() if tx.updated_at else "",
            ])

        return response


class BranchListView(generics.ListAPIView):
    serializer_class = BranchSerializer
    permission_classes = [IsAuthenticated]
    queryset = Branch.objects.all().order_by("name")


# ── Settings / configuration CRUD ────────────────────────────────────────────

class IndicatorConfigSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = IndicatorConfig
        fields = [
            "id", "branch", "branch_name", "indicator_name", "connection_type",
            "port", "baud_rate", "data_bits", "parity", "stop_bits",
            "live_weight_url", "stable_weight_url",
            "max_first_weight_age_days", "mode", "node_number",
        ]


class IndicatorConfigListCreateView(generics.ListCreateAPIView):
    serializer_class = IndicatorConfigSerializer
    permission_classes = [IsAuthenticated]
    queryset = IndicatorConfig.objects.select_related("branch").order_by("branch__name")


class IndicatorConfigDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = IndicatorConfigSerializer
    permission_classes = [IsAuthenticated]
    queryset = IndicatorConfig.objects.select_related("branch")


class VehicleTypeCreateUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = VehicleTypeSerializer
    permission_classes = [IsAuthenticated]
    queryset = VehicleType.objects.all()


class VehicleTypeListView(generics.ListCreateAPIView):
    serializer_class = VehicleTypeSerializer
    permission_classes = [IsAuthenticated]
    queryset = VehicleType.objects.all().order_by("name")


class ItemListCreateView(generics.ListCreateAPIView):
    serializer_class = ItemSerializer
    permission_classes = [IsAuthenticated]
    queryset = Item.objects.all().order_by("name")


class ItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ItemSerializer
    permission_classes = [IsAuthenticated]
    queryset = Item.objects.all()


# ── CustomerVehicleTypeDiscount CRUD ─────────────────────────────────────────

class CustomerVehicleTypeDiscountSerializer(serializers.ModelSerializer):
    customer_name    = serializers.CharField(source="customer.name", read_only=True)
    vehicle_type_name = serializers.CharField(source="vehicle_type.name", read_only=True)

    class Meta:
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount
        model = CustomerVehicleTypeDiscount
        fields = ["id", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "discounted_charge"]


class CustomerVehicleTypeDiscountListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount

        class _Ser(serializers.ModelSerializer):
            customer_name    = serializers.CharField(source="customer.name", read_only=True)
            vehicle_type_name = serializers.CharField(source="vehicle_type.name", read_only=True)
            class Meta:
                model = CustomerVehicleTypeDiscount
                fields = ["id", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "discounted_charge"]
        return _Ser

    def get_queryset(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount
        qs = CustomerVehicleTypeDiscount.objects.select_related("customer", "vehicle_type").order_by("customer__name")
        if cid := self.request.query_params.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        return qs


class CustomerVehicleTypeDiscountDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount

        class _Ser(serializers.ModelSerializer):
            customer_name    = serializers.CharField(source="customer.name", read_only=True)
            vehicle_type_name = serializers.CharField(source="vehicle_type.name", read_only=True)
            class Meta:
                model = CustomerVehicleTypeDiscount
                fields = ["id", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "discounted_charge"]
        return _Ser

    def get_queryset(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount
        return CustomerVehicleTypeDiscount.objects.select_related("customer", "vehicle_type")


# ── Item list (legacy read-only alias kept for backward compat) ───────────────
class ItemListView(ItemListCreateView):
    pass


class CustomerListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CustomerInputSerializer
        return CustomerSerializer

    def get_queryset(self):
        qs = Customer.objects.all().order_by("name")
        if search := self.request.query_params.get("search"):
            qs = qs.filter(name__icontains=search)
        return qs


class CustomerDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated]
    queryset = Customer.objects.all()


class VehicleListCreateView(generics.ListCreateAPIView):
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = Vehicle.objects.select_related("customer", "vehicle_type").order_by("number_plate")
        params = self.request.query_params
        if customer_id := params.get("customer_id"):
            qs = qs.filter(customer_id=customer_id)
        if search := params.get("search"):
            qs = qs.filter(number_plate__icontains=search)
        return qs


class VehicleDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated]
    queryset = Vehicle.objects.select_related("customer", "vehicle_type")


def _fetch_indicator_url(url: str, timeout: int = 3) -> dict:
    """Fetch a weight indicator HTTP endpoint and normalise the response."""
    req = urllib.request.urlopen(url, timeout=timeout)  # noqa: S310
    raw = _json.loads(req.read().decode())
    # Support both {value, stable} and {weight, stable} shapes
    weight = raw.get("value") if raw.get("value") is not None else raw.get("weight")
    stable = bool(raw.get("stable", False))
    return {"weight": float(weight) if weight is not None else None, "stable": stable}


class LiveWeightView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        branch_id = request.query_params.get("branch_id")
        branch = None
        if branch_id:
            try:
                branch = Branch.objects.get(pk=branch_id)
            except Branch.DoesNotExist:
                pass

        # 1. Try local IndicatorConfig HTTP URL (preferred — always works without Platform_Core)
        try:
            cfg = (
                IndicatorConfig.objects.filter(branch=branch).first()
                if branch
                else IndicatorConfig.objects.first()
            )
            if cfg and cfg.connection_type == "HTTP" and cfg.live_weight_url:
                reading = _fetch_indicator_url(cfg.live_weight_url)
                return Response({
                    "weight": reading["weight"],
                    "unit": "kg",
                    "stable": reading["stable"],
                    "source": cfg.indicator_name,
                    "branch_id": branch.id if branch else None,
                    "timestamp": timezone.now().isoformat(),
                })
        except Exception:
            pass

        # 2. Try Platform_Core integration resolution
        try:
            from Platform_Core.integrations import resolve_indicator_for_branch
            if branch:
                reading = resolve_indicator_for_branch(branch)
                return Response({
                    "weight": reading.get("weight"),
                    "unit": reading.get("unit", "kg"),
                    "stable": reading.get("stable", False),
                    "source": reading.get("source", "integration"),
                    "branch_id": branch.id,
                    "timestamp": timezone.now().isoformat(),
                })
        except Exception:
            pass

        # 3. Settings-based global URL fallback (INDICATOR_LIVE_WEIGHT_URL)
        try:
            from django.conf import settings as django_settings
            url = getattr(django_settings, "INDICATOR_LIVE_WEIGHT_URL", None)
            if url:
                reading = _fetch_indicator_url(
                    url,
                    timeout=getattr(django_settings, "INDICATOR_REQUEST_TIMEOUT", 5),
                )
                return Response({
                    "weight": reading["weight"],
                    "unit": "kg",
                    "stable": reading["stable"],
                    "source": getattr(django_settings, "INDICATOR_API_BASE_URL", url),
                    "branch_id": branch.id if branch else None,
                    "timestamp": timezone.now().isoformat(),
                })
        except Exception:
            pass

        # 4. Stub fallback (offline / not configured)
        cfg_name = "offline"
        try:
            cfg = (
                IndicatorConfig.objects.filter(branch=branch).first()
                if branch
                else IndicatorConfig.objects.first()
            )
            cfg_name = cfg.indicator_name if cfg else "offline"
        except Exception:
            pass

        return Response({
            "weight": None,
            "unit": "kg",
            "stable": False,
            "source": cfg_name,
            "branch_id": branch.id if branch else None,
            "timestamp": timezone.now().isoformat(),
        })


class TransactionReceivePaymentView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/receive-payment/
    Body: { method: str, reference: str }
    Marks the transaction as Paid and, if linked, marks its auto_invoice as paid too.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = Transaction.objects.select_related(
                "customer", "vehicle", "vehicle_type", "auto_invoice"
            ).get(pk=pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if tx.status != "Completed":
            return Response(
                {"error": "Only Completed transactions can receive payment."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if tx.payment_status == "Paid":
            return Response(
                {
                    "error": "Payment has already been recorded for this transaction.",
                    "transaction_id": tx.id,
                    "payment_status": tx.payment_status,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        method    = request.data.get("method", "Cash")
        reference = request.data.get("reference", "")

        # Update transaction payment
        tx.payment_mode   = method
        tx.payment_status = "Paid"
        tx.save(update_fields=["payment_mode", "payment_status", "updated_at"])

        # If there's a linked auto_invoice, mark it paid
        invoice_id = None
        try:
            auto_inv = tx.auto_invoice
            if auto_inv and auto_inv.status != "paid":
                auto_inv.status = "paid"
                auto_inv.issued_at = auto_inv.issued_at or timezone.now()
                auto_inv.save(update_fields=["status", "issued_at"])
                # Also mark all transactions on that invoice as paid
                auto_inv.transactions.filter(payment_status="Pending").update(
                    payment_status="Paid",
                    payment_mode=method,
                )
                invoice_id = auto_inv.id
        except Exception:
            pass

        return Response({
            "success":        True,
            "transaction_id": tx.id,
            "payment_mode":   tx.payment_mode,
            "payment_status": tx.payment_status,
            "reference":      reference,
            "invoice_id":     invoice_id,
            "transaction":    TransactionSerializer(tx).data,
        })
