import logging
from datetime import timedelta

from django.db import DatabaseError
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

try:
    from SL_Weighbridge.models import Invoice, InvoiceLine, Transaction, Customer, InvoiceEmailLog
    HAS_PAYMENT_MODELS = True
except ImportError:
    HAS_PAYMENT_MODELS = False
    InvoiceEmailLog = None

try:
    from SL_Weighbridge.models import PaymentMethod
    HAS_PAYMENT_METHOD_MODEL = True
except ImportError:
    HAS_PAYMENT_METHOD_MODEL = False


# ── Serializers ───────────────────────────────────────────────────────────────

class PaymentMethodSerializer(serializers.Serializer):
    id       = serializers.IntegerField()
    name     = serializers.CharField()
    is_active = serializers.BooleanField()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _customer_data(inv):
    c = getattr(inv, "customer", None)
    if not c:
        return {"name": "", "email": "", "phone": "", "id": None}
    return {
        "id":    c.id,
        "name":  getattr(c, "name", ""),
        "email": getattr(c, "email", "") or "",
        "phone": getattr(c, "phone_number", "") or "",
    }


def _serialize_invoice(inv, with_lines=False, with_transactions=False):
    customer = _customer_data(inv)
    data = {
        "id":             inv.id,
        "invoice_number": inv.invoice_number or f"INV-{inv.id:04d}",
        "customer":       customer["id"],
        "customer_name":  customer["name"],
        "customer_email": customer["email"],
        "customer_phone": customer["phone"],
        "status":         inv.status,
        "total_amount":   float(inv.total_amount or 0),
        "currency":       getattr(inv, "currency", "KES") or "KES",
        "issued_at":      inv.issued_at.isoformat()  if getattr(inv, "issued_at",   None) else None,
        "due_date":       str(inv.due_date)           if getattr(inv, "due_date",    None) else None,
        "created_at":     inv.issued_date.isoformat() if getattr(inv, "issued_date", None) else None,
        "notes":          getattr(inv, "notes", "") or "",
        "source_module":  getattr(inv, "source_module", "manual") or "manual",
        "source_id":      getattr(inv, "source_id", None),
    }

    if with_lines:
        try:
            lines = InvoiceLine.objects.filter(invoice=inv).select_related("vehicle_type")
            data["lines"] = [
                {
                    "id":           line.id,
                    "description":  getattr(line, "description", "") or (
                        getattr(getattr(line, "vehicle_type", None), "name", "") or "Service"
                    ),
                    "vehicle_type": getattr(getattr(line, "vehicle_type", None), "name", ""),
                    "quantity":     getattr(line, "quantity", 0),
                    "unit_price":   float(getattr(line, "unit_price", 0) or 0),
                    "total":        float(getattr(line, "total_amount", 0) or 0),
                }
                for line in lines
            ]
        except Exception:
            data["lines"] = []

    # ── Email log (most recent attempt) ──────────────────────────────────
    try:
        if InvoiceEmailLog is not None:
            log = InvoiceEmailLog.objects.filter(invoice=inv).order_by('-sent_at').first()
            if log:
                data["email_log"] = {
                    "recipient":      log.recipient,
                    "sent_at":        log.sent_at.isoformat(),
                    "success":        log.success,
                    "failure_reason": log.failure_reason or "",
                }
            else:
                data["email_log"] = None
        else:
            data["email_log"] = None
    except Exception:
        data["email_log"] = None

    if with_transactions:
        try:
            txns = inv.transactions.select_related("customer", "vehicle", "vehicle_type").all()
            data["transactions"] = [
                {
                    "id":             t.id,
                    "vehicle_plate":  getattr(getattr(t, "vehicle", None), "number_plate", ""),
                    "vehicle_type":   getattr(getattr(t, "vehicle_type", None), "name", ""),
                    "net_weight":     t.net_weight or 0,
                    "weight_type":    t.weight_type,
                    "payment_mode":   t.payment_mode,
                    "payment_status": t.payment_status,
                    "charge":         float(t.charge or 0),
                    "destination":    t.destination,
                    "created_at":     t.created_at.isoformat() if hasattr(t, "created_at") else None,
                }
                for t in txns
            ]
        except Exception:
            data["transactions"] = []

    return data


