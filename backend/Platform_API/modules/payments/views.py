import logging
import csv
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import DatabaseError
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    apply_tenant_filter,
    resolve_user_tenant,
)

logger = logging.getLogger(__name__)

try:
    from Platform_Core.integrations import list_payment_gateway_capabilities
    from Platform_Core.models import Tenant
    from Platform_Core.accounting import assert_posting_allowed, sync_invoice_posting, sync_payment_posting
    from Platform_Core.documents import render_invoice_document
    from Platform_Core.platform import get_active_tenant_module_slugs
except ImportError:
    Tenant = None
    list_payment_gateway_capabilities = None
    assert_posting_allowed = None
    sync_invoice_posting = None
    sync_payment_posting = None
    render_invoice_document = None
    get_active_tenant_module_slugs = None

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

try:
    from SL_Weighbridge.models import Payment
    HAS_PAYMENT_ENTRY_MODEL = True
except ImportError:
    Payment = None
    HAS_PAYMENT_ENTRY_MODEL = False


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


def _resolve_payment_tenant(request):
    resolved = resolve_user_tenant(request.user)
    if resolved is not None and resolved is not NO_TENANT_ACCESS:
        return resolved
    if resolved is NO_TENANT_ACCESS:
        return None

    tenant_id = request.query_params.get("tenant_id")
    tenant_code = request.query_params.get("tenant_code")
    if request.user.is_superuser and Tenant is not None and (tenant_id or tenant_code):
        lookup = {}
        if tenant_id:
            lookup["pk"] = tenant_id
        else:
            lookup["code"] = tenant_code
        return Tenant.objects.filter(**lookup).first()

    return None


def _resolve_owner_billing_tenant():
    if Tenant is None:
        return None
    owner_codes = [code for code in {getattr(settings, "DEFAULT_TENANT_CODE", ""), "siakora-labs"} if code]
    if owner_codes:
        tenant = Tenant.objects.filter(code__in=owner_codes, is_active=True).order_by("name").first()
        if tenant is not None:
            return tenant
    return Tenant.objects.filter(is_active=True).order_by("name").first()


def _scoped_customer_queryset(request):
    resolved = resolve_user_tenant(request.user)
    qs = Customer.objects.all()
    if resolved is None:
        return qs
    if resolved is NO_TENANT_ACCESS:
        if getattr(request.user, "is_staff", False):
            return qs.filter(tenant__isnull=True)
        return qs.none()
    return qs.filter(
        Q(tenant=resolved)
        | Q(tenant__isnull=True)
        | Q(tenant__isnull=True, transaction__tenant=resolved)
    ).distinct()


def _scoped_invoice_queryset(request, qs=None):
    resolved = resolve_user_tenant(request.user)
    if qs is None:
        qs = Invoice.objects.all()
    if resolved is None:
        return qs
    if resolved is NO_TENANT_ACCESS:
        if getattr(request.user, "is_staff", False):
            return qs.filter(tenant__isnull=True)
        return qs.none()
    return qs.filter(
        Q(tenant=resolved)
        | Q(tenant__isnull=True, customer__tenant=resolved)
        | Q(tenant__isnull=True, transactions__tenant=resolved)
    ).distinct()


