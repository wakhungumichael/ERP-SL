"""
Accounting module views.

Provides:
  - Dashboard: revenue + invoice KPIs from Weighbridge
  - Chart of Accounts: CRUD on Platform_Core.Account (tenant-scoped)
  - Transactions: list/create/detail on Platform_Core.JournalEntry + JournalEntryLine
"""
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

try:
    from SL_Weighbridge.models import Transaction, Invoice
    HAS_WEIGHBRIDGE = True
except ImportError:
    HAS_WEIGHBRIDGE = False

try:
    from Platform_Core.models import Account, Journal, JournalEntry, JournalEntryLine
    HAS_ACCOUNTING = True
except ImportError:
    HAS_ACCOUNTING = False


# ── Tenant isolation ──────────────────────────────────────────────────────────

class _NoTenantProfile:
    pass

_NO_PROFILE = _NoTenantProfile()


def _resolve_user_tenant(user):
    if user.is_superuser:
        return None
    try:
        p = user.tenant_profile
        if p and p.tenant:
            return p.tenant
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

class AccountSerializer(serializers.ModelSerializer):
    parent_name = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id", "tenant", "code", "name", "account_type",
            "parent", "parent_name", "is_active", "allow_posting",
            "children_count", "metadata", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "tenant", "parent_name", "children_count", "created_at", "updated_at"]

    def get_parent_name(self, obj):
        return obj.parent.name if obj.parent else None

    def get_children_count(self, obj):
        return obj.children.count()


class JournalEntryLineSerializer(serializers.ModelSerializer):
    account_name = serializers.SerializerMethodField()
    account_code = serializers.SerializerMethodField()

    class Meta:
        model = JournalEntryLine
        fields = [
            "id", "account", "account_code", "account_name",
            "description", "debit_amount", "credit_amount",
        ]
        read_only_fields = ["id", "account_code", "account_name"]

    def get_account_name(self, obj):
        return obj.account.name if obj.account else None

    def get_account_code(self, obj):
        return obj.account.code if obj.account else None


class JournalEntrySerializer(serializers.ModelSerializer):
    lines        = JournalEntryLineSerializer(many=True, read_only=True)
    journal_name = serializers.SerializerMethodField()
    debit_total  = serializers.SerializerMethodField()
    credit_total = serializers.SerializerMethodField()

    class Meta:
        model = JournalEntry
        fields = [
            "id", "tenant", "journal", "journal_name",
            "entry_number", "entry_date", "source_type", "source_reference",
            "memo", "status", "debit_total", "credit_total",
            "lines", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "entry_number", "journal_name",
            "debit_total", "credit_total", "created_at", "updated_at",
        ]

    def get_journal_name(self, obj):
        return obj.journal.name if obj.journal else None

    def get_debit_total(self, obj):
        return float(sum(l.debit_amount for l in obj.lines.all()))

    def get_credit_total(self, obj):
        return float(sum(l.credit_amount for l in obj.lines.all()))


class JournalEntryWriteSerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True, required=False)

    class Meta:
        model = JournalEntry
        fields = [
            "journal", "entry_date", "source_type",
            "source_reference", "memo", "status", "lines",
        ]

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        entry = JournalEntry.objects.create(**validated_data)
        for line in lines_data:
            JournalEntryLine.objects.create(entry=entry, **line)
        return entry

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            for line in lines_data:
                JournalEntryLine.objects.create(entry=instance, **line)
        return instance


# ── Dashboard ─────────────────────────────────────────────────────────────────