def create_draft_invoice_for_transaction(tx):
    """
    Create a draft invoice linked to a completed weighbridge transaction.
    Skips if:
    - payment models are not available
    - the transaction already has an auto_invoice set
    - the transaction is already linked to any non-void Invoice via the M2M
    - the transaction charge is zero or negative (nothing to bill)
    Returns the created Invoice or None.
    """
    try:
        if not HAS_PAYMENT_MODELS:
            return None
        # Skip if already invoiced via auto_invoice FK
        if getattr(tx, 'auto_invoice_id', None):
            return None
        # Skip if any non-void invoice is already linked via the M2M relationship
        try:
            existing = Invoice.objects.filter(
                transactions=tx
            ).exclude(status='void').first()
            if existing:
                return None
        except Exception:
            pass
        # Skip zero-charge transactions — nothing to bill
        if float(tx.charge or 0) <= 0:
            return None

        total = float(tx.charge or 0)
        inv = Invoice.objects.create(
            customer=tx.customer,
            total_amount=total,
            currency='KES',
            status='draft',
            source_module='weighbridge',
            source_id=tx.id,
            notes=f"Auto-generated for transaction TX-{tx.id:05d}",
        )
        inv.transactions.add(tx)

        # Create a single InvoiceLine
        vt = getattr(tx, 'vehicle_type', None)
        desc = vt.name if vt else 'Weighbridge Charge'
        InvoiceLine.objects.create(
            invoice=inv,
            vehicle_type=vt,
            description=desc,
            quantity=1,
            unit_price=total,
            total_amount=total,
        )

        # Link back
        tx.auto_invoice = inv
        tx.invoiced = True
        tx.save(update_fields=["auto_invoice", "invoiced", "updated_at"])

        return inv
    except Exception:
        return None



# ── Views ─────────────────────────────────────────────────────────────────────

class InvoiceListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"count": 0, "next": None, "previous": None, "results": []})
        qs = Invoice.objects.select_related("customer").order_by("-issued_date")
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if q := request.query_params.get("search"):
            from django.db.models import Q
            qs = qs.filter(
                Q(invoice_number__icontains=q) |
                Q(customer__name__icontains=q)
            )
        if cust := request.query_params.get("customer_id"):
            qs = qs.filter(customer_id=cust)
        data = [_serialize_invoice(inv) for inv in qs[:200]]
        return Response({"count": len(data), "next": None, "previous": None, "results": data})

    def post(self, request):
        """
        Manual invoice creation — no transaction required.
        Body: { customer_id, line_items: [{description, qty, unit_price}],
                currency, due_date, notes, source_module }
        """
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Payment models not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        customer_id   = request.data.get("customer_id")
        line_items    = request.data.get("line_items", [])
        currency      = request.data.get("currency", "KES")
        due_date      = request.data.get("due_date")
        notes         = request.data.get("notes", "")
        source_module = request.data.get("source_module", "manual")

        if not customer_id:
            return Response({"error": "customer_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not line_items:
            return Response({"error": "line_items must not be empty."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            customer = Customer.objects.get(pk=customer_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=status.HTTP_404_NOT_FOUND)

        # Calculate total
        total = 0.0
        for item in line_items:
            qty = float(item.get("qty", item.get("quantity", 1)) or 1)
            unit_price = float(item.get("unit_price", 0) or 0)
            total += qty * unit_price

        inv = Invoice.objects.create(
            customer=customer,
            total_amount=total,
            currency=currency,
            due_date=due_date or (timezone.now() + timedelta(days=30)).date(),
            status='draft',
            notes=notes,
            source_module=source_module,
        )

        for item in line_items:
            qty = float(item.get("qty", item.get("quantity", 1)) or 1)
            unit_price = float(item.get("unit_price", 0) or 0)
            line_total = qty * unit_price
            InvoiceLine.objects.create(
                invoice=inv,
                description=item.get("description", "Service"),
                quantity=int(qty),
                unit_price=unit_price,
                total_amount=line_total,
            )

        return Response(_serialize_invoice(inv, with_lines=True), status=status.HTTP_201_CREATED)



class InvoiceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = Invoice.objects.select_related("customer").get(pk=pk)
            return Response(_serialize_invoice(inv, with_lines=True, with_transactions=True))
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

    def patch(self, request, pk):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = Invoice.objects.get(pk=pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        allowed = ["notes", "due_date", "currency"]
        for field in allowed:
            if field in request.data:
                setattr(inv, field, request.data[field])
        inv.save()
        return Response(_serialize_invoice(inv))


class IssueInvoiceView(APIView):
    """POST /api/payments/invoices/<pk>/issue/ — move draft → issued"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = Invoice.objects.select_related("customer").get(pk=pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        if inv.status not in ("draft", "Draft", "Pending"):
            return Response(
                {"error": f"Cannot issue invoice with status '{inv.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        inv.status    = "issued"
        inv.issued_at = timezone.now()
        if not inv.due_date:
            inv.due_date = (timezone.now() + timedelta(days=30)).date()
        inv.save(update_fields=["status", "issued_at", "due_date"])

        # ── Email notification ────────────────────────────────────────────────
        # Send only when the customer has an email address. A missing/
        # misconfigured SMTP setup must never break invoice issuance.
        customer = getattr(inv, "customer", None)
        customer_email = getattr(customer, "email", None) if customer else None
        if customer_email:
            _email_success = False
            _email_failure = None
            try:
                from django.core.mail import EmailMultiAlternatives
                from django.template.loader import render_to_string
                from django.conf import settings

                invoice_number = inv.invoice_number or f"INV-{inv.id:04d}"
                platform_name  = getattr(settings, "PLATFORM_NAME", "SL-ERP Platform")
                inv_currency   = inv.currency or "KES"
                due_date_str   = str(inv.due_date) if inv.due_date else "30 days from today"
                customer_name  = getattr(customer, "name", "Customer")

                subject = f"Invoice {invoice_number} — Payment Due"

                plain_body = (
                    f"Dear {customer_name},\n\n"
                    f"Invoice {invoice_number} has been issued for your account.\n\n"
                    f"Total amount due: {inv_currency} {float(inv.total_amount or 0):,.2f}\n"
                    f"Due date: {due_date_str}\n\n"
                    f"Please arrange payment by the due date. Contact us if you have any questions.\n\n"
                    f"— {platform_name}"
                )

                html_body = render_to_string("emails/invoice_issued.html", {
                    "customer_name":  customer_name,
                    "invoice_number": invoice_number,
                    "total_amount":   f"{float(inv.total_amount or 0):,.2f}",
                    "currency":       inv_currency,
                    "due_date":       due_date_str,
                    "platform_name":  platform_name,
                })

                msg = EmailMultiAlternatives(
                    subject=subject,
                    body=plain_body,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    to=[customer_email],
                )
                msg.attach_alternative(html_body, "text/html")
                msg.send(fail_silently=False)
                _email_success = True
                logger.info(
                    "Invoice issued email sent to %s for invoice %s",
                    customer_email, invoice_number,
                )
            except Exception as exc:
                # Log the failure but never surface it as an API error
                _email_failure = str(exc)
                logger.warning(
                    "Failed to send invoice issued email to %s for invoice %s: %s",
                    customer_email, inv.invoice_number or inv.id, exc,
                )
            # ── Persist email send result ──────────────────────────────────────
            try:
                if InvoiceEmailLog is not None:
                    InvoiceEmailLog.objects.create(
                        invoice=inv,
                        recipient=customer_email,
                        success=_email_success,
                        failure_reason=_email_failure,
                    )
            except DatabaseError as log_exc:
                logger.warning("Could not write InvoiceEmailLog for invoice %s: %s", inv.id, log_exc)

        return Response(_serialize_invoice(inv))


class ReceivePaymentView(APIView):
    """POST /api/payments/invoices/<pk>/receive-payment/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        amount       = request.data.get("amount")
        method_id    = request.data.get("method")
        reference    = request.data.get("reference", "")

        # Resolve payment_mode:
        # 1. Explicit payment_mode string from client is always preferred.
        # 2. If absent, resolve from method ID via DB (not a hardcoded map).
        # 3. Fall back to "Cash".
        payment_mode = (request.data.get("payment_mode") or "").strip()
        if not payment_mode and method_id is not None:
            try:
                pm = PaymentMethod.objects.get(pk=int(method_id))
                payment_mode = pm.name
            except Exception:
                payment_mode = ""
        if not payment_mode:
            payment_mode = "Cash"

        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = Invoice.objects.prefetch_related("transactions").get(pk=pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        inv.status = "paid"
        inv.save(update_fields=["status"])

        # Mark linked transactions as paid
        try:
            inv.transactions.filter(payment_status="Pending").update(
                payment_status="Paid",
                payment_mode=payment_mode,
            )
        except Exception:
            pass

        return Response({
            "success":        True,
            "message":        f"Payment of {amount} received for invoice {pk}.",
            "invoice_id":     pk,
            "invoice_number": inv.invoice_number,
            "payment_mode":   payment_mode,
            "reference":      reference,
            "invoice_status": inv.status,
        })


class ConfirmPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        gateway_reference = request.data.get("gateway_reference", "")
        confirmed_amount  = request.data.get("confirmed_amount")
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv        = Invoice.objects.get(pk=pk)
            inv.status = "paid"
            inv.save(update_fields=["status"])
            return Response({
                "success":           True,
                "message":           f"Payment confirmed for invoice {pk}.",
                "gateway_reference": gateway_reference,
                "confirmed_amount":  confirmed_amount,
                "invoice_status":    inv.status,
            })
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)


class PaymentMethodListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if HAS_PAYMENT_METHOD_MODEL:
            try:
                methods = [
                    {"id": m.id, "name": m.name, "is_active": getattr(m, "is_active", True)}
                    for m in PaymentMethod.objects.all()
                ]
                return Response(methods)
            except Exception:
                pass
        return Response([
            {"id": 1, "name": "Cash",         "is_active": True},
            {"id": 2, "name": "Mpesa",         "is_active": True},
            {"id": 3, "name": "Bank Deposit",  "is_active": True},
            {"id": 4, "name": "Debt",          "is_active": True},
        ])


class PaymentEntriesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if HAS_PAYMENT_MODELS:
            try:
                from SL_Weighbridge.models import Payment
                qs = Payment.objects.select_related("invoice").order_by("-created_at")
                data = [
                    {
                        "id":           p.id,
                        "invoice_id":   p.invoice_id,
                        "amount":       float(getattr(p, "amount", 0) or 0),
                        "payment_mode": getattr(p, "payment_mode", ""),
                        "reference":    getattr(p, "reference", ""),
                        "created_at":   p.created_at.isoformat() if hasattr(p, "created_at") else None,
                    }
                    for p in qs[:100]
                ]
                return Response({"count": len(data), "results": data})
            except (ImportError, Exception):
                pass
        return Response({"count": 0, "results": []})


class ProviderCapabilitiesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        capabilities = []
        try:
            from Platform_Core.models import IntegrationEndpoint
            for gw in IntegrationEndpoint.objects.filter(integration_type="payment_gateway", is_active=True):
                capabilities.append({
                    "id":                   gw.id,
                    "name":                 gw.name,
                    "provider":             gw.provider,
                    "transport":            gw.transport,
                    "is_primary":           gw.is_primary,
                    "supports_callback":    True,
                    "supports_initiation":  True,
                })
        except Exception:
            pass
        if not capabilities:
            capabilities = [
                {"id": None, "name": "Cash",        "provider": "manual",    "is_primary": True,  "supports_callback": False},
                {"id": None, "name": "Mpesa",        "provider": "safaricom", "is_primary": False, "supports_callback": True},
                {"id": None, "name": "Bank Deposit", "provider": "manual",    "is_primary": False, "supports_callback": False},
            ]
        return Response({"capabilities": capabilities})


class PaymentSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        summary = {
            "total_invoiced": 0.0,
            "total_received": 0.0,
            "outstanding":    0.0,
            "invoices_by_status": [
                {"status": "draft",  "count": 0, "total": 0.0},
                {"status": "issued", "count": 0, "total": 0.0},
                {"status": "paid",   "count": 0, "total": 0.0},
            ],
        }
        if HAS_PAYMENT_MODELS:
            try:
                inv_qs = Invoice.objects.all()
                for row in summary["invoices_by_status"]:
                    matching = list(inv_qs.filter(status=row["status"]))
                    row["count"] = len(matching)
                    row["total"] = float(sum(i.total_amount or 0 for i in matching))
                summary["total_invoiced"] = sum(
                    r["total"] for r in summary["invoices_by_status"] if r["status"] in ("issued", "paid")
                )
                summary["total_received"] = next(
                    (r["total"] for r in summary["invoices_by_status"] if r["status"] == "paid"), 0.0
                )
                summary["outstanding"] = summary["total_invoiced"] - summary["total_received"]
            except Exception:
                pass
        return Response(summary)


class GenerateInvoiceView(APIView):
    """
    POST /api/payments/invoices/generate/
    Body: { customer_id, transaction_ids: [...], due_days: 30, currency: 'KES', notes: '' }
    Creates an invoice for the given completed, uninvoiced transactions.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Payment models not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        customer_id     = request.data.get("customer_id")
        transaction_ids = request.data.get("transaction_ids", [])
        due_days        = int(request.data.get("due_days", 30))
        currency        = request.data.get("currency", "KES")
        notes           = request.data.get("notes", "")

        if not customer_id:
            return Response({"error": "customer_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not transaction_ids:
            return Response({"error": "transaction_ids must not be empty."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            customer = Customer.objects.get(pk=customer_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=status.HTTP_404_NOT_FOUND)

        txns = Transaction.objects.filter(
            id__in=transaction_ids,
            customer=customer,
            status="Completed",
            invoiced=False,
        ).select_related("vehicle_type")

        found_ids = set(txns.values_list("id", flat=True))
        bad_ids   = [i for i in transaction_ids if i not in found_ids]
        if bad_ids:
            return Response(
                {"error": f"Transactions {bad_ids} are invalid (not found, wrong customer, not completed, or already invoiced)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Total from charges
        total = float(sum(t.charge or 0 for t in txns))

        # Create invoice
        inv = Invoice.objects.create(
            customer=customer,
            total_amount=total,
            currency=currency,
            due_date=(timezone.now() + timedelta(days=due_days)).date(),
            status='draft',
            notes=notes,
            source_module='weighbridge',
        )
        inv.transactions.set(txns)

        # Build InvoiceLine records grouped by vehicle_type
        from collections import defaultdict
        vt_groups = defaultdict(lambda: {"qty": 0, "total": 0.0, "vt": None})
        for t in txns:
            key = t.vehicle_type_id if t.vehicle_type_id else 0
            vt_groups[key]["qty"]   += 1
            vt_groups[key]["total"] += float(t.charge or 0)
            vt_groups[key]["vt"]     = t.vehicle_type

        for key, g in vt_groups.items():
            if g["vt"]:
                unit_price = g["total"] / g["qty"] if g["qty"] else 0
                InvoiceLine.objects.create(
                    invoice=inv,
                    vehicle_type=g["vt"],
                    description=g["vt"].name,
                    quantity=g["qty"],
                    unit_price=unit_price,
                    total_amount=g["total"],
                )

        # Mark transactions as invoiced
        txns.update(invoiced=True)

        return Response(_serialize_invoice(inv, with_lines=True, with_transactions=True), status=status.HTTP_201_CREATED)


class UninvoicedTransactionsView(APIView):
    """
    GET /api/payments/uninvoiced-transactions/?customer_id=<id>
    Returns completed, uninvoiced transactions for a customer (for the generate dialog).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"results": [], "count": 0})
        qs = Transaction.objects.filter(
            status="Completed",
            invoiced=False,
        ).select_related("customer", "vehicle", "vehicle_type")
        if cust := request.query_params.get("customer_id"):
            qs = qs.filter(customer_id=cust)
        data = [
            {
                "id":            t.id,
                "vehicle_plate": getattr(getattr(t, "vehicle", None), "number_plate", ""),
                "vehicle_type":  getattr(getattr(t, "vehicle_type", None), "name", ""),
                "net_weight":    t.net_weight or 0,
                "weight_type":   t.weight_type,
                "payment_mode":  t.payment_mode,
                "destination":   t.destination,
                "charge":        float(t.charge or 0),
                "currency":      "KES",
                "created_at":    t.created_at.isoformat() if hasattr(t, "created_at") else None,
            }
            for t in qs.order_by("-created_at")[:500]
        ]
        return Response({"results": data, "count": len(data)})


class CustomerListForInvoiceView(APIView):
    """GET /api/payments/customers/ — lightweight list for the generate-invoice dropdown."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"results": []})
        qs = Customer.objects.all().order_by("name")
        if q := request.query_params.get("search"):
            qs = qs.filter(name__icontains=q)
        data = [{"id": c.id, "name": c.name, "email": c.email or "", "phone": c.phone_number or ""} for c in qs[:200]]
        return Response({"results": data})


class DebtSummaryView(APIView):
    """
    GET /api/payments/debt/
    Returns customers with outstanding Debt transactions, grouped with totals.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"results": [], "count": 0})

        from django.db.models import Sum, Min, Count
        from django.db.models import Q

        qs = Transaction.objects.filter(
            payment_mode="Debt",
            payment_status="Pending",
            status="Completed",
        ).select_related("customer").values(
            "customer__id", "customer__name", "customer__email", "customer__phone_number"
        ).annotate(
            total_owed=Sum("charge"),
            transaction_count=Count("id"),
            oldest_date=Min("created_at"),
        ).order_by("-total_owed")

        results = [
            {
                "customer_id":       row["customer__id"],
                "customer_name":     row["customer__name"],
                "customer_email":    row["customer__email"] or "",
                "customer_phone":    row["customer__phone_number"] or "",
                "total_owed":        float(row["total_owed"] or 0),
                "transaction_count": row["transaction_count"],
                "oldest_date":       row["oldest_date"].isoformat() if row["oldest_date"] else None,
            }
            for row in qs
        ]
        return Response({"results": results, "count": len(results)})


class DebtConsolidateView(APIView):
    """
    POST /api/payments/debt/consolidate/
    Body: { customer_id, currency?, notes? }
    Creates one invoice from all outstanding debt transactions for the customer.
    Returns the invoice and a shareable token URL.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Payment models not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        customer_id = request.data.get("customer_id")
        currency    = request.data.get("currency", "KES")
        notes       = request.data.get("notes", "")

        if not customer_id:
            return Response({"error": "customer_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            customer = Customer.objects.get(pk=customer_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=status.HTTP_404_NOT_FOUND)

        txns = Transaction.objects.filter(
            customer=customer,
            payment_mode="Debt",
            payment_status="Pending",
            status="Completed",
        ).select_related("vehicle_type")

        if not txns.exists():
            return Response({"error": "No outstanding debt transactions for this customer."}, status=status.HTTP_400_BAD_REQUEST)

        total = float(sum(t.charge or 0 for t in txns))

        inv = Invoice.objects.create(
            customer=customer,
            total_amount=total,
            currency=currency,
            due_date=timezone.now().date(),
            status='draft',
            notes=notes or f"Debt consolidation invoice for {customer.name}",
            source_module='weighbridge',
        )
        inv.transactions.set(txns)

        # Build InvoiceLines grouped by vehicle_type
        from collections import defaultdict
        vt_groups = defaultdict(lambda: {"qty": 0, "total": 0.0, "vt": None, "desc": ""})
        for t in txns:
            key = t.vehicle_type_id if t.vehicle_type_id else 0
            vt_groups[key]["qty"]   += 1
            vt_groups[key]["total"] += float(t.charge or 0)
            vt_groups[key]["vt"]     = t.vehicle_type
            vt_groups[key]["desc"]   = t.vehicle_type.name if t.vehicle_type else "Weighbridge Charge"

        for key, g in vt_groups.items():
            unit_price = g["total"] / g["qty"] if g["qty"] else 0
            InvoiceLine.objects.create(
                invoice=inv,
                vehicle_type=g["vt"],
                description=g["desc"],
                quantity=g["qty"],
                unit_price=unit_price,
                total_amount=g["total"],
            )

        # Generate a signed shareable token
        from django.core import signing
        token = signing.dumps({"invoice_id": inv.id}, salt="invoice-share")

        # Public payment URL — token-validated, no login required
        public_pay_path = f"/api/payments/invoices/pay/{token}/"
        payment_url = request.build_absolute_uri(public_pay_path)

        # ── Email notification ────────────────────────────────────────────────
        # Send only when the customer has an email address. A missing/
        # misconfigured SMTP setup must never break invoice creation.
        customer_email = getattr(customer, "email", None)
        if customer_email:
            _email_success = False
            _email_failure = None
            try:
                from django.core.mail import EmailMultiAlternatives
                from django.template.loader import render_to_string
                from django.conf import settings

                invoice_number = inv.invoice_number or f"INV-{inv.id:04d}"
                platform_name  = getattr(settings, "PLATFORM_NAME", "SL-ERP Platform")
                inv_currency   = inv.currency or "KES"

                subject = f"Invoice {invoice_number} — Payment Link"

                plain_body = (
                    f"Dear {customer.name},\n\n"
                    f"Your outstanding weighbridge charges have been consolidated "
                    f"into invoice {invoice_number}.\n\n"
                    f"Total amount due: {inv_currency} {float(inv.total_amount or 0):,.2f}\n\n"
                    f"Pay here: {payment_url}\n\n"
                    f"If you have already made a payment or believe this invoice "
                    f"was sent in error, please contact us.\n\n"
                    f"— {platform_name}"
                )

                html_body = render_to_string("emails/debt_consolidation.html", {
                    "customer_name":  customer.name,
                    "invoice_number": invoice_number,
                    "total_amount":   f"{float(inv.total_amount or 0):,.2f}",
                    "currency":       inv_currency,
                    "payment_url":    payment_url,
                    "platform_name":  platform_name,
                })

                msg = EmailMultiAlternatives(
                    subject=subject,
                    body=plain_body,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    to=[customer_email],
                )
                msg.attach_alternative(html_body, "text/html")
                msg.send(fail_silently=False)
                _email_success = True
                logger.info(
                    "Debt consolidation payment email sent to %s for invoice %s",
                    customer_email, inv.invoice_number or inv.id,
                )
            except Exception as exc:
                # Log the failure but never surface it as an API error
                _email_failure = str(exc)
                logger.warning(
                    "Failed to send debt consolidation email to %s for invoice %s: %s",
                    customer_email, inv.invoice_number or inv.id, exc,
                )
            # ── Persist email send result ──────────────────────────────────────
            try:
                if InvoiceEmailLog is not None:
                    InvoiceEmailLog.objects.create(
                        invoice=inv,
                        recipient=customer_email,
                        success=_email_success,
                        failure_reason=_email_failure,
                    )
            except DatabaseError as log_exc:
                logger.warning("Could not write InvoiceEmailLog for invoice %s: %s", inv.id, log_exc)

        return Response({
            **_serialize_invoice(inv, with_lines=True, with_transactions=True),
            "share_path": public_pay_path,
            "share_token": token,
            "payment_url": payment_url,
        }, status=status.HTTP_201_CREATED)


class PublicInvoicePayView(APIView):
    """
    GET /api/payments/invoices/pay/<token>/
    Public endpoint — no authentication required.
    Validates the signed token and returns invoice details so the customer
    can review and pay without logging in to the ERP.
    """
    permission_classes = [AllowAny]

    def get(self, request, token):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        from django.core import signing

        try:
            payload = signing.loads(token, salt="invoice-share", max_age=86400 * 30)  # 30-day expiry
        except signing.SignatureExpired:
            return Response({"error": "This payment link has expired."}, status=status.HTTP_410_GONE)
        except signing.BadSignature:
            return Response({"error": "Invalid payment link."}, status=status.HTTP_400_BAD_REQUEST)

        invoice_id = payload.get("invoice_id")
        if not invoice_id:
            return Response({"error": "Invalid payment link."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            inv = Invoice.objects.select_related("customer").get(pk=invoice_id)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        data = _serialize_invoice(inv, with_lines=True)
        data["token"] = token  # echo back so the client can POST to confirm payment
        return Response(data)