def reconcile_invoice_payment_state(invoice, *, persist=False):
    """
    Compute trustworthy paid/balance values for an invoice from real payment
    evidence where available.

    Priority:
    1. Explicit Payment entries, if the deployment has that model.
    2. Linked transaction payment states for transaction-backed invoices.
    3. Invoice status fallback for modules that do not track granular payments.
    """
    total_amount = Decimal(str(getattr(invoice, "total_amount", 0) or 0))
    paid_amount = Decimal("0.00")

    if HAS_PAYMENT_ENTRY_MODEL and Payment is not None:
        try:
            successful_statuses = {"confirmed", "paid", "success", "completed"}
            payment_total = Decimal("0.00")
            for payment in Payment.objects.filter(invoice=invoice):
                payment_status = (getattr(payment, "status", "") or "").strip().lower()
                if not payment_status or payment_status in successful_statuses:
                    payment_total += Decimal(str(getattr(payment, "amount", 0) or 0))
            paid_amount = payment_total
        except Exception:
            paid_amount = Decimal("0.00")

    if paid_amount <= 0:
        try:
            txs = list(invoice.transactions.all())
        except Exception:
            txs = []
        if txs:
            paid_amount = sum(
                Decimal(str(getattr(tx, "charge", 0) or 0))
                for tx in txs
                if (getattr(tx, "payment_status", "") or "").strip() == "Paid"
            )
        elif (getattr(invoice, "status", "") or "").strip().lower() == "paid":
            paid_amount = total_amount

    paid_amount = min(max(paid_amount, Decimal("0.00")), total_amount)
    balance_amount = max(total_amount - paid_amount, Decimal("0.00"))

    current_status = (getattr(invoice, "status", "") or "").strip().lower()
    due_date = getattr(invoice, "due_date", None)
    is_overdue = bool(due_date and due_date < timezone.now().date())

    if total_amount > 0 and balance_amount == Decimal("0.00"):
        effective_status = "paid"
    elif getattr(invoice, "issued_at", None) or current_status in {"issued", "overdue", "paid"}:
        effective_status = "overdue" if is_overdue else "issued"
    else:
        effective_status = "draft"

    if persist:
        update_fields = []
        if getattr(invoice, "status", None) != effective_status:
            invoice.status = effective_status
            update_fields.append("status")
        if effective_status in {"issued", "paid"} and getattr(invoice, "issued_at", None) is None:
            invoice.issued_at = timezone.now()
            update_fields.append("issued_at")
        if update_fields:
            invoice.save(update_fields=update_fields)

    return {
        "total_amount": total_amount,
        "paid_amount": paid_amount,
        "balance_amount": balance_amount,
        "status": effective_status,
    }


