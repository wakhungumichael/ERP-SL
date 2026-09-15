"""
Accounting module views.

Provides:
  - Dashboard: revenue + invoice KPIs from Weighbridge
  - Chart of Accounts: CRUD on Platform_Core.Account (tenant-scoped)
  - Transactions: list/create/detail on Platform_Core.JournalEntry + JournalEntryLine
"""
import datetime
from decimal import Decimal
import logging
from collections import defaultdict

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import (
    apply_tenant_filter as _apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403 as _tenant_or_403,
)
try:
    from SL_Weighbridge.models import Transaction, Invoice
    HAS_WEIGHBRIDGE = True
except ImportError:
    HAS_WEIGHBRIDGE = False

try:
    from Platform_Core.models import (
        Account,
        AccountingPeriod,
        AccountingPeriodAuditLog,
        AccountingPostingRule,
        BankReconciliationSession,
        BankStatementLine,
        FinancialYear,
        Journal,
        JournalEntry,
        JournalEntryLine,
    )
    HAS_ACCOUNTING = True
except ImportError:
    HAS_ACCOUNTING = False

try:
    from Platform_Core.accounting import (
        ensure_default_accounting_setup,
        ensure_default_financial_year_setup,
        assert_posting_allowed,
        create_period_audit_log,
        is_accounting_enabled_for_tenant,
        sync_bill_posting,
        sync_invoice_posting,
        sync_transaction_posting,
    )
except ImportError:
    ensure_default_accounting_setup = None
    ensure_default_financial_year_setup = None
    assert_posting_allowed = None
    create_period_audit_log = None
    is_accounting_enabled_for_tenant = None
    sync_bill_posting = None
    sync_invoice_posting = None
    sync_transaction_posting = None


logger = logging.getLogger(__name__)

try:
    from SL_Procurement.models import Bill
    HAS_PROCUREMENT = True
except ImportError:
    HAS_PROCUREMENT = False


def _accounting_enabled_or_response(user):
    tenant = _tenant_or_403(user)
    if tenant is not None and is_accounting_enabled_for_tenant is not None:
        if not is_accounting_enabled_for_tenant(tenant):
            return tenant, Response(
                {"error": "Accounting module is not active for this tenant subscription."},
                status=status.HTTP_403_FORBIDDEN,
            )
    return tenant, None


# ── Serializers ───────────────────────────────────────────────────────────────

class AccountSerializer(serializers.ModelSerializer):
    parent_name = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()
    debit_total = serializers.SerializerMethodField()
    credit_total = serializers.SerializerMethodField()
    balance = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id", "tenant", "code", "name", "account_type",
            "parent", "parent_name", "is_active", "allow_posting",
            "children_count", "debit_total", "credit_total", "balance",
            "metadata", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "tenant", "parent_name", "children_count", "created_at", "updated_at"]

    def get_parent_name(self, obj):
        return obj.parent.name if obj.parent else None

    def get_children_count(self, obj):
        return obj.children.count()

    def get_debit_total(self, obj):
        return float(sum(
            line.debit_amount
            for line in obj.journal_lines.filter(entry__status="posted")
        ))

    def get_credit_total(self, obj):
        return float(sum(
            line.credit_amount
            for line in obj.journal_lines.filter(entry__status="posted")
        ))

    def get_balance(self, obj):
        debit = Decimal(str(self.get_debit_total(obj)))
        credit = Decimal(str(self.get_credit_total(obj)))
        if obj.account_type in {"asset", "expense"}:
            return float(debit - credit)
        return float(credit - debit)


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


class AccountingPostingRuleSerializer(serializers.ModelSerializer):
    journal_name = serializers.SerializerMethodField()
    debit_account_name = serializers.SerializerMethodField()
    debit_account_code = serializers.SerializerMethodField()
    credit_account_name = serializers.SerializerMethodField()
    credit_account_code = serializers.SerializerMethodField()

    class Meta:
        model = AccountingPostingRule
        fields = [
            "id", "tenant", "source_type", "payment_method_code",
            "journal", "journal_name",
            "debit_account", "debit_account_code", "debit_account_name",
            "credit_account", "credit_account_code", "credit_account_name",
            "name", "description", "is_active", "is_primary",
            "metadata", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "journal_name",
            "debit_account_code", "debit_account_name",
            "credit_account_code", "credit_account_name",
            "created_at", "updated_at",
        ]

    def get_journal_name(self, obj):
        return obj.journal.name if obj.journal else None

    def get_debit_account_name(self, obj):
        return obj.debit_account.name if obj.debit_account else None

    def get_debit_account_code(self, obj):
        return obj.debit_account.code if obj.debit_account else None

    def get_credit_account_name(self, obj):
        return obj.credit_account.name if obj.credit_account else None

    def get_credit_account_code(self, obj):
        return obj.credit_account.code if obj.credit_account else None