class AccountingDashboardView(APIView):
    """
    GET /api/accounting/dashboard/
    Financial summary from completed transactions and invoices.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        month_start = today.replace(day=1)
        year_start  = today.replace(month=1, day=1)
        branch_id   = request.query_params.get("branch_id")

        tx_totals = {
            "completed": 0, "pending": 0,
            "total_charge_this_month": 0.0,
            "total_charge_this_year": 0.0,
            "uninvoiced_completed": 0,
        }
        invoice_summary = {
            "draft": 0, "issued": 0, "paid": 0, "overdue": 0,
            "total_invoiced": 0.0, "total_paid": 0.0, "outstanding": 0.0,
        }
        recent_invoices = []

        if HAS_WEIGHBRIDGE:
            try:
                qs = _apply_tenant_filter(Transaction.objects.all(), request.user)
                if branch_id:
                    qs = qs.filter(branch_id=branch_id)
                tx_totals["completed"] = qs.filter(status="Completed").count()
                tx_totals["pending"]   = qs.filter(status="Pending").count()
                tx_totals["uninvoiced_completed"] = qs.filter(
                    status="Completed", invoiced=False
                ).count()
                month_qs = list(qs.filter(created_at__date__gte=month_start, status="Completed"))
                year_qs  = list(qs.filter(created_at__date__gte=year_start,  status="Completed"))
                tx_totals["total_charge_this_month"] = float(sum(t.charge or 0 for t in month_qs))
                tx_totals["total_charge_this_year"]  = float(sum(t.charge or 0 for t in year_qs))
            except Exception:
                pass

            try:
                inv_qs = _apply_tenant_filter(
                    Invoice.objects.select_related("customer").order_by("-created_at"),
                    request.user,
                )
                invoice_summary["draft"]   = inv_qs.filter(status="draft").count()
                invoice_summary["issued"]  = inv_qs.filter(status="issued").count()
                invoice_summary["paid"]    = inv_qs.filter(status="paid").count()
                invoiced_list = list(inv_qs.filter(status__in=["issued", "paid"]))
                paid_list     = list(inv_qs.filter(status="paid"))
                invoice_summary["total_invoiced"] = float(sum(i.total_amount or 0 for i in invoiced_list))
                invoice_summary["total_paid"]     = float(sum(i.total_amount or 0 for i in paid_list))
                invoice_summary["outstanding"]    = (
                    invoice_summary["total_invoiced"] - invoice_summary["total_paid"]
                )
                for inv in inv_qs[:10]:
                    recent_invoices.append({
                        "id": inv.id,
                        "invoice_number": getattr(inv, "invoice_number", f"INV-{inv.id:04d}"),
                        "customer_name": getattr(inv.customer, "name", "") if hasattr(inv, "customer") else "",
                        "status": getattr(inv, "status", "draft"),
                        "total_amount": float(getattr(inv, "total_amount", 0) or 0),
                        "currency": getattr(inv, "currency", "KES"),
                        "due_date": str(inv.due_date) if getattr(inv, "due_date", None) else None,
                        "created_at": inv.created_at.isoformat() if hasattr(inv, "created_at") else None,
                    })
            except Exception:
                pass

        return Response({
            "period": {
                "today": today.isoformat(),
                "month_start": month_start.isoformat(),
                "year_start": year_start.isoformat(),
            },
            "transactions": tx_totals,
            "invoices": invoice_summary,
            "recent_invoices": recent_invoices,
        })


# ── Chart of Accounts ─────────────────────────────────────────────────────────

class ChartOfAccountsView(APIView):
    """
    GET  /api/accounting/chart-of-accounts/   — list all accounts for tenant
    POST /api/accounting/chart-of-accounts/   — create account
    Query params: account_type, is_active, parent_id
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_ACCOUNTING:
            return Response({"accounts": []})
        qs = _apply_tenant_filter(
            Account.objects.select_related("parent").prefetch_related("children"),
            request.user,
        ).order_by("code")
        p = request.query_params
        if at := p.get("account_type"):
            qs = qs.filter(account_type=at)
        if (ia := p.get("is_active")) is not None:
            qs = qs.filter(is_active=(ia.lower() == "true"))
        if pid := p.get("parent_id"):
            qs = qs.filter(parent_id=pid)
        return Response(AccountSerializer(qs, many=True).data)

    def post(self, request):
        if not HAS_ACCOUNTING:
            return Response({"error": "Accounting module not available."}, status=503)
        tenant = _tenant_or_403(request.user)
        ser = AccountSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        # Validate parent belongs to same tenant
        parent = ser.validated_data.get("parent")
        if parent and tenant and parent.tenant_id != tenant.pk:
            return Response({"error": "Parent account belongs to a different tenant."},
                            status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant)
        return Response(AccountSerializer(obj).data, status=status.HTTP_201_CREATED)


class AccountDetailView(APIView):
    """GET / PATCH / DELETE /api/accounting/chart-of-accounts/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(Account.objects.all(), user)
        try:
            return qs.get(pk=pk)
        except Account.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        return Response(AccountSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        ser = AccountSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=400)
        return Response(AccountSerializer(ser.save()).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        if obj.children.exists():
            return Response(
                {"error": "Cannot delete an account with sub-accounts."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Journal Entries (Transactions) ────────────────────────────────────────────

class JournalEntryListCreateView(APIView):
    """
    GET  /api/accounting/transactions/  — list journal entries
    POST /api/accounting/transactions/  — create manual entry with lines
    Query params: journal_id, source_type, status, date_from, date_to
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_ACCOUNTING:
            return Response([])
        qs = _apply_tenant_filter(
            JournalEntry.objects.select_related("journal").prefetch_related("lines__account"),
            request.user,
        ).order_by("-entry_date", "-id")
        p = request.query_params
        if jid := p.get("journal_id"):
            qs = qs.filter(journal_id=jid)
        if st := p.get("source_type"):
            qs = qs.filter(source_type=st)
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if df := p.get("date_from"):
            qs = qs.filter(entry_date__date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(entry_date__date__lte=dt)
        return Response(JournalEntrySerializer(qs[:200], many=True).data)

    def post(self, request):
        if not HAS_ACCOUNTING:
            return Response({"error": "Accounting module not available."}, status=503)
        tenant = _tenant_or_403(request.user)
        ser = JournalEntryWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        # Ensure journal belongs to tenant
        journal = ser.validated_data.get("journal")
        if journal and tenant and journal.tenant_id != tenant.pk:
            return Response({"error": "Journal belongs to a different tenant."},
                            status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant)
        return Response(JournalEntrySerializer(obj).data, status=status.HTTP_201_CREATED)


class JournalEntryDetailView(APIView):
    """GET / PATCH /api/accounting/transactions/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            JournalEntry.objects.select_related("journal").prefetch_related("lines__account"),
            user,
        )
        try:
            return qs.get(pk=pk)
        except JournalEntry.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        return Response(JournalEntrySerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        if obj.status == "posted":
            return Response(
                {"error": "Posted entries cannot be edited. Create a reversal instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ser = JournalEntryWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=400)
        return Response(JournalEntrySerializer(ser.save()).data)


# ── Journals list (for dropdowns) ─────────────────────────────────────────────

class JournalListView(APIView):
    """GET /api/accounting/journals/ — list journals for dropdown selects."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_ACCOUNTING:
            return Response({"journals": []})
        qs = _apply_tenant_filter(Journal.objects.filter(is_active=True), request.user)
        return Response({
            "journals": [
                {"id": j.pk, "code": j.code, "name": j.name, "journal_type": j.journal_type}
                for j in qs.order_by("code")
            ]
        })


# ── Ledger stub (kept for backward compat) ────────────────────────────────────

class AccountingLedgerView(APIView):
    """GET /api/accounting/ledger/ — backward-compat stub, redirects to transactions."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "message": "Use /api/accounting/transactions/ for journal entries "
                       "and /api/accounting/chart-of-accounts/ for the account tree.",
            "entries": [],
            "chart_of_accounts": [],
        })