def create_draft_invoice_for_transaction(tx):
    """
    Create a draft invoice linked to a completed weighbridge transaction.
    Skips if:
    - payment models are not available
    - the tenant does not have billing/invoicing enabled
    - the transaction already has an auto_invoice set
    - the transaction is already linked to any non-void Invoice via the M2M
    - the transaction charge is zero or negative (nothing to bill)
    Returns the created Invoice or None.
    """
    try:
        if not HAS_PAYMENT_MODELS:
            return None
        tenant = getattr(tx, "tenant", None)
        if tenant is not None and get_active_tenant_module_slugs is not None:
            active_module_slugs = get_active_tenant_module_slugs(tenant)
            if active_module_slugs and not active_module_slugs.intersection({"billing", "invoicing"}):
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
            tenant=tenant,   # inherit tenant from transaction
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

    @staticmethod
    def _get_user_tenant(request):
        """
        Return the requesting user's Tenant, or None for superusers.

        Returns None for both superusers (global access) and for profileless
        non-superusers (callers must use _apply_invoice_tenant_filter for
        proper deny-all behaviour in the profileless case).
        """
        resolved = resolve_user_tenant(request.user)
        if resolved is NO_TENANT_ACCESS:
            return None
        return resolved

    @staticmethod
    def _apply_invoice_tenant_filter(request, qs):
        """
        Three-state queryset filter for Invoice tables:
        - Superuser               → unfiltered (global access)
        - Non-superuser w/ profile → filtered by tenant FK
        - Non-superuser w/o profile → qs.none() (deny-all)
        """
        return _scoped_invoice_queryset(request, qs)

    @staticmethod
    def _apply_transaction_tenant_filter(request, qs):
        """
        Three-state queryset filter for Transaction tables (payments context).
        - Superuser               → unfiltered
        - Non-superuser w/ profile → filtered by tenant FK
        - Non-superuser w/o profile → qs.none() (deny-all)
        """
        resolved = resolve_user_tenant(request.user)
        if resolved is None:
            return qs
        if resolved is NO_TENANT_ACCESS:
            if getattr(request.user, "is_staff", False):
                return qs.filter(tenant__isnull=True)
            return qs.none()
        return qs.filter(tenant=resolved)

    def get(self, request):
        if not HAS_PAYMENT_MODELS:
            return Response({"count": 0, "next": None, "previous": None, "results": []})

        user_tenant = self._get_user_tenant(request)

        # ── Default tenant scoping ────────────────────────────────────────────
        # Profileless non-superusers: deny-all via _apply_invoice_tenant_filter.
        # Profiled non-superusers: param check then tenant-scoped queryset.
        # Superusers: unfiltered global access.
        if user_tenant is not None:
            tenant_code_param = request.query_params.get("tenant_code")
            if tenant_code_param and tenant_code_param != user_tenant.code:
                return Response({"count": 0, "next": None, "previous": None, "results": []})

        qs = Invoice.objects.select_related("customer").order_by("-issued_date")
        qs = self._apply_invoice_tenant_filter(request, qs)

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
            customer = _scoped_customer_queryset(request).get(pk=customer_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=status.HTTP_404_NOT_FOUND)

        # Calculate total
        total = 0.0
        for item in line_items:
            qty = float(item.get("qty", item.get("quantity", 1)) or 1)
            unit_price = float(item.get("unit_price", 0) or 0)
            total += qty * unit_price

        user_tenant = self._get_user_tenant(request)
        inv = Invoice.objects.create(
            customer=customer,
            total_amount=total,
            currency=currency,
            due_date=due_date or (timezone.now() + timedelta(days=30)).date(),
            status='draft',
            notes=notes,
            source_module=source_module,
            tenant=user_tenant,
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

    def _get_invoice(self, request, pk):
        """
        Fetch an invoice by PK, enforcing tenant isolation.

        - Superusers: access any invoice globally
        - Profiled non-superusers: only invoices in their own tenant (others → 404)
        - Profileless non-superusers: deny-all → qs.none() → always 404
        """
        qs = InvoiceListView._apply_invoice_tenant_filter(
            request, Invoice.objects.select_related("customer")
        )
        return qs.get(pk=pk)

    def get(self, request, pk):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = self._get_invoice(request, pk)
            return Response(_serialize_invoice(inv, with_lines=True, with_transactions=True))
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

    def patch(self, request, pk):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = self._get_invoice(request, pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        allowed = ["notes", "due_date", "currency"]
        for field in allowed:
            if field in request.data:
                setattr(inv, field, request.data[field])
        inv.save()
        return Response(_serialize_invoice(inv))


class InvoiceDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not HAS_PAYMENT_MODELS or render_invoice_document is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            inv = InvoiceDetailView()._get_invoice(request, pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        rendered = render_invoice_document(
            inv,
            request=request,
        )
        return HttpResponse(rendered.html, content_type="text/html; charset=utf-8")


class IssueInvoiceView(APIView):
    """POST /api/payments/invoices/<pk>/issue/ — move draft → issued"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            qs = InvoiceListView._apply_invoice_tenant_filter(
                request, Invoice.objects.select_related("customer")
            )
            inv = qs.get(pk=pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        if inv.status not in ("draft", "Draft", "Pending"):
            return Response(
                {"error": f"Cannot issue invoice with status '{inv.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if assert_posting_allowed is not None:
            try:
                assert_posting_allowed(
                    tenant=getattr(inv, "tenant", None),
                    posting_date=timezone.now(),
                    source_label="invoice issue",
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        inv.status    = "issued"
        inv.issued_at = timezone.now()
        if not inv.due_date:
            inv.due_date = (timezone.now() + timedelta(days=30)).date()
        inv.save(update_fields=["status", "issued_at", "due_date"])
        if sync_invoice_posting is not None:
            try:
                sync_invoice_posting(inv)
            except Exception:
                logger.exception("Failed to sync accounting entry for invoice %s", inv.pk)

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
            except Exception as log_exc:
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
            qs = InvoiceListView._apply_invoice_tenant_filter(
                request, Invoice.objects.prefetch_related("transactions")
            )
            inv = qs.get(pk=pk)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        if assert_posting_allowed is not None:
            try:
                assert_posting_allowed(
                    tenant=getattr(inv, "tenant", None),
                    posting_date=timezone.now(),
                    source_label="invoice payment",
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Mark linked transactions as paid
        try:
            inv.transactions.filter(payment_status="Pending").update(
                payment_status="Paid",
                payment_mode=payment_mode,
            )
        except Exception:
            pass

        # For manual or tenantless legacy invoices with no granular payment rows,
        # mark the invoice paid immediately when the receive-payment action succeeds.
        inv.status = "paid"
        if getattr(inv, "issued_at", None) is None:
            inv.issued_at = timezone.now()
        inv.save(update_fields=["status", "issued_at"])

        reconciliation = reconcile_invoice_payment_state(inv, persist=True)
        if sync_payment_posting is not None:
            try:
                sync_payment_posting(
                    invoice=inv,
                    payment_mode=payment_mode,
                    amount=amount or reconciliation["paid_amount"] or inv.total_amount,
                    reference=reference,
                )
            except Exception:
                logger.exception("Failed to sync payment posting for invoice %s", inv.pk)

        # ── Persist payment-received audit log ────────────────────────────────
        # A DatabaseError here (e.g. DB constraint, connection drop) must never
        # break the payment flow — the invoice is already marked paid above.
        try:
            if InvoiceEmailLog is not None:
                InvoiceEmailLog.objects.create(
                    invoice=inv,
                    recipient="",
                    success=True,
                    failure_reason=None,
                )
        except DatabaseError as log_exc:
            logger.warning("Could not write InvoiceEmailLog for invoice %s: %s", inv.id, log_exc)

        return Response({
            "success":        True,
            "message":        f"Payment of {amount} received for invoice {pk}.",
            "invoice_id":     pk,
            "invoice_number": inv.invoice_number,
            "payment_mode":   payment_mode,
            "reference":      reference,
            "invoice_status": inv.status,
            "paid_amount":    float(reconciliation["paid_amount"]),
            "balance_amount": float(reconciliation["balance_amount"]),
        })


class ConfirmPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        gateway_reference = request.data.get("gateway_reference", "")
        confirmed_amount  = request.data.get("confirmed_amount")
        if not HAS_PAYMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            qs  = InvoiceListView._apply_invoice_tenant_filter(request, Invoice.objects.all())
            inv = qs.get(pk=pk)
            if assert_posting_allowed is not None:
                try:
                    assert_posting_allowed(
                        tenant=getattr(inv, "tenant", None),
                        posting_date=timezone.now(),
                        source_label="confirmed invoice payment",
                    )
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            reconciliation = reconcile_invoice_payment_state(inv, persist=True)
            if sync_payment_posting is not None:
                try:
                    sync_payment_posting(
                        invoice=inv,
                        payment_mode=request.data.get("payment_mode", "Card"),
                        amount=confirmed_amount or reconciliation["paid_amount"] or inv.total_amount,
                        reference=gateway_reference,
                    )
                except Exception:
                    logger.exception("Failed to sync confirmed payment posting for invoice %s", inv.pk)
            return Response({
                "success":           True,
                "message":           f"Payment confirmed for invoice {pk}.",
                "gateway_reference": gateway_reference,
                "confirmed_amount":  confirmed_amount,
                "invoice_status":    inv.status,
                "paid_amount":       float(reconciliation["paid_amount"]),
                "balance_amount":    float(reconciliation["balance_amount"]),
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
            {"id": 3, "name": "Card",          "is_active": True},
            {"id": 4, "name": "Bank Transfer", "is_active": True},
            {"id": 5, "name": "Debt",          "is_active": True},
        ])


class PaymentEntriesView(APIView):
    permission_classes = [IsAuthenticated]

    def _build_entries(self, request):
        invoice_qs = InvoiceListView._apply_invoice_tenant_filter(
            request, Invoice.objects.select_related("customer").prefetch_related("transactions")
        )

        entries = []
        seen_invoice_ids = set()

        for inv in invoice_qs.filter(status="paid").order_by("-issued_date"):
            related_paid_tx = list(inv.transactions.filter(payment_status="Paid").order_by("-updated_at", "-id"))
            latest_paid_tx = related_paid_tx[0] if related_paid_tx else None
            entries.append(
                {
                    "entry_type": "invoice",
                    "id": inv.id,
                    "invoice_id": inv.id,
                    "invoice_number": inv.invoice_number or f"INV-{inv.id:04d}",
                    "transaction_id": latest_paid_tx.id if latest_paid_tx else None,
                    "customer_name": getattr(getattr(inv, "customer", None), "name", "") or "",
                    "amount": float(getattr(inv, "total_amount", 0) or 0),
                    "currency": getattr(inv, "currency", "KES") or "KES",
                    "payment_mode": getattr(latest_paid_tx, "payment_mode", "") if latest_paid_tx else "",
                    "reference": "",
                    "source_module": getattr(inv, "source_module", "manual") or "manual",
                    "created_at": (
                        latest_paid_tx.updated_at.isoformat()
                        if latest_paid_tx and getattr(latest_paid_tx, "updated_at", None)
                        else (inv.issued_at or inv.issued_date).isoformat() if (inv.issued_at or inv.issued_date) else None
                    ),
                }
            )
            seen_invoice_ids.add(inv.id)

        direct_tx_qs = InvoiceListView._apply_transaction_tenant_filter(
            request,
            Transaction.objects.select_related("customer")
            .filter(payment_status="Paid")
            .exclude(auto_invoice_id__isnull=False)
            .order_by("-updated_at", "-id"),
        )

        for tx in direct_tx_qs:
            entries.append(
                {
                    "entry_type": "transaction",
                    "id": tx.id,
                    "invoice_id": None,
                    "invoice_number": "",
                    "transaction_id": tx.id,
                    "customer_name": getattr(getattr(tx, "customer", None), "name", "") or "",
                    "amount": float(getattr(tx, "charge", 0) or 0),
                    "currency": getattr(getattr(tx, "tenant", None), "default_currency", "KES") or "KES",
                    "payment_mode": getattr(tx, "payment_mode", "") or "",
                    "reference": "",
                    "source_module": "weighbridge",
                    "created_at": tx.updated_at.isoformat() if getattr(tx, "updated_at", None) else None,
                }
            )

        entries.sort(key=lambda row: row.get("created_at") or "", reverse=True)
        return entries

    def get(self, request):
        if HAS_PAYMENT_MODELS:
            try:
                data = self._build_entries(request)
                if request.query_params.get("export") == "csv":
                    response = HttpResponse(content_type="text/csv")
                    response["Content-Disposition"] = 'attachment; filename="payments_export.csv"'
                    writer = csv.writer(response)
                    writer.writerow([
                        "Entry Type",
                        "Invoice Number",
                        "Transaction ID",
                        "Customer",
                        "Amount",
                        "Currency",
                        "Payment Mode",
                        "Reference",
                        "Source Module",
                        "Recorded At",
                    ])
                    for row in data:
                        writer.writerow([
                            row.get("entry_type", ""),
                            row.get("invoice_number", ""),
                            row.get("transaction_id", ""),
                            row.get("customer_name", ""),
                            row.get("amount", 0),
                            row.get("currency", "KES"),
                            row.get("payment_mode", ""),
                            row.get("reference", ""),
                            row.get("source_module", ""),
                            row.get("created_at", ""),
                        ])
                    return response
                return Response({"count": len(data), "results": data[:500]})
            except Exception:
                pass
        return Response({"count": 0, "results": []})


class ProviderCapabilitiesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _resolve_payment_tenant(request)
        payment_scope = request.query_params.get("payment_scope")
        resolved_via_owner = False
        capabilities = []

        if payment_scope == "saas_billing":
            owner_tenant = _resolve_owner_billing_tenant()
            if owner_tenant is not None and (tenant is None or owner_tenant.id != tenant.id):
                tenant = owner_tenant
                resolved_via_owner = True

        if list_payment_gateway_capabilities is not None and tenant is not None:
            try:
                capabilities = list_payment_gateway_capabilities(
                    tenant=tenant,
                    payment_scope=payment_scope,
                )
            except Exception:
                capabilities = []

        response = {
            "capabilities": capabilities,
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
                "code": tenant.code,
            } if tenant is not None else None,
            "requested_scope": payment_scope or None,
            "segregated": True,
            "resolved_via_owner": resolved_via_owner,
        }

        if request.user.is_superuser and tenant is None:
            response["message"] = (
                "Select a tenant to inspect payment providers. "
                "Pass ?tenant_id=<id> or ?tenant_code=<code>."
            )

        return Response(response)


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
                inv_qs = InvoiceListView._apply_invoice_tenant_filter(request, Invoice.objects.all())
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

        # Scope the transaction lookup to the requesting user's tenant.
        # This prevents a tenant user from referencing another tenant's
        # transaction IDs to trigger cross-tenant invoicing mutations.
        base_txns = InvoiceListView._apply_transaction_tenant_filter(
            request,
            Transaction.objects.filter(
                id__in=transaction_ids,
                customer=customer,
                status="Completed",
                invoiced=False,
            ).select_related("vehicle_type"),
        )
        txns = base_txns

        found_ids = set(txns.values_list("id", flat=True))
        bad_ids   = [i for i in transaction_ids if i not in found_ids]
        if bad_ids:
            return Response(
                {"error": f"Transactions {bad_ids} are invalid (not found, wrong customer, not completed, or already invoiced)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Total from charges
        total = float(sum(t.charge or 0 for t in txns))

        # Create invoice (inherit tenant from requesting user)
        user_tenant = InvoiceListView._get_user_tenant(request)
        inv = Invoice.objects.create(
            customer=customer,
            total_amount=total,
            currency=currency,
            due_date=(timezone.now() + timedelta(days=due_days)).date(),
            status='draft',
            notes=notes,
            source_module='weighbridge',
            tenant=user_tenant,
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
        qs = InvoiceListView._apply_transaction_tenant_filter(
            request,
            Transaction.objects.filter(
                status="Completed",
                invoiced=False,
            ).select_related("customer", "vehicle", "vehicle_type"),
        )
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
        resolved = resolve_user_tenant(request.user)
        qs = Customer.objects.all()
        if resolved is NO_TENANT_ACCESS:
            qs = qs.none()
        elif resolved is not None:
            qs = qs.filter(
                Q(tenant=resolved)
                | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()
        qs = qs.order_by("name")
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

        qs = InvoiceListView._apply_transaction_tenant_filter(
            request,
            Transaction.objects.filter(
                payment_mode="Debt",
                payment_status="Pending",
                status="Completed",
            ),
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

        # Scope to the requesting user's tenant — prevents cross-tenant
        # consolidation of debt transactions belonging to another tenant.
        txns = InvoiceListView._apply_transaction_tenant_filter(
            request,
            Transaction.objects.filter(
                customer=customer,
                payment_mode="Debt",
                payment_status="Pending",
                status="Completed",
            ).select_related("vehicle_type"),
        )

        if not txns.exists():
            return Response({"error": "No outstanding debt transactions for this customer."}, status=status.HTTP_400_BAD_REQUEST)

        total = float(sum(t.charge or 0 for t in txns))

        user_tenant = InvoiceListView._get_user_tenant(request)
        inv = Invoice.objects.create(
            customer=customer,
            total_amount=total,
            currency=currency,
            due_date=timezone.now().date(),
            status='draft',
            notes=notes or f"Debt consolidation invoice for {customer.name}",
            source_module='weighbridge',
            tenant=user_tenant,
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
            except Exception as log_exc:
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