class FinancialYearSerializer(serializers.ModelSerializer):
    periods_count = serializers.SerializerMethodField()

    class Meta:
        model = FinancialYear
        fields = [
            "id", "tenant", "name", "code", "start_date", "end_date",
            "status", "is_active", "metadata", "periods_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "tenant", "periods_count", "created_at", "updated_at"]

    def get_periods_count(self, obj):
        return obj.periods.count()


class AccountingPeriodSerializer(serializers.ModelSerializer):
    financial_year_name = serializers.SerializerMethodField()

    class Meta:
        model = AccountingPeriod
        fields = [
            "id", "tenant", "financial_year", "financial_year_name",
            "name", "code", "start_date", "end_date", "period_type",
            "status", "sequence_number", "is_adjustment", "metadata",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "tenant", "financial_year_name", "created_at", "updated_at"]

    def get_financial_year_name(self, obj):
        return obj.financial_year.name if obj.financial_year else None


class AccountingPeriodAuditLogSerializer(serializers.ModelSerializer):
    period_name = serializers.SerializerMethodField()
    financial_year_name = serializers.SerializerMethodField()
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AccountingPeriodAuditLog
        fields = [
            "id", "tenant", "financial_year", "financial_year_name",
            "period", "period_name", "action", "performed_by", "performed_by_name",
            "note", "metadata", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_period_name(self, obj):
        return obj.period.name if obj.period else None

    def get_financial_year_name(self, obj):
        return obj.financial_year.name if obj.financial_year else None

    def get_performed_by_name(self, obj):
        if obj.performed_by is None:
            return None
        return obj.performed_by.get_full_name() or obj.performed_by.username


class BankReconciliationSessionSerializer(serializers.ModelSerializer):
    account_name = serializers.SerializerMethodField()
    account_code = serializers.SerializerMethodField()
    period_name = serializers.SerializerMethodField()
    financial_year_name = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()

    class Meta:
        model = BankReconciliationSession
        fields = [
            "id", "tenant", "account", "account_code", "account_name",
            "financial_year", "financial_year_name", "period", "period_name",
            "name", "code", "statement_date_from", "statement_date_to",
            "statement_opening_balance", "statement_closing_balance",
            "notes", "status", "metadata", "summary",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "account_code", "account_name",
            "financial_year_name", "period_name", "summary",
            "created_at", "updated_at",
        ]

    def get_account_name(self, obj):
        return obj.account.name if obj.account else None

    def get_account_code(self, obj):
        return obj.account.code if obj.account else None

    def get_period_name(self, obj):
        return obj.period.name if obj.period else None

    def get_financial_year_name(self, obj):
        return obj.financial_year.name if obj.financial_year else None

    def get_summary(self, obj):
        return _reconciliation_session_summary(obj)


class BankStatementLineSerializer(serializers.ModelSerializer):
    matched_entry_id = serializers.SerializerMethodField()
    matched_entry_number = serializers.SerializerMethodField()
    matched_entry_date = serializers.SerializerMethodField()
    matched_entry_memo = serializers.SerializerMethodField()
    matched_account_code = serializers.SerializerMethodField()
    matched_account_name = serializers.SerializerMethodField()
    matched_amount = serializers.SerializerMethodField()

    class Meta:
        model = BankStatementLine
        fields = [
            "id", "tenant", "session", "line_date", "reference", "description",
            "amount", "status", "matched_journal_line", "matched_entry_id",
            "matched_entry_number", "matched_entry_date", "matched_entry_memo",
            "matched_account_code", "matched_account_name", "matched_amount",
            "matched_by", "matched_at", "notes", "metadata",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "status", "matched_journal_line", "matched_entry_id",
            "matched_entry_number", "matched_entry_date", "matched_entry_memo",
            "matched_account_code", "matched_account_name", "matched_amount",
            "matched_by", "matched_at", "created_at", "updated_at",
        ]

    def get_matched_entry_id(self, obj):
        return obj.matched_journal_line.entry_id if obj.matched_journal_line else None

    def get_matched_entry_number(self, obj):
        if not obj.matched_journal_line:
            return None
        return obj.matched_journal_line.entry.entry_number

    def get_matched_entry_date(self, obj):
        if not obj.matched_journal_line:
            return None
        return obj.matched_journal_line.entry.entry_date

    def get_matched_entry_memo(self, obj):
        if not obj.matched_journal_line:
            return None
        return obj.matched_journal_line.entry.memo

    def get_matched_account_code(self, obj):
        if not obj.matched_journal_line:
            return None
        return obj.matched_journal_line.account.code

    def get_matched_account_name(self, obj):
        if not obj.matched_journal_line:
            return None
        return obj.matched_journal_line.account.name

    def get_matched_amount(self, obj):
        if not obj.matched_journal_line:
            return None
        return float(_signed_amount_for_account_type(
            obj.matched_journal_line.account.account_type,
            Decimal(str(obj.matched_journal_line.debit_amount or 0)),
            Decimal(str(obj.matched_journal_line.credit_amount or 0)),
        ))


def _ensure_accounting_seeded(user):
    if not HAS_ACCOUNTING or ensure_default_accounting_setup is None:
        return None
    tenant, denied = _accounting_enabled_or_response(user)
    if denied is not None:
        return None
    if tenant is None:
        return None
    return ensure_default_accounting_setup(tenant)


def _validate_entry_lines(*, lines, tenant):
    if not lines:
        return "At least one journal line is required."

    debit_total = Decimal("0.00")
    credit_total = Decimal("0.00")
    for line in lines:
        account = line.get("account")
        if account is None:
            return "Each line must have an account."
        if tenant and account.tenant_id != tenant.pk:
            return f"Account {account.code} belongs to a different tenant."
        debit = Decimal(str(line.get("debit_amount") or 0))
        credit = Decimal(str(line.get("credit_amount") or 0))
        if debit < 0 or credit < 0:
            return "Debit and credit amounts cannot be negative."
        if debit > 0 and credit > 0:
            return "A line cannot have both debit and credit values."
        if debit == 0 and credit == 0:
            return "Each line must have either a debit or a credit amount."
        debit_total += debit
        credit_total += credit

    if debit_total <= 0 or credit_total <= 0:
        return "Entries must include both debit and credit totals."
    if abs(debit_total - credit_total) > Decimal("0.01"):
        return "Entry is not balanced."
    return None


def _parse_date_param(value):
    if not value:
        return None
    if isinstance(value, datetime.date):
        return value
    return datetime.date.fromisoformat(str(value))


def _normal_side_for_account_type(account_type: str) -> str:
    return "debit" if account_type in {"asset", "expense"} else "credit"


def _present_signed_balance(account_type: str, balance: Decimal):
    normal_side = _normal_side_for_account_type(account_type)
    if balance == 0:
        return {
            "display_amount": 0.0,
            "display_side": normal_side,
            "is_abnormal": False,
        }
    if balance > 0:
        return {
            "display_amount": float(balance),
            "display_side": normal_side,
            "is_abnormal": False,
        }
    return {
        "display_amount": float(abs(balance)),
        "display_side": "credit" if normal_side == "debit" else "debit",
        "is_abnormal": True,
    }


def _generate_month_periods(financial_year):
    current = financial_year.start_date.replace(day=1)
    created = 0
    sequence = 1
    while current <= financial_year.end_date:
        next_month = (current.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
        end_of_month = next_month - datetime.timedelta(days=1)
        period_start = max(current, financial_year.start_date)
        period_end = min(end_of_month, financial_year.end_date)
        period_code = f"{financial_year.code}-{sequence:02d}"
        _, was_created = AccountingPeriod.objects.get_or_create(
            tenant=financial_year.tenant,
            code=period_code,
            defaults={
                "financial_year": financial_year,
                "name": period_start.strftime("%b %Y"),
                "start_date": period_start,
                "end_date": period_end,
                "period_type": "month",
                "status": "draft" if financial_year.status == "draft" else "open",
                "sequence_number": sequence,
                "is_adjustment": False,
                "metadata": {"generated": True},
            },
        )
        if was_created:
            created += 1
        current = next_month
        sequence += 1
    return created


def _resolve_period(user, *, period_id=None):
    if not period_id:
        return None
    return _apply_tenant_filter(
        AccountingPeriod.objects.select_related("financial_year"),
        user,
    ).filter(pk=period_id).first()


def _assert_posting_allowed_response(*, tenant, posting_date, source_label):
    if assert_posting_allowed is None:
        return None
    try:
        assert_posting_allowed(tenant=tenant, posting_date=posting_date, source_label=source_label)
        return None
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def _previous_period_range(date_from, date_to):
    span_days = max((date_to - date_from).days, 0) + 1
    prev_end = date_from - datetime.timedelta(days=1)
    prev_start = prev_end - datetime.timedelta(days=span_days - 1)
    return prev_start, prev_end


def _ranges_overlap(start_a, end_a, start_b, end_b):
    return start_a <= end_b and start_b <= end_a


def _financial_year_overlap_error(*, tenant, start_date, end_date, exclude_id=None):
    qs = FinancialYear.objects.filter(tenant=tenant)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    for year in qs.only("id", "name", "start_date", "end_date"):
        if _ranges_overlap(start_date, end_date, year.start_date, year.end_date):
            return (
                f"Financial year dates overlap with {year.name} "
                f"({year.start_date.isoformat()} to {year.end_date.isoformat()})."
            )
    return None


def _accounting_period_overlap_error(*, tenant, financial_year, start_date, end_date, exclude_id=None):
    if start_date < financial_year.start_date or end_date > financial_year.end_date:
        return (
            f"Accounting period must remain within financial year {financial_year.name} "
            f"({financial_year.start_date.isoformat()} to {financial_year.end_date.isoformat()})."
        )
    qs = AccountingPeriod.objects.filter(tenant=tenant, financial_year=financial_year)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    for period in qs.only("id", "name", "start_date", "end_date"):
        if _ranges_overlap(start_date, end_date, period.start_date, period.end_date):
            return (
                f"Accounting period dates overlap with {period.name} "
                f"({period.start_date.isoformat()} to {period.end_date.isoformat()})."
            )
    return None


def _posted_lines_queryset(user, *, date_from=None, date_to=None, account_id=None):
    qs = _apply_tenant_filter(
        JournalEntryLine.objects.select_related("entry", "entry__journal", "account", "account__parent"),
        user,
        filter_field="entry__tenant",
    ).filter(entry__status="posted")
    if date_from:
        qs = qs.filter(entry__entry_date__date__gte=date_from)
    if date_to:
        qs = qs.filter(entry__entry_date__date__lte=date_to)
    if account_id:
        qs = qs.filter(account_id=account_id)
    return qs.order_by("entry__entry_date", "entry_id", "id")


def _account_balance_for_type(account_type: str, debit_total: Decimal, credit_total: Decimal) -> Decimal:
    if account_type in {"asset", "expense"}:
        return debit_total - credit_total
    return credit_total - debit_total


def _signed_amount_for_account_type(account_type: str, debit_total: Decimal, credit_total: Decimal) -> Decimal:
    return _account_balance_for_type(account_type, debit_total, credit_total)


def _book_balance_for_account(user, *, account, date_to=None):
    lines = _posted_lines_queryset(user, date_to=date_to, account_id=account.id)
    debit_total = Decimal("0.00")
    credit_total = Decimal("0.00")
    for line in lines:
        debit_total += Decimal(str(line.debit_amount or 0))
        credit_total += Decimal(str(line.credit_amount or 0))
    return _signed_amount_for_account_type(account.account_type, debit_total, credit_total)


def _reconciliation_session_summary(session):
    lines = list(session.lines.select_related("matched_journal_line__entry", "matched_journal_line__account"))
    total_lines = len(lines)
    matched_lines = sum(1 for line in lines if line.status == "matched" and line.matched_journal_line_id)
    ignored_lines = sum(1 for line in lines if line.status == "ignored")
    open_lines = total_lines - matched_lines - ignored_lines
    unmatched_total = Decimal("0.00")
    matched_total = Decimal("0.00")
    for line in lines:
        amount = Decimal(str(line.amount or 0))
        if line.status == "matched" and line.matched_journal_line_id:
            matched_total += amount
        elif line.status != "ignored":
            unmatched_total += amount
    return {
        "total_lines": total_lines,
        "matched_lines": matched_lines,
        "ignored_lines": ignored_lines,
        "open_lines": open_lines,
        "matched_total": float(matched_total),
        "unmatched_total": float(unmatched_total),
    }


def _reconciliation_candidate_rows(statement_line):
    session = statement_line.session
    line_amount = Decimal(str(statement_line.amount or 0))
    start_date = statement_line.line_date - datetime.timedelta(days=30)
    end_date = statement_line.line_date + datetime.timedelta(days=30)
    candidates = (
        JournalEntryLine.objects.select_related("entry", "entry__journal", "account")
        .filter(
            entry__tenant=session.tenant,
            entry__status="posted",
            account_id=session.account_id,
            entry__entry_date__date__gte=start_date,
            entry__entry_date__date__lte=end_date,
        )
        .order_by("entry__entry_date", "entry_id", "id")
    )

    rows = []
    for candidate in candidates:
        signed_amount = _signed_amount_for_account_type(
            candidate.account.account_type,
            Decimal(str(candidate.debit_amount or 0)),
            Decimal(str(candidate.credit_amount or 0)),
        )
        amount_delta = abs(signed_amount - line_amount)
        date_delta = abs((candidate.entry.entry_date.date() - statement_line.line_date).days)
        rows.append({
            "journal_line_id": candidate.id,
            "entry_id": candidate.entry_id,
            "entry_number": candidate.entry.entry_number,
            "entry_date": candidate.entry.entry_date,
            "journal_code": candidate.entry.journal.code if candidate.entry.journal else "",
            "journal_name": candidate.entry.journal.name if candidate.entry.journal else "",
            "source_type": candidate.entry.source_type,
            "source_reference": candidate.entry.source_reference,
            "memo": candidate.entry.memo,
            "description": candidate.description,
            "signed_amount": float(signed_amount),
            "amount_delta": float(amount_delta),
            "date_delta_days": date_delta,
            "already_matched": hasattr(candidate, "reconciliation_statement_line"),
        })
    rows.sort(key=lambda row: (row["already_matched"], row["amount_delta"], row["date_delta_days"], row["entry_date"]))
    return rows[:100]


def _trial_balance_rows(
    user,
    *,
    date_from=None,
    date_to=None,
    account_type=None,
    account_group=None,
    is_active=None,
    show_zero_balance=False,
):
    """Build a full, unpaged trial balance so its totals always remain auditable."""
    closing_lines = list(_posted_lines_queryset(user, date_to=date_to))
    movement_lines = list(_posted_lines_queryset(user, date_from=date_from, date_to=date_to))
    grouped = defaultdict(lambda: {
        "opening_debit": Decimal("0.00"),
        "opening_credit": Decimal("0.00"),
        "movement_debit": Decimal("0.00"),
        "movement_credit": Decimal("0.00"),
        "account": None,
    })

    for line in closing_lines:
        bucket = grouped[line.account_id]
        bucket["account"] = line.account
        debit = Decimal(str(line.debit_amount or 0))
        credit = Decimal(str(line.credit_amount or 0))
        if date_from and line.entry.entry_date.date() < date_from:
            bucket["opening_debit"] += debit
            bucket["opening_credit"] += credit

    for line in movement_lines:
        bucket = grouped[line.account_id]
        bucket["account"] = line.account
        bucket["movement_debit"] += Decimal(str(line.debit_amount or 0))
        bucket["movement_credit"] += Decimal(str(line.credit_amount or 0))

    if show_zero_balance:
        accounts = _apply_tenant_filter(Account.objects.select_related("parent"), user)
        if account_type:
            accounts = accounts.filter(account_type=account_type)
        if is_active is not None:
            accounts = accounts.filter(is_active=is_active)
        for account in accounts:
            grouped[account.id]["account"] = account

    rows = []
    totals = defaultdict(lambda: Decimal("0.00"))
    for account_id in sorted(grouped, key=lambda aid: grouped[aid]["account"].code):
        bucket = grouped[account_id]
        account = bucket["account"]
        if account_type and account.account_type != account_type:
            continue
        group_name = account.parent.name if account.parent else account.get_account_type_display()
        if account_group and group_name != account_group:
            continue
        if is_active is not None and account.is_active != is_active:
            continue

        opening_balance = _account_balance_for_type(account.account_type, bucket["opening_debit"], bucket["opening_credit"])
        movement_balance = _account_balance_for_type(account.account_type, bucket["movement_debit"], bucket["movement_credit"])
        closing_debit_total = bucket["opening_debit"] + bucket["movement_debit"]
        closing_credit_total = bucket["opening_credit"] + bucket["movement_credit"]
        closing_balance = _account_balance_for_type(account.account_type, closing_debit_total, closing_credit_total)
        if not show_zero_balance and closing_debit_total == 0 and closing_credit_total == 0:
            continue
        presentation = _present_signed_balance(account.account_type, closing_balance)
        row = {
            "account_id": account.id,
            "code": account.code,
            "name": account.name,
            "account_type": account.account_type,
            "account_group": group_name,
            "is_active": account.is_active,
            "opening_debit": float(bucket["opening_debit"]),
            "opening_credit": float(bucket["opening_credit"]),
            "movement_debit": float(bucket["movement_debit"]),
            "movement_credit": float(bucket["movement_credit"]),
            "closing_debit": float(presentation["display_amount"] if presentation["display_side"] == "debit" else 0),
            "closing_credit": float(presentation["display_amount"] if presentation["display_side"] == "credit" else 0),
            "debit_total": float(closing_debit_total),
            "credit_total": float(closing_credit_total),
            "balance": float(closing_balance),
            **presentation,
        }
        rows.append(row)
        for key in ("opening_debit", "opening_credit", "movement_debit", "movement_credit", "closing_debit", "closing_credit"):
            totals[key] += Decimal(str(row[key]))
        totals["total_debits"] += closing_debit_total
        totals["total_credits"] += closing_credit_total

    return {
        "rows": rows,
        "summary": {
            **{key: float(value) for key, value in totals.items()},
            "balanced": abs(totals["total_debits"] - totals["total_credits"]) <= Decimal("0.01"),
        },
    }


def _income_statement_payload(user, *, date_from=None, date_to=None):
    lines = list(_posted_lines_queryset(user, date_from=date_from, date_to=date_to))
    grouped = defaultdict(lambda: {"debit": Decimal("0.00"), "credit": Decimal("0.00"), "account": None})
    for line in lines:
        if line.account.account_type not in {"income", "expense"}:
            continue
        bucket = grouped[line.account_id]
        bucket["account"] = line.account
        bucket["debit"] += Decimal(str(line.debit_amount or 0))
        bucket["credit"] += Decimal(str(line.credit_amount or 0))

    income_rows = []
    expense_rows = []
    total_income = Decimal("0.00")
    total_expenses = Decimal("0.00")
    for account_id in sorted(grouped, key=lambda aid: grouped[aid]["account"].code):
        bucket = grouped[account_id]
        account = bucket["account"]
        balance = _account_balance_for_type(account.account_type, bucket["debit"], bucket["credit"])
        presentation = _present_signed_balance(account.account_type, balance)
        row = {
            "account_id": account.id,
            "code": account.code,
            "name": account.name,
            "amount": float(balance),
            **presentation,
        }
        if account.account_type == "income":
            income_rows.append(row)
            total_income += balance
        else:
            expense_rows.append(row)
            total_expenses += balance
    return {
        "income": income_rows,
        "expenses": expense_rows,
        "summary": {
            "total_income": float(total_income),
            "total_expenses": float(total_expenses),
            "net_income": float(total_income - total_expenses),
        },
    }


def _balance_sheet_payload(user, *, date_to=None):
    lines = list(_posted_lines_queryset(user, date_to=date_to))
    grouped = defaultdict(lambda: {"debit": Decimal("0.00"), "credit": Decimal("0.00"), "account": None})
    for line in lines:
        if line.account.account_type not in {"asset", "liability", "equity"}:
            continue
        bucket = grouped[line.account_id]
        bucket["account"] = line.account
        bucket["debit"] += Decimal(str(line.debit_amount or 0))
        bucket["credit"] += Decimal(str(line.credit_amount or 0))

    sections = {"assets": [], "liabilities": [], "equity": []}
    totals = {"assets": Decimal("0.00"), "liabilities": Decimal("0.00"), "equity": Decimal("0.00")}
    for account_id in sorted(grouped, key=lambda aid: grouped[aid]["account"].code):
        bucket = grouped[account_id]
        account = bucket["account"]
        balance = _account_balance_for_type(account.account_type, bucket["debit"], bucket["credit"])
        presentation = _present_signed_balance(account.account_type, balance)
        row = {
            "account_id": account.id,
            "code": account.code,
            "name": account.name,
            "amount": float(balance),
            **presentation,
        }
        if account.account_type == "asset":
            sections["assets"].append(row)
            totals["assets"] += balance
        elif account.account_type == "liability":
            sections["liabilities"].append(row)
            totals["liabilities"] += balance
        else:
            sections["equity"].append(row)
            totals["equity"] += balance

    period_end = date_to or timezone.now().date()
    year_start = period_end.replace(month=1, day=1)
    pnl = _income_statement_payload(user, date_from=year_start, date_to=period_end)
    current_period_earnings = Decimal(str(pnl["summary"]["net_income"]))
    sections["equity"].append({
        "account_id": None,
        "code": "CURRENT-EARNINGS",
        "name": "Current Period Earnings",
        "amount": float(current_period_earnings),
        **_present_signed_balance("equity", current_period_earnings),
    })
    totals["equity"] += current_period_earnings

    return {
        "assets": sections["assets"],
        "liabilities": sections["liabilities"],
        "equity": sections["equity"],
        "summary": {
            "total_assets": float(totals["assets"]),
            "total_liabilities": float(totals["liabilities"]),
            "total_equity": float(totals["equity"]),
            "balanced": abs(totals["assets"] - (totals["liabilities"] + totals["equity"])) <= Decimal("0.01"),
        },
        "notes": {
            "balanced_definition": "Balanced means assets equal liabilities plus equity.",
            "negative_balances_possible": True,
        },
    }


def _ledger_activity_payload(user, *, account, date_from=None, date_to=None):
    lines = list(_posted_lines_queryset(user, date_from=date_from, date_to=date_to, account_id=account.id))
    opening_balance = Decimal("0.00")
    if date_from:
        opening_lines = list(_posted_lines_queryset(user, date_to=date_from - datetime.timedelta(days=1), account_id=account.id))
        for line in opening_lines:
            opening_balance += _account_balance_for_type(
                account.account_type,
                Decimal(str(line.debit_amount or 0)),
                Decimal(str(line.credit_amount or 0)),
            )

    running_balance = opening_balance
    entries = []
    debit_total = Decimal("0.00")
    credit_total = Decimal("0.00")
    for line in lines:
        debit = Decimal(str(line.debit_amount or 0))
        credit = Decimal(str(line.credit_amount or 0))
        debit_total += debit
        credit_total += credit
        running_balance += _account_balance_for_type(account.account_type, debit, credit)
        entries.append({
            "entry_id": line.entry_id,
            "entry_number": line.entry.entry_number,
            "entry_date": line.entry.entry_date.isoformat(),
            "journal": getattr(line.entry.journal, "code", ""),
            "source_type": line.entry.source_type,
            "source_reference": line.entry.source_reference,
            "memo": line.entry.memo,
            "description": line.description,
            "debit_amount": float(debit),
            "credit_amount": float(credit),
            "running_balance": float(running_balance),
        })

    # Give account drill-downs a real, comparable six-month movement series.
    trend_end = date_to or timezone.now().date()
    trend_months = []
    for offset in range(5, -1, -1):
        year = trend_end.year
        month = trend_end.month - offset
        while month <= 0:
            month += 12
            year -= 1
        month_start = datetime.date(year, month, 1)
        next_month = month_start.replace(day=28) + datetime.timedelta(days=4)
        month_end = next_month - datetime.timedelta(days=next_month.day)
        movement = Decimal("0.00")
        for trend_line in _posted_lines_queryset(user, date_from=month_start, date_to=month_end, account_id=account.id):
            movement += _account_balance_for_type(
                account.account_type,
                Decimal(str(trend_line.debit_amount or 0)),
                Decimal(str(trend_line.credit_amount or 0)),
            )
        trend_months.append({
            "label": month_start.strftime("%b %Y"),
            "amount": float(movement),
        })

    return {
        "account": {
            "id": account.id,
            "code": account.code,
            "name": account.name,
            "account_type": account.account_type,
        },
        "opening_balance": float(opening_balance),
        "entries": entries,
        "summary": {
            "debit_total": float(debit_total),
            "credit_total": float(credit_total),
            "closing_balance": float(running_balance),
        },
        "monthly_trend": trend_months,
    }


def _closing_payload(user, *, tenant, date_from, date_to):
    pnl = _income_statement_payload(user, date_from=date_from, date_to=date_to)
    retained_earnings = Account.objects.filter(tenant=tenant, code="3200", is_active=True).first()
    if retained_earnings is None:
        retained_earnings = Account.objects.filter(tenant=tenant, account_type="equity", allow_posting=True, is_active=True).order_by("code").first()
    if retained_earnings is None:
        return {"error": "No retained earnings account is configured."}

    lines = []
    total_debits = Decimal("0.00")
    total_credits = Decimal("0.00")

    for row in pnl["income"]:
        amount = Decimal(str(row["amount"]))
        if amount == 0:
            continue
        lines.append({
            "account_id": row["account_id"],
            "code": row["code"],
            "name": row["name"],
            "debit_amount": float(amount),
            "credit_amount": 0.0,
        })
        total_debits += amount

    for row in pnl["expenses"]:
        amount = Decimal(str(row["amount"]))
        if amount == 0:
            continue
        lines.append({
            "account_id": row["account_id"],
            "code": row["code"],
            "name": row["name"],
            "debit_amount": 0.0,
            "credit_amount": float(amount),
        })
        total_credits += amount

    net_income = Decimal(str(pnl["summary"]["net_income"]))
    retained_line = {
        "account_id": retained_earnings.id,
        "code": retained_earnings.code,
        "name": retained_earnings.name,
        "debit_amount": 0.0,
        "credit_amount": 0.0,
    }
    if net_income > 0:
        retained_line["credit_amount"] = float(net_income)
        total_credits += net_income
    elif net_income < 0:
        retained_line["debit_amount"] = float(abs(net_income))
        total_debits += abs(net_income)
    lines.append(retained_line)

    return {
        "period_start": date_from.isoformat(),
        "period_end": date_to.isoformat(),
        "retained_earnings_account": {
            "id": retained_earnings.id,
            "code": retained_earnings.code,
            "name": retained_earnings.name,
        },
        "net_income": float(net_income),
        "lines": lines,
        "balanced": abs(total_debits - total_credits) <= Decimal("0.01"),
        "total_debits": float(total_debits),
        "total_credits": float(total_credits),
    }


def _retained_earnings_rollforward_payload(user, *, tenant, date_from, date_to):
    retained_earnings = Account.objects.filter(tenant=tenant, code="3200", is_active=True).first()
    if retained_earnings is None:
        retained_earnings = Account.objects.filter(tenant=tenant, account_type="equity", allow_posting=True, is_active=True).order_by("code").first()
    if retained_earnings is None:
        return {"error": "No retained earnings account is configured."}

    opening_lines = list(_posted_lines_queryset(user, date_to=date_from - datetime.timedelta(days=1), account_id=retained_earnings.id))
    opening_balance = Decimal("0.00")
    for line in opening_lines:
        opening_balance += _account_balance_for_type(
            retained_earnings.account_type,
            Decimal(str(line.debit_amount or 0)),
            Decimal(str(line.credit_amount or 0)),
        )

    period_lines = list(_posted_lines_queryset(user, date_from=date_from, date_to=date_to, account_id=retained_earnings.id))
    direct_movements = Decimal("0.00")
    entries = []
    for line in period_lines:
        movement = _account_balance_for_type(
            retained_earnings.account_type,
            Decimal(str(line.debit_amount or 0)),
            Decimal(str(line.credit_amount or 0)),
        )
        direct_movements += movement
        entries.append({
            "entry_id": line.entry_id,
            "entry_number": line.entry.entry_number,
            "entry_date": line.entry.entry_date.isoformat(),
            "memo": line.entry.memo,
            "source_type": line.entry.source_type,
            "amount": float(movement),
        })

    pnl = _income_statement_payload(user, date_from=date_from, date_to=date_to)
    net_income_transfer = Decimal(str(pnl["summary"]["net_income"]))

    return {
        "account": {
            "id": retained_earnings.id,
            "code": retained_earnings.code,
            "name": retained_earnings.name,
        },
        "period_start": date_from.isoformat(),
        "period_end": date_to.isoformat(),
        "opening_balance": float(opening_balance),
        "direct_movements": float(direct_movements),
        "net_income_transfer": float(net_income_transfer),
        "closing_balance": float(opening_balance + direct_movements + net_income_transfer),
        "entries": entries,
    }


# ── Dashboard ─────────────────────────────────────────────────────────────────

class AccountingDashboardView(APIView):
    """
    GET /api/accounting/dashboard/
    Financial summary from completed transactions and invoices.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
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
        bill_summary = {
            "draft": 0, "received": 0, "approved": 0, "paid": 0, "overdue": 0,
            "total_billed": 0.0, "total_paid": 0.0, "outstanding": 0.0,
        }
        journal_summary = {
            "posted_entries": 0,
            "draft_entries": 0,
            "cash_in": 0.0,
            "cash_out": 0.0,
            "sales_postings": 0.0,
            "bill_postings": 0.0,
        }
        recent_invoices = []
        analytics = {
            "monthly_performance": [],
            "expense_categories": [],
            "recent_journal_entries": [],
        }

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

        if HAS_PROCUREMENT:
            try:
                bill_qs = _apply_tenant_filter(Bill.objects.order_by("-created_at"), request.user)
                for status_key in ("draft", "received", "approved", "paid", "overdue"):
                    bill_summary[status_key] = bill_qs.filter(status=status_key).count()
                billed_list = list(bill_qs.filter(status__in=["received", "approved", "paid", "overdue"]))
                paid_list = list(bill_qs.filter(status="paid"))
                bill_summary["total_billed"] = float(sum(b.total or 0 for b in billed_list))
                bill_summary["total_paid"] = float(sum(b.total or 0 for b in paid_list))
                bill_summary["outstanding"] = bill_summary["total_billed"] - bill_summary["total_paid"]
            except Exception:
                pass

        if HAS_ACCOUNTING:
            try:
                entry_qs = _apply_tenant_filter(
                    JournalEntry.objects.prefetch_related("lines__account"),
                    request.user,
                )
                journal_summary["posted_entries"] = entry_qs.filter(status="posted").count()
                journal_summary["draft_entries"] = entry_qs.filter(status="draft").count()
                posted_entries = entry_qs.filter(status="posted")
                payment_entries = posted_entries.filter(source_type="payment")
                journal_summary["cash_in"] = float(sum(
                    sum(line.debit_amount for line in entry.lines.all())
                    for entry in payment_entries
                ))
                journal_summary["cash_out"] = float(sum(
                    sum(line.credit_amount for line in entry.lines.all())
                    for entry in posted_entries.filter(source_type="bill")
                ))
                journal_summary["sales_postings"] = float(sum(
                    sum(line.credit_amount for line in entry.lines.filter(account__account_type="income"))
                    for entry in posted_entries.filter(source_type="invoice")
                ))
                journal_summary["bill_postings"] = float(sum(
                    sum(line.debit_amount for line in entry.lines.filter(account__account_type="expense"))
                    for entry in posted_entries.filter(source_type="bill")
                ))

                # The overview only presents posted accounting activity. Drafts are
                # deliberately excluded so charts reconcile to financial reports.
                posted_list = list(posted_entries)
                month_buckets = []
                for offset in range(5, -1, -1):
                    year = today.year
                    month = today.month - offset
                    while month <= 0:
                        month += 12
                        year -= 1
                    month_buckets.append((year, month))

                for year, month in month_buckets:
                    month_start_date = datetime.date(year, month, 1)
                    next_month = month_start_date.replace(day=28) + datetime.timedelta(days=4)
                    month_end_date = next_month - datetime.timedelta(days=next_month.day)
                    revenue = Decimal("0")
                    expenses = Decimal("0")
                    for entry in posted_list:
                        if entry.entry_date.year != year or entry.entry_date.month != month:
                            continue
                        for line in entry.lines.all():
                            if line.account.account_type == "income":
                                revenue += line.credit_amount - line.debit_amount
                            elif line.account.account_type == "expense":
                                expenses += line.debit_amount - line.credit_amount
                    analytics["monthly_performance"].append({
                        "label": datetime.date(year, month, 1).strftime("%b %Y"),
                        "date_from": month_start_date.isoformat(),
                        "date_to": month_end_date.isoformat(),
                        "revenue": float(revenue),
                        "expenses": float(expenses),
                        "net": float(revenue - expenses),
                    })

                expense_categories = defaultdict(Decimal)
                for entry in posted_list:
                    if entry.entry_date.date() < month_start:
                        continue
                    for line in entry.lines.all():
                        if line.account.account_type == "expense":
                            expense_categories[line.account.name] += line.debit_amount - line.credit_amount
                analytics["expense_categories"] = [
                    {"name": name, "amount": float(amount)}
                    for name, amount in sorted(expense_categories.items(), key=lambda item: item[1], reverse=True)[:6]
                    if amount
                ]

                for entry in posted_list[:8]:
                    analytics["recent_journal_entries"].append({
                        "id": entry.id,
                        "entry_number": entry.entry_number,
                        "entry_date": entry.entry_date.isoformat(),
                        "journal_name": entry.journal.name,
                        "source_type": entry.source_type,
                        "memo": entry.memo,
                        "status": entry.status,
                        "debit_total": float(sum(line.debit_amount for line in entry.lines.all())),
                        "credit_total": float(sum(line.credit_amount for line in entry.lines.all())),
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
            "bills": bill_summary,
            "journals": journal_summary,
            "recent_invoices": recent_invoices,
            "analytics": analytics,
        })


class FinanceOverviewView(APIView):
    """
    GET /api/accounting/overview/
    Cross-module finance summary for receivables, payables, cash and source postings.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        data = {
            "receivables": {"issued": 0.0, "paid": 0.0, "outstanding": 0.0, "count": 0},
            "payables": {"approved": 0.0, "paid": 0.0, "outstanding": 0.0, "count": 0},
            "postings": {"invoice": 0, "payment": 0, "bill": 0, "manual": 0},
            "accounts": {"assets": 0, "liabilities": 0, "income": 0, "expenses": 0},
        }

        if HAS_WEIGHBRIDGE:
            try:
                invoices = _apply_tenant_filter(Invoice.objects.all(), request.user)
                issued = list(invoices.filter(status__in=["issued", "paid", "overdue"]))
                paid = list(invoices.filter(status="paid"))
                total_issued = float(sum(i.total_amount or 0 for i in issued))
                total_paid = float(sum(i.total_amount or 0 for i in paid))
                data["receivables"] = {
                    "issued": total_issued,
                    "paid": total_paid,
                    "outstanding": total_issued - total_paid,
                    "count": len(issued),
                }
            except Exception:
                pass

        if HAS_PROCUREMENT:
            try:
                bills = _apply_tenant_filter(Bill.objects.all(), request.user)
                approved = list(bills.filter(status__in=["received", "approved", "paid", "overdue"]))
                paid = list(bills.filter(status="paid"))
                total_approved = float(sum(b.total or 0 for b in approved))
                total_paid = float(sum(b.total or 0 for b in paid))
                data["payables"] = {
                    "approved": total_approved,
                    "paid": total_paid,
                    "outstanding": total_approved - total_paid,
                    "count": len(approved),
                }
            except Exception:
                pass

        if HAS_ACCOUNTING:
            try:
                entries = _apply_tenant_filter(JournalEntry.objects.all(), request.user)
                for source_type in data["postings"]:
                    data["postings"][source_type] = entries.filter(source_type=source_type).count()
                accounts = _apply_tenant_filter(Account.objects.filter(is_active=True), request.user)
                data["accounts"] = {
                    "assets": accounts.filter(account_type="asset").count(),
                    "liabilities": accounts.filter(account_type="liability").count(),
                    "income": accounts.filter(account_type="income").count(),
                    "expenses": accounts.filter(account_type="expense").count(),
                }
            except Exception:
                pass

        return Response(data)


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
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
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
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
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
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        parent = ser.validated_data.get("parent")
        if parent and tenant and parent.tenant_id != tenant.pk:
            return Response({"error": "Parent account belongs to a different tenant."}, status=status.HTTP_400_BAD_REQUEST)
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
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
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
        if q := p.get("search"):
            qs = qs.filter(
                Q(entry_number__icontains=q) |
                Q(source_reference__icontains=q) |
                Q(memo__icontains=q)
            )
        return Response(JournalEntrySerializer(qs[:200], many=True).data)

    def post(self, request):
        if not HAS_ACCOUNTING:
            return Response({"error": "Accounting module not available."}, status=503)
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        ser = JournalEntryWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        # Ensure journal belongs to tenant
        journal = ser.validated_data.get("journal")
        if journal and tenant and journal.tenant_id != tenant.pk:
            return Response({"error": "Journal belongs to a different tenant."},
                            status=status.HTTP_400_BAD_REQUEST)
        posting_error = _assert_posting_allowed_response(
            tenant=tenant,
            posting_date=ser.validated_data.get("entry_date") or timezone.now(),
            source_label="manual entry",
        )
        if posting_error is not None:
            return posting_error
        line_error = _validate_entry_lines(lines=ser.validated_data.get("lines", []), tenant=tenant)
        if line_error:
            return Response({"error": line_error}, status=status.HTTP_400_BAD_REQUEST)
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
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        posting_error = _assert_posting_allowed_response(
            tenant=tenant,
            posting_date=ser.validated_data.get("entry_date") or obj.entry_date,
            source_label="manual entry update",
        )
        if posting_error is not None:
            return posting_error
        journal = ser.validated_data.get("journal")
        if journal and tenant and journal.tenant_id != tenant.pk:
            return Response({"error": "Journal belongs to a different tenant."},
                            status=status.HTTP_400_BAD_REQUEST)
        lines = ser.validated_data.get("lines")
        if lines is not None:
            line_error = _validate_entry_lines(lines=lines, tenant=tenant)
            if line_error:
                return Response({"error": line_error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(JournalEntrySerializer(ser.save()).data)


class AccountingSetupBootstrapView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not HAS_ACCOUNTING or ensure_default_accounting_setup is None:
            return Response({"error": "Accounting module not available."}, status=503)
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        summary = ensure_default_accounting_setup(tenant)
        return Response({
            "message": "Default chart of accounts, journals, and posting rules have been prepared.",
            **summary,
        })


class FinancialYearListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        qs = _apply_tenant_filter(FinancialYear.objects.all(), request.user).order_by("-start_date", "-id")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        return Response(FinancialYearSerializer(qs, many=True).data)

    def post(self, request):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        payload = request.data.copy()
        serializer = FinancialYearSerializer(data=payload)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        start_date = serializer.validated_data["start_date"]
        end_date = serializer.validated_data["end_date"]
        if end_date < start_date:
            return Response({"error": "End date must be on or after start date."}, status=status.HTTP_400_BAD_REQUEST)
        overlap_error = _financial_year_overlap_error(
            tenant=tenant,
            start_date=start_date,
            end_date=end_date,
        )
        if overlap_error:
            return Response({"error": overlap_error}, status=status.HTTP_400_BAD_REQUEST)
        year_obj = serializer.save(tenant=tenant)
        periods_created = 0
        if request.data.get("auto_generate_periods", True):
            periods_created = _generate_month_periods(year_obj)
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=tenant,
                financial_year=year_obj,
                performed_by=request.user,
                action="created",
                note="Financial year created.",
                metadata={"periods_created": periods_created},
            )
        return Response({
            "financial_year": FinancialYearSerializer(year_obj).data,
            "periods_created": periods_created,
        }, status=status.HTTP_201_CREATED)


class FinancialYearDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = _apply_tenant_filter(FinancialYear.objects.all(), request.user).filter(pk=pk).first()
        if obj is None:
            return Response({"error": "Financial year not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = FinancialYearSerializer(obj, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        start_date = serializer.validated_data.get("start_date", obj.start_date)
        end_date = serializer.validated_data.get("end_date", obj.end_date)
        if end_date < start_date:
            return Response({"error": "End date must be on or after start date."}, status=status.HTTP_400_BAD_REQUEST)
        overlap_error = _financial_year_overlap_error(
            tenant=tenant,
            start_date=start_date,
            end_date=end_date,
            exclude_id=obj.id,
        )
        if overlap_error:
            return Response({"error": overlap_error}, status=status.HTTP_400_BAD_REQUEST)
        updated = serializer.save()
        if updated.status == "closed":
            updated.periods.filter(status__in=["draft", "open"]).update(status="closed")
        elif updated.status == "open":
            updated.periods.filter(status="draft").update(status="open")
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=tenant,
                financial_year=updated,
                performed_by=request.user,
                action="financial-year-updated",
                note=f"Financial year updated to status {updated.status}.",
                metadata={"status": updated.status},
            )
        return Response(FinancialYearSerializer(updated).data)


class FinancialYearGeneratePeriodsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        year_obj = _apply_tenant_filter(FinancialYear.objects.all(), request.user).filter(pk=pk).first()
        if year_obj is None:
            return Response({"error": "Financial year not found."}, status=status.HTTP_404_NOT_FOUND)
        created = _generate_month_periods(year_obj)
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=year_obj.tenant,
                financial_year=year_obj,
                performed_by=request.user,
                action="financial-year-updated",
                note="Generated monthly periods for financial year.",
                metadata={"periods_created": created},
            )
        return Response({
            "message": f"Generated {created} period(s).",
            "financial_year": FinancialYearSerializer(year_obj).data,
        })


class AccountingPeriodListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        qs = _apply_tenant_filter(
            AccountingPeriod.objects.select_related("financial_year"),
            request.user,
        ).order_by("-start_date", "-sequence_number", "-id")
        if financial_year_id := request.query_params.get("financial_year_id"):
            qs = qs.filter(financial_year_id=financial_year_id)
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if search := request.query_params.get("search"):
            qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search))
        try:
            page = max(int(request.query_params.get("page", 1)), 1)
        except ValueError:
            page = 1
        try:
            page_size = min(max(int(request.query_params.get("page_size", 12)), 1), 100)
        except ValueError:
            page_size = 12
        total = qs.count()
        start = (page - 1) * page_size
        end = start + page_size
        rows = qs[start:end]
        return Response({
            "results": AccountingPeriodSerializer(rows, many=True).data,
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max((total + page_size - 1) // page_size, 1),
        })

    def post(self, request):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        serializer = AccountingPeriodSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        financial_year = serializer.validated_data["financial_year"]
        if tenant and financial_year.tenant_id != tenant.pk:
            return Response({"error": "Financial year belongs to a different tenant."}, status=status.HTTP_400_BAD_REQUEST)
        start_date = serializer.validated_data["start_date"]
        end_date = serializer.validated_data["end_date"]
        if end_date < start_date:
            return Response({"error": "End date must be on or after start date."}, status=status.HTTP_400_BAD_REQUEST)
        overlap_error = _accounting_period_overlap_error(
            tenant=tenant,
            financial_year=financial_year,
            start_date=start_date,
            end_date=end_date,
        )
        if overlap_error:
            return Response({"error": overlap_error}, status=status.HTTP_400_BAD_REQUEST)
        period = serializer.save(tenant=tenant)
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=tenant,
                financial_year=period.financial_year,
                period=period,
                performed_by=request.user,
                action="created",
                note="Accounting period created manually.",
                metadata={"status": period.status},
            )
        return Response(AccountingPeriodSerializer(period).data, status=status.HTTP_201_CREATED)


class AccountingPeriodDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = _apply_tenant_filter(AccountingPeriod.objects.select_related("financial_year"), request.user).filter(pk=pk).first()
        if obj is None:
            return Response({"error": "Accounting period not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = AccountingPeriodSerializer(obj, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        financial_year = serializer.validated_data.get("financial_year", obj.financial_year)
        start_date = serializer.validated_data.get("start_date", obj.start_date)
        end_date = serializer.validated_data.get("end_date", obj.end_date)
        if end_date < start_date:
            return Response({"error": "End date must be on or after start date."}, status=status.HTTP_400_BAD_REQUEST)
        overlap_error = _accounting_period_overlap_error(
            tenant=obj.tenant,
            financial_year=financial_year,
            start_date=start_date,
            end_date=end_date,
            exclude_id=obj.id,
        )
        if overlap_error:
            return Response({"error": overlap_error}, status=status.HTTP_400_BAD_REQUEST)
        updated = serializer.save()
        return Response(AccountingPeriodSerializer(updated).data)


class AccountingPeriodOpenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        period = _apply_tenant_filter(AccountingPeriod.objects.select_related("financial_year"), request.user).filter(pk=pk).first()
        if period is None:
            return Response({"error": "Accounting period not found."}, status=status.HTTP_404_NOT_FOUND)
        if period.financial_year.status == "closed":
            return Response({"error": "Cannot reopen a period in a closed financial year."}, status=status.HTTP_400_BAD_REQUEST)
        period.status = "open"
        period.save(update_fields=["status", "updated_at"])
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=period.tenant,
                financial_year=period.financial_year,
                period=period,
                performed_by=request.user,
                action="reopened",
                note="Accounting period reopened.",
                metadata={"status": "open"},
            )
        return Response({"message": f"{period.name} reopened successfully.", "period": AccountingPeriodSerializer(period).data})


class AccountingPeriodCloseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        period = _apply_tenant_filter(AccountingPeriod.objects.select_related("financial_year"), request.user).filter(pk=pk).first()
        if period is None:
            return Response({"error": "Accounting period not found."}, status=status.HTTP_404_NOT_FOUND)
        period.status = "closed"
        period.save(update_fields=["status", "updated_at"])
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=period.tenant,
                financial_year=period.financial_year,
                period=period,
                performed_by=request.user,
                action="closed",
                note="Accounting period closed.",
                metadata={"status": "closed"},
            )
        return Response({"message": f"{period.name} closed successfully.", "period": AccountingPeriodSerializer(period).data})


class AccountingPeriodLockView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        period = _apply_tenant_filter(AccountingPeriod.objects.select_related("financial_year"), request.user).filter(pk=pk).first()
        if period is None:
            return Response({"error": "Accounting period not found."}, status=status.HTTP_404_NOT_FOUND)
        period.status = "locked"
        period.save(update_fields=["status", "updated_at"])
        if create_period_audit_log is not None:
            create_period_audit_log(
                tenant=period.tenant,
                financial_year=period.financial_year,
                period=period,
                performed_by=request.user,
                action="locked",
                note="Accounting period locked.",
                metadata={"status": "locked"},
            )
        return Response({"message": f"{period.name} locked successfully.", "period": AccountingPeriodSerializer(period).data})


class AccountingPeriodAuditLogListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        qs = _apply_tenant_filter(
            AccountingPeriodAuditLog.objects.select_related("financial_year", "period", "performed_by"),
            request.user,
        )
        if period_id := request.query_params.get("period_id"):
            qs = qs.filter(period_id=period_id)
        if financial_year_id := request.query_params.get("financial_year_id"):
            qs = qs.filter(financial_year_id=financial_year_id)
        return Response(AccountingPeriodAuditLogSerializer(qs[:200], many=True).data)


class AccountingPostingRuleListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_ACCOUNTING:
            return Response([])
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        qs = _apply_tenant_filter(
            AccountingPostingRule.objects.select_related(
                "journal", "debit_account", "credit_account",
            ),
            request.user,
        ).order_by("source_type", "-is_primary", "payment_method_code", "name")
        p = request.query_params
        if source_type := p.get("source_type"):
            qs = qs.filter(source_type=source_type)
        if payment_method_code := p.get("payment_method_code"):
            qs = qs.filter(payment_method_code__icontains=payment_method_code)
        if (is_active := p.get("is_active")) is not None:
            qs = qs.filter(is_active=(is_active.lower() == "true"))
        if q := p.get("search"):
            qs = qs.filter(
                Q(name__icontains=q) |
                Q(description__icontains=q) |
                Q(payment_method_code__icontains=q) |
                Q(journal__code__icontains=q) |
                Q(debit_account__code__icontains=q) |
                Q(credit_account__code__icontains=q)
            )
        return Response(AccountingPostingRuleSerializer(qs, many=True).data)

    def post(self, request):
        if not HAS_ACCOUNTING:
            return Response({"error": "Accounting module not available."}, status=503)
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        ser = AccountingPostingRuleSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        journal = ser.validated_data.get("journal")
        debit_account = ser.validated_data.get("debit_account")
        credit_account = ser.validated_data.get("credit_account")
        for label, obj in [("Journal", journal), ("Debit account", debit_account), ("Credit account", credit_account)]:
            if obj and tenant and obj.tenant_id != tenant.pk:
                return Response({"error": f"{label} belongs to a different tenant."}, status=status.HTTP_400_BAD_REQUEST)
        rule = ser.save(tenant=tenant)
        if rule.is_primary:
            AccountingPostingRule.objects.filter(
                tenant=tenant,
                source_type=rule.source_type,
                payment_method_code=rule.payment_method_code,
            ).exclude(pk=rule.pk).update(is_primary=False)
        return Response(AccountingPostingRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class AccountingPostingRuleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            AccountingPostingRule.objects.select_related("journal", "debit_account", "credit_account"),
            user,
        )
        try:
            return qs.get(pk=pk)
        except AccountingPostingRule.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        return Response(AccountingPostingRuleSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        ser = AccountingPostingRuleSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        for field in ("journal", "debit_account", "credit_account"):
            related = ser.validated_data.get(field)
            if related and tenant and related.tenant_id != tenant.pk:
                return Response({"error": f"{field.replace('_', ' ').title()} belongs to a different tenant."}, status=status.HTTP_400_BAD_REQUEST)
        rule = ser.save()
        if rule.is_primary:
            AccountingPostingRule.objects.filter(
                tenant=tenant,
                source_type=rule.source_type,
                payment_method_code=rule.payment_method_code,
            ).exclude(pk=rule.pk).update(is_primary=False)
        return Response(AccountingPostingRuleSerializer(rule).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TrialBalanceReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        date_from = period.start_date if period else _parse_date_param(request.query_params.get("date_from"))
        date_to = period.end_date if period else (_parse_date_param(request.query_params.get("date_to")) or timezone.now().date())
        active_param = request.query_params.get("is_active")
        is_active = None if active_param not in {"true", "false"} else active_param == "true"
        payload = _trial_balance_rows(
            request.user,
            date_from=date_from,
            date_to=date_to,
            account_type=request.query_params.get("account_type") or None,
            account_group=request.query_params.get("account_group") or None,
            is_active=is_active,
            show_zero_balance=request.query_params.get("show_zero_balance") == "true",
        )
        payload["date_from"] = date_from.isoformat() if date_from else None
        payload["date_to"] = date_to.isoformat()
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class IncomeStatementReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        date_to = period.end_date if period else (_parse_date_param(request.query_params.get("date_to")) or timezone.now().date())
        date_from = period.start_date if period else (_parse_date_param(request.query_params.get("date_from")) or date_to.replace(month=1, day=1))
        payload = _income_statement_payload(request.user, date_from=date_from, date_to=date_to)
        payload["date_from"] = date_from.isoformat()
        payload["date_to"] = date_to.isoformat()
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class BalanceSheetReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        date_to = period.end_date if period else (_parse_date_param(request.query_params.get("date_to")) or timezone.now().date())
        payload = _balance_sheet_payload(request.user, date_to=date_to)
        payload["date_to"] = date_to.isoformat()
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class ComparativeIncomeStatementReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        current_to = period.end_date if period else (_parse_date_param(request.query_params.get("date_to")) or timezone.now().date())
        current_from = period.start_date if period else (_parse_date_param(request.query_params.get("date_from")) or current_to.replace(month=1, day=1))
        compare_from, compare_to = _previous_period_range(current_from, current_to)
        current = _income_statement_payload(request.user, date_from=current_from, date_to=current_to)
        previous = _income_statement_payload(request.user, date_from=compare_from, date_to=compare_to)
        return Response({
            "current": {
                "date_from": current_from.isoformat(),
                "date_to": current_to.isoformat(),
                **current,
            },
            "comparison": {
                "date_from": compare_from.isoformat(),
                "date_to": compare_to.isoformat(),
                **previous,
            },
            "period": AccountingPeriodSerializer(period).data if period else None,
        })


class ComparativeBalanceSheetReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        current_to = period.end_date if period else (_parse_date_param(request.query_params.get("date_to")) or timezone.now().date())
        compare_to = current_to.replace(year=current_to.year - 1) if current_to.month != 2 or current_to.day != 29 else current_to.replace(year=current_to.year - 1, day=28)
        current = _balance_sheet_payload(request.user, date_to=current_to)
        previous = _balance_sheet_payload(request.user, date_to=compare_to)
        return Response({
            "current": {
                "date_to": current_to.isoformat(),
                **current,
            },
            "comparison": {
                "date_to": compare_to.isoformat(),
                **previous,
            },
            "period": AccountingPeriodSerializer(period).data if period else None,
        })


class RetainedEarningsRollforwardReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        date_to = period.end_date if period else (_parse_date_param(request.query_params.get("date_to")) or timezone.now().date())
        date_from = period.start_date if period else (_parse_date_param(request.query_params.get("date_from")) or date_to.replace(month=1, day=1))
        payload = _retained_earnings_rollforward_payload(request.user, tenant=tenant, date_from=date_from, date_to=date_to)
        if payload.get("error"):
            return Response({"error": payload["error"]}, status=status.HTTP_400_BAD_REQUEST)
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class GeneralLedgerReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        account_id = request.query_params.get("account_id")
        if not account_id:
            return Response({"error": "account_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        date_from = period.start_date if period else _parse_date_param(request.query_params.get("date_from"))
        date_to = period.end_date if period else _parse_date_param(request.query_params.get("date_to"))
        account = _apply_tenant_filter(Account.objects.all(), request.user).filter(pk=account_id).first()
        if account is None:
            return Response({"error": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        payload = _ledger_activity_payload(request.user, account=account, date_from=date_from, date_to=date_to)
        payload["date_from"] = date_from.isoformat() if date_from else None
        payload["date_to"] = date_to.isoformat() if date_to else None
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class AccountActivityView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.query_params.get("period_id"))
        date_from = period.start_date if period else _parse_date_param(request.query_params.get("date_from"))
        date_to = period.end_date if period else _parse_date_param(request.query_params.get("date_to"))
        account = _apply_tenant_filter(Account.objects.all(), request.user).filter(pk=pk).first()
        if account is None:
            return Response({"error": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        payload = _ledger_activity_payload(request.user, account=account, date_from=date_from, date_to=date_to)
        payload["date_from"] = date_from.isoformat() if date_from else None
        payload["date_to"] = date_to.isoformat() if date_to else None
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class PeriodClosePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.data.get("period_id"))
        date_to = period.end_date if period else (_parse_date_param(request.data.get("date_to")) or timezone.now().date())
        date_from = period.start_date if period else (_parse_date_param(request.data.get("date_from")) or date_to.replace(month=1, day=1))
        payload = _closing_payload(request.user, tenant=tenant, date_from=date_from, date_to=date_to)
        if payload.get("error"):
            return Response({"error": payload["error"]}, status=status.HTTP_400_BAD_REQUEST)
        payload["existing_close"] = JournalEntry.objects.filter(
            tenant=tenant,
            source_reference=f"period-close:{date_from.isoformat()}:{date_to.isoformat()}",
            status="posted",
        ).exists()
        payload["period"] = AccountingPeriodSerializer(period).data if period else None
        return Response(payload)


class PeriodCloseExecuteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        period = _resolve_period(request.user, period_id=request.data.get("period_id"))
        date_to = period.end_date if period else (_parse_date_param(request.data.get("date_to")) or timezone.now().date())
        date_from = period.start_date if period else (_parse_date_param(request.data.get("date_from")) or date_to.replace(month=1, day=1))
        source_reference = f"period-close:{date_from.isoformat()}:{date_to.isoformat()}"
        existing = JournalEntry.objects.filter(tenant=tenant, source_reference=source_reference, status="posted").first()
        if existing:
            return Response(
                {"error": f"Period already closed with entry {existing.entry_number}.", "entry_id": existing.id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = _closing_payload(request.user, tenant=tenant, date_from=date_from, date_to=date_to)
        if payload.get("error"):
            return Response({"error": payload["error"]}, status=status.HTTP_400_BAD_REQUEST)
        if not payload["balanced"]:
            return Response({"error": "Closing entry is not balanced."}, status=status.HTTP_400_BAD_REQUEST)

        non_zero_lines = [
            line for line in payload["lines"]
            if abs(float(line["debit_amount"])) > 0 or abs(float(line["credit_amount"])) > 0
        ]
        if not non_zero_lines:
            return Response({"error": "No income statement balances found for the selected period."}, status=status.HTTP_400_BAD_REQUEST)

        journal = Journal.objects.filter(tenant=tenant, code="ADJ", is_active=True).first() or Journal.objects.filter(tenant=tenant, is_active=True).order_by("code").first()
        if journal is None:
            return Response({"error": "No journal available for period close."}, status=status.HTTP_400_BAD_REQUEST)

        entry = JournalEntry.objects.create(
            tenant=tenant,
            journal=journal,
            entry_date=timezone.make_aware(datetime.datetime.combine(date_to, datetime.time.min)),
            source_type="manual",
            source_reference=source_reference,
            memo=f"Period close for {date_from.isoformat()} to {date_to.isoformat()}",
            status="posted",
        )
        for line in non_zero_lines:
            account = Account.objects.filter(tenant=tenant, pk=line["account_id"]).first()
            if account is None:
                continue
            JournalEntryLine.objects.create(
                entry=entry,
                account=account,
                description=f"Period close {date_from.isoformat()} to {date_to.isoformat()}",
                debit_amount=Decimal(str(line["debit_amount"] or 0)),
                credit_amount=Decimal(str(line["credit_amount"] or 0)),
            )
        if period is not None:
            period.status = "closed"
            period.save(update_fields=["status", "updated_at"])
            if create_period_audit_log is not None:
                create_period_audit_log(
                    tenant=period.tenant,
                    financial_year=period.financial_year,
                    period=period,
                    performed_by=request.user,
                    action="closed",
                    note=f"Closed with journal entry {entry.entry_number}.",
                    metadata={"entry_id": entry.id, "entry_number": entry.entry_number},
                )
        return Response({
            "message": f"Period closed successfully with entry {entry.entry_number}.",
            "entry_id": entry.id,
            "entry_number": entry.entry_number,
            "period_start": date_from.isoformat(),
            "period_end": date_to.isoformat(),
            "period": AccountingPeriodSerializer(period).data if period else None,
        }, status=status.HTTP_201_CREATED)


class JournalEntryPostView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = JournalEntryDetailView()._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        if obj.status == "posted":
            return Response({"error": "Entry is already posted."}, status=status.HTTP_400_BAD_REQUEST)
        if obj.status == "reversed":
            return Response({"error": "Reversed entries cannot be reposted."}, status=status.HTTP_400_BAD_REQUEST)
        posting_error = _assert_posting_allowed_response(
            tenant=obj.tenant,
            posting_date=obj.entry_date,
            source_label="manual entry post",
        )
        if posting_error is not None:
            return posting_error
        line_error = _validate_entry_lines(lines=[
            {
                "account": line.account,
                "debit_amount": line.debit_amount,
                "credit_amount": line.credit_amount,
            }
            for line in obj.lines.all()
        ], tenant=obj.tenant)
        if line_error:
            return Response({"error": line_error}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = "posted"
        obj.save(update_fields=["status", "updated_at"])
        return Response({"message": f"Entry {obj.entry_number} posted successfully."})


class JournalEntryReverseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = JournalEntryDetailView()._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=404)
        if obj.status == "reversed":
            return Response({"error": "Entry has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)
        posting_error = _assert_posting_allowed_response(
            tenant=tenant,
            posting_date=timezone.now(),
            source_label="reversal entry",
        )
        if posting_error is not None:
            return posting_error
        reversal_journal = obj.journal
        reversal = JournalEntry.objects.create(
            tenant=tenant,
            journal=reversal_journal,
            entry_date=timezone.now(),
            source_type="manual",
            source_reference=f"{obj.entry_number}:reversal",
            memo=f"Reversal of {obj.entry_number}",
            status="posted",
        )
        for line in obj.lines.all():
            JournalEntryLine.objects.create(
                entry=reversal,
                account=line.account,
                description=f"Reversal of {line.description or obj.entry_number}",
                debit_amount=line.credit_amount,
                credit_amount=line.debit_amount,
            )
        obj.status = "reversed"
        obj.save(update_fields=["status", "updated_at"])
        return Response({
            "message": f"Entry {obj.entry_number} reversed successfully.",
            "reversal_entry_id": reversal.pk,
            "reversal_entry_number": reversal.entry_number,
        }, status=status.HTTP_201_CREATED)


class BankReconciliationSessionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_ACCOUNTING:
            return Response([])
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        qs = _apply_tenant_filter(
            BankReconciliationSession.objects.select_related("account", "financial_year", "period"),
            request.user,
        ).order_by("-statement_date_to", "-id")
        if account_id := request.query_params.get("account_id"):
            qs = qs.filter(account_id=account_id)
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if query := request.query_params.get("search"):
            qs = qs.filter(
                Q(code__icontains=query) |
                Q(name__icontains=query) |
                Q(account__code__icontains=query) |
                Q(account__name__icontains=query)
            )
        return Response(BankReconciliationSessionSerializer(qs[:200], many=True).data)

    def post(self, request):
        if not HAS_ACCOUNTING:
            return Response({"error": "Accounting module not available."}, status=503)
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
        account_id = request.data.get("account")
        if not account_id:
            return Response({"error": "account is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            account = Account.objects.get(pk=account_id, tenant=tenant)
        except Account.DoesNotExist:
            return Response({"error": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        financial_year = None
        if request.data.get("financial_year"):
            financial_year = _apply_tenant_filter(FinancialYear.objects.all(), request.user).filter(
                pk=request.data.get("financial_year")
            ).first()
            if financial_year is None:
                return Response({"error": "Financial year not found."}, status=status.HTTP_404_NOT_FOUND)

        period = None
        if request.data.get("period"):
            period = _apply_tenant_filter(AccountingPeriod.objects.select_related("financial_year"), request.user).filter(
                pk=request.data.get("period")
            ).first()
            if period is None:
                return Response({"error": "Accounting period not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            session = BankReconciliationSession.objects.create(
                tenant=tenant,
                account=account,
                financial_year=financial_year,
                period=period,
                name=request.data.get("name") or f"{account.name} reconciliation",
                code=request.data.get("code", "") or "",
                statement_date_from=_parse_date_param(request.data.get("statement_date_from")),
                statement_date_to=_parse_date_param(request.data.get("statement_date_to")),
                statement_opening_balance=Decimal(str(request.data.get("statement_opening_balance") or 0)),
                statement_closing_balance=Decimal(str(request.data.get("statement_closing_balance") or 0)),
                notes=request.data.get("notes", "") or "",
                status=request.data.get("status") or "draft",
                metadata=request.data.get("metadata") or {},
            )
        except (ValidationError, ValueError) as exc:
            message = exc.message_dict if hasattr(exc, "message_dict") else str(exc)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)

        return Response(BankReconciliationSessionSerializer(session).data, status=status.HTTP_201_CREATED)


class BankReconciliationSessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        return _apply_tenant_filter(
            BankReconciliationSession.objects.select_related("account", "financial_year", "period"),
            request.user,
        ).filter(pk=pk).first()

    def get(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = self._get(request, pk)
        if obj is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(BankReconciliationSessionSerializer(obj).data)

    def patch(self, request, pk):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = self._get(request, pk)
        if obj is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if obj.status == "completed" and request.data.get("status") not in {None, "completed"}:
            return Response({"error": "Completed reconciliation sessions cannot be reopened from this screen."}, status=400)
        for field in ("name", "code", "notes", "status"):
            if field in request.data:
                setattr(obj, field, request.data.get(field) or "")
        if "statement_date_from" in request.data:
            obj.statement_date_from = _parse_date_param(request.data.get("statement_date_from"))
        if "statement_date_to" in request.data:
            obj.statement_date_to = _parse_date_param(request.data.get("statement_date_to"))
        if "statement_opening_balance" in request.data:
            obj.statement_opening_balance = Decimal(str(request.data.get("statement_opening_balance") or 0))
        if "statement_closing_balance" in request.data:
            obj.statement_closing_balance = Decimal(str(request.data.get("statement_closing_balance") or 0))
        if "account" in request.data:
            account = Account.objects.filter(pk=request.data.get("account"), tenant=tenant).first()
            if account is None:
                return Response({"error": "Account not found."}, status=404)
            obj.account = account
        if "financial_year" in request.data:
            obj.financial_year = _apply_tenant_filter(FinancialYear.objects.all(), request.user).filter(
                pk=request.data.get("financial_year")
            ).first()
        if "period" in request.data:
            obj.period = _apply_tenant_filter(AccountingPeriod.objects.all(), request.user).filter(
                pk=request.data.get("period")
            ).first()
        try:
            obj.save()
        except (ValidationError, ValueError) as exc:
            message = exc.message_dict if hasattr(exc, "message_dict") else str(exc)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BankReconciliationSessionSerializer(obj).data)


class BankReconciliationLineListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _session(self, request, session_pk):
        return _apply_tenant_filter(
            BankReconciliationSession.objects.select_related("account", "financial_year", "period"),
            request.user,
        ).filter(pk=session_pk).first()

    def get(self, request, session_pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        session = self._session(request, session_pk)
        if session is None:
            return Response({"error": "Reconciliation session not found."}, status=404)
        qs = session.lines.select_related("matched_journal_line__entry", "matched_journal_line__account").order_by("line_date", "id")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        return Response({
            "session": BankReconciliationSessionSerializer(session).data,
            "book_closing_balance": float(_book_balance_for_account(request.user, account=session.account, date_to=session.statement_date_to)),
            "results": BankStatementLineSerializer(qs[:500], many=True).data,
        })

    def post(self, request, session_pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        session = self._session(request, session_pk)
        if session is None:
            return Response({"error": "Reconciliation session not found."}, status=404)
        if session.status == "completed":
            return Response({"error": "Completed reconciliation sessions do not accept new statement lines."}, status=400)
        try:
            line = BankStatementLine.objects.create(
                tenant=session.tenant,
                session=session,
                line_date=_parse_date_param(request.data.get("line_date")),
                reference=request.data.get("reference", "") or "",
                description=request.data.get("description", "") or "",
                amount=Decimal(str(request.data.get("amount") or 0)),
                notes=request.data.get("notes", "") or "",
                metadata=request.data.get("metadata") or {},
            )
        except (ValidationError, ValueError) as exc:
            message = exc.message_dict if hasattr(exc, "message_dict") else str(exc)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)
        if session.status == "draft":
            session.status = "in_progress"
            session.save(update_fields=["status", "updated_at"])
        return Response(BankStatementLineSerializer(line).data, status=status.HTTP_201_CREATED)


class BankReconciliationLineDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        return _apply_tenant_filter(
            BankStatementLine.objects.select_related(
                "session",
                "session__account",
                "matched_journal_line__entry",
                "matched_journal_line__account",
            ),
            request.user,
        ).filter(pk=pk).first()

    def patch(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = self._get(request, pk)
        if obj is None:
            return Response({"error": "Not found."}, status=404)
        if obj.session.status == "completed":
            return Response({"error": "Completed reconciliation sessions cannot be edited."}, status=400)
        if "line_date" in request.data:
            obj.line_date = _parse_date_param(request.data.get("line_date"))
        for field in ("reference", "description", "notes"):
            if field in request.data:
                setattr(obj, field, request.data.get(field) or "")
        if "amount" in request.data:
            obj.amount = Decimal(str(request.data.get("amount") or 0))
        requested_status = request.data.get("status")
        if requested_status in {"open", "ignored"}:
            obj.status = requested_status
            if requested_status == "open":
                obj.matched_journal_line = None
                obj.matched_at = None
                obj.matched_by = None
        try:
            obj.save()
        except (ValidationError, ValueError) as exc:
            message = exc.message_dict if hasattr(exc, "message_dict") else str(exc)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BankStatementLineSerializer(obj).data)


class BankReconciliationLineCandidatesView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        obj = _apply_tenant_filter(
            BankStatementLine.objects.select_related("session", "session__account"),
            request.user,
        ).filter(pk=pk).first()
        if obj is None:
            return Response({"error": "Not found."}, status=404)
        return Response({
            "line": BankStatementLineSerializer(obj).data,
            "candidates": _reconciliation_candidate_rows(obj),
        })


class BankReconciliationLineMatchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        line = _apply_tenant_filter(
            BankStatementLine.objects.select_related("session", "session__account"),
            request.user,
        ).filter(pk=pk).first()
        if line is None:
            return Response({"error": "Not found."}, status=404)
        if line.session.status == "completed":
            return Response({"error": "Completed reconciliation sessions cannot be changed."}, status=400)
        journal_line_id = request.data.get("journal_line_id")
        if not journal_line_id:
            return Response({"error": "journal_line_id is required."}, status=400)
        journal_line = _apply_tenant_filter(
            JournalEntryLine.objects.select_related("entry", "account"),
            request.user,
            filter_field="entry__tenant",
        ).filter(pk=journal_line_id).first()
        if journal_line is None:
            return Response({"error": "Journal line not found."}, status=404)
        if journal_line.entry.status != "posted":
            return Response({"error": "Only posted journal lines can be reconciled."}, status=400)
        if journal_line.account_id != line.session.account_id:
            return Response({"error": "Journal line does not belong to the selected reconciliation account."}, status=400)
        if hasattr(journal_line, "reconciliation_statement_line") and journal_line.reconciliation_statement_line.pk != line.pk:
            return Response({"error": "Journal line is already matched to another statement line."}, status=400)
        statement_amount = Decimal(str(line.amount or 0))
        journal_amount = _signed_amount_for_account_type(
            journal_line.account.account_type,
            Decimal(str(journal_line.debit_amount or 0)),
            Decimal(str(journal_line.credit_amount or 0)),
        )
        if abs(statement_amount - journal_amount) > Decimal("0.01"):
            return Response(
                {
                    "error": (
                        "Statement line amount does not match the selected journal line. "
                        "Use a journal line with the same signed amount."
                    )
                },
                status=400,
            )
        line.matched_journal_line = journal_line
        line.status = "matched"
        line.matched_by = request.user
        line.matched_at = timezone.now()
        line.save()
        if line.session.status == "draft":
            line.session.status = "in_progress"
            line.session.save(update_fields=["status", "updated_at"])
        return Response(BankStatementLineSerializer(line).data)


class BankReconciliationLineUnmatchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        line = _apply_tenant_filter(BankStatementLine.objects.select_related("session"), request.user).filter(pk=pk).first()
        if line is None:
            return Response({"error": "Not found."}, status=404)
        if line.session.status == "completed":
            return Response({"error": "Completed reconciliation sessions cannot be changed."}, status=400)
        line.matched_journal_line = None
        line.matched_at = None
        line.matched_by = None
        line.status = "open"
        line.save()
        return Response(BankStatementLineSerializer(line).data)


class AccountingResyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        tenant, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        seeded = _ensure_accounting_seeded(request.user)
        invoice_count = 0
        bill_count = 0
        transaction_count = 0
        errors = []

        if HAS_WEIGHBRIDGE and sync_invoice_posting is not None:
            invoices = Invoice.objects.filter(status__in=["issued", "paid", "overdue"])
            if tenant is not None:
                invoices = invoices.filter(tenant=tenant)
            for invoice in invoices:
                try:
                    sync_invoice_posting(invoice)
                    invoice_count += 1
                except Exception as exc:
                    logger.exception("Failed to resync accounting for invoice %s", invoice.pk)
                    errors.append({
                        "source_type": "invoice",
                        "source_id": invoice.pk,
                        "reference": getattr(invoice, "invoice_number", ""),
                        "error": str(exc),
                    })

        if HAS_PROCUREMENT and sync_bill_posting is not None:
            bills = Bill.objects.filter(status__in=["received", "approved", "paid", "overdue"])
            if tenant is not None:
                bills = bills.filter(tenant=tenant)
            for bill in bills:
                try:
                    sync_bill_posting(bill)
                    bill_count += 1
                except Exception as exc:
                    logger.exception("Failed to resync accounting for bill %s", bill.pk)
                    errors.append({
                        "source_type": "bill",
                        "source_id": bill.pk,
                        "reference": getattr(bill, "bill_number", ""),
                        "error": str(exc),
                    })

        if HAS_WEIGHBRIDGE and sync_transaction_posting is not None:
            transactions = Transaction.objects.filter(status="Completed", payment_status="Paid")
            if tenant is not None:
                transactions = transactions.filter(tenant=tenant)
            for tx in transactions:
                try:
                    sync_transaction_posting(tx)
                    transaction_count += 1
                except Exception as exc:
                    logger.exception("Failed to resync accounting for transaction %s", tx.pk)
                    errors.append({
                        "source_type": "transaction",
                        "source_id": tx.pk,
                        "reference": f"TX-{tx.pk:05d}",
                        "error": str(exc),
                    })

        return Response({
            "message": (
                "Accounting postings re-synced from operational documents."
                if not errors else
                f"Accounting re-sync completed with {len(errors)} error(s)."
            ),
            "seeded": seeded,
            "invoices_processed": invoice_count,
            "bills_processed": bill_count,
            "transactions_processed": transaction_count,
            "errors": errors[:25],
        })


# ── Journals list (for dropdowns) ─────────────────────────────────────────────

class JournalListView(APIView):
    """GET /api/accounting/journals/ — list journals for dropdown selects."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_ACCOUNTING:
            return Response({"journals": []})
        _, denied = _accounting_enabled_or_response(request.user)
        if denied is not None:
            return denied
        _ensure_accounting_seeded(request.user)
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
