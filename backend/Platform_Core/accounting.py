import calendar
import datetime
from decimal import Decimal

from django.utils import timezone
from django.db import transaction
from django.db.utils import OperationalError, ProgrammingError

from Platform_Core.audit import log_business_event
from Platform_Core.models import (
    Account,
    AccountingPeriod,
    AccountingPeriodAuditLog,
    AccountingPostingRule,
    FinancialYear,
    Journal,
    JournalEntry,
    JournalEntryLine,
)


DEFAULT_ACCOUNT_CODES = {
    "receivable": "1200",
    "payable": "2110",
    "cash": "1120",
    "bank": "1130",
    "income": "4100",
    "expense": "5100",
}

PAYMENT_MODE_TO_ACCOUNT = {
    "cash": "cash",
    "mpesa": "bank",
    "card": "bank",
    "bank transfer": "bank",
    "bank deposit": "bank",
    "debt": "receivable",
}

SOURCE_TYPE_BILL = "bill"

DEFAULT_ACCOUNT_MATRIX = [
    {"code": "1000", "name": "Assets", "account_type": "asset", "parent": None, "allow_posting": False},
    {"code": "1100", "name": "Current Assets", "account_type": "asset", "parent": "1000", "allow_posting": False},
    {"code": "1120", "name": "Cash", "account_type": "asset", "parent": "1100", "allow_posting": True},
    {"code": "1130", "name": "Bank", "account_type": "asset", "parent": "1100", "allow_posting": True},
    {"code": "1200", "name": "Accounts Receivable", "account_type": "asset", "parent": "1100", "allow_posting": True},
    {"code": "1300", "name": "Inventory", "account_type": "asset", "parent": "1100", "allow_posting": True},
    {"code": "2000", "name": "Liabilities", "account_type": "liability", "parent": None, "allow_posting": False},
    {"code": "2100", "name": "Current Liabilities", "account_type": "liability", "parent": "2000", "allow_posting": False},
    {"code": "2110", "name": "Accounts Payable", "account_type": "liability", "parent": "2100", "allow_posting": True},
    {"code": "2120", "name": "Tax Payable", "account_type": "liability", "parent": "2100", "allow_posting": True},
    {"code": "3000", "name": "Equity", "account_type": "equity", "parent": None, "allow_posting": False},
    {"code": "3100", "name": "Owner Equity", "account_type": "equity", "parent": "3000", "allow_posting": True},
    {"code": "3200", "name": "Retained Earnings", "account_type": "equity", "parent": "3000", "allow_posting": True},
    {"code": "4000", "name": "Income", "account_type": "income", "parent": None, "allow_posting": False},
    {"code": "4100", "name": "Sales Revenue", "account_type": "income", "parent": "4000", "allow_posting": True},
    {"code": "4200", "name": "Service Revenue", "account_type": "income", "parent": "4000", "allow_posting": True},
    {"code": "4900", "name": "Other Income", "account_type": "income", "parent": "4000", "allow_posting": True},
    {"code": "5000", "name": "Expenses", "account_type": "expense", "parent": None, "allow_posting": False},
    {"code": "5100", "name": "Operating Expense", "account_type": "expense", "parent": "5000", "allow_posting": True},
    {"code": "5200", "name": "Utilities Expense", "account_type": "expense", "parent": "5000", "allow_posting": True},
    {"code": "5300", "name": "Payroll Expense", "account_type": "expense", "parent": "5000", "allow_posting": True},
    {"code": "5400", "name": "Purchases Expense", "account_type": "expense", "parent": "5000", "allow_posting": True},
    {"code": "5500", "name": "Fuel and Transport Expense", "account_type": "expense", "parent": "5000", "allow_posting": True},
]

DEFAULT_JOURNALS = [
    {"code": "SALES", "name": "Sales Journal", "journal_type": "sales"},
    {"code": "BANK", "name": "Bank Journal", "journal_type": "bank"},
    {"code": "CASH", "name": "Cash Journal", "journal_type": "cash"},
    {"code": "GEN", "name": "General Journal", "journal_type": "general"},
    {"code": "ADJ", "name": "Adjustment Journal", "journal_type": "adjustment"},
]


def _period_end_for_month(year: int, month: int):
    return datetime.date(year, month, calendar.monthrange(year, month)[1])


def _normalize_posting_date(value):
    if value is None:
        return timezone.localdate()
    if hasattr(value, "date"):
        return value.date()
    return value


def get_accounting_period_for_date(tenant, posting_date):
    posting_date = _normalize_posting_date(posting_date)
    if tenant is None:
        return None
    return AccountingPeriod.objects.filter(
        tenant=tenant,
        start_date__lte=posting_date,
        end_date__gte=posting_date,
    ).order_by("-start_date", "-id").first()


def assert_posting_allowed(*, tenant, posting_date, source_label="transaction"):
    posting_date = _normalize_posting_date(posting_date)
    if tenant is None:
        return None
    matching_periods = list(AccountingPeriod.objects.filter(
        tenant=tenant,
        start_date__lte=posting_date,
        end_date__gte=posting_date,
    ).order_by("-start_date", "-id"))
    if not matching_periods:
        latest_prior_period = AccountingPeriod.objects.filter(
            tenant=tenant,
            end_date__lt=posting_date,
        ).order_by("-end_date", "-id").first()
        if latest_prior_period and latest_prior_period.status in {"closed", "locked"}:
            raise ValueError(
                f"Cannot post {source_label} because the accounting period is {latest_prior_period.status} "
                f"({latest_prior_period.name})."
            )
        return None
    blocked = next((period for period in matching_periods if period.status in {"closed", "locked"}), None)
    period = blocked or matching_periods[0]
    if blocked is not None:
        raise ValueError(
            f"Cannot post {source_label} into {period.name} because the accounting period is {period.status}."
        )
    return period


def create_period_audit_log(*, tenant, action: str, financial_year=None, period=None, performed_by=None, note="", metadata=None):
    if tenant is None:
        return None
    try:
        log_entry = AccountingPeriodAuditLog.objects.create(
            tenant=tenant,
            financial_year=financial_year,
            period=period,
            action=action,
            performed_by=performed_by,
            note=note,
            metadata=metadata or {},
        )
        log_business_event(
            event_group="workflow",
            event_type=action,
            tenant=tenant,
            actor=performed_by,
            obj=period or financial_year,
            note=note or f"Accounting period event: {action}",
            metadata=metadata or {},
        )
        return log_entry
    except (OperationalError, ProgrammingError):
        return None


def ensure_default_financial_year_setup(tenant):
    if tenant is None or not is_accounting_enabled_for_tenant(tenant):
        return {
            "financial_years_created": 0,
            "periods_created": 0,
            "financial_years_total": 0,
            "periods_total": 0,
        }

    today = timezone.localdate()
    year_start = datetime.date(today.year, 1, 1)
    year_end = datetime.date(today.year, 12, 31)
    fy_code = f"FY{today.year}"
    try:
        fy = FinancialYear.objects.filter(
            tenant=tenant,
            start_date__lte=today,
            end_date__gte=today,
        ).order_by("-start_date", "-id").first()
        fy_created = False
        if fy is None:
            fy, fy_created = FinancialYear.objects.get_or_create(
                tenant=tenant,
                code=fy_code,
                defaults={
                    "name": f"Financial Year {today.year}",
                    "start_date": year_start,
                    "end_date": year_end,
                    "status": "open",
                    "is_active": True,
                    "metadata": {"seeded": True},
                },
            )

        periods_created = 0
        for month in range(1, 13):
            start_date = datetime.date(today.year, month, 1)
            end_date = _period_end_for_month(today.year, month)
            period_code = f"{today.year}-{month:02d}"
            existing_period = AccountingPeriod.objects.filter(
                tenant=tenant,
                financial_year=fy,
                start_date__lte=end_date,
                end_date__gte=start_date,
            ).order_by("start_date", "id").first()
            if existing_period is not None:
                continue
            _, created = AccountingPeriod.objects.get_or_create(
                tenant=tenant,
                code=period_code,
                defaults={
                    "financial_year": fy,
                    "name": start_date.strftime("%b %Y"),
                    "start_date": start_date,
                    "end_date": end_date,
                    "period_type": "month",
                    "status": "open" if end_date >= today else "closed",
                    "sequence_number": month,
                    "is_adjustment": False,
                    "metadata": {"seeded": True},
                },
            )
            if created:
                periods_created += 1
                create_period_audit_log(
                    tenant=tenant,
                    financial_year=fy,
                    period=AccountingPeriod.objects.filter(tenant=tenant, code=period_code).first(),
                    action="created",
                    note="Seeded monthly accounting period.",
                    metadata={"seeded": True},
                )

        return {
            "financial_years_created": 1 if fy_created else 0,
            "periods_created": periods_created,
            "financial_years_total": FinancialYear.objects.filter(tenant=tenant).count(),
            "periods_total": AccountingPeriod.objects.filter(tenant=tenant).count(),
        }
    except (OperationalError, ProgrammingError):
        return {
            "financial_years_created": 0,
            "periods_created": 0,
            "financial_years_total": 0,
            "periods_total": 0,
        }


def is_accounting_enabled_for_tenant(tenant):
    if tenant is None:
        return True
    try:
        if not tenant.module_activations.exists():
            return True
        from Platform_Core.platform import get_active_tenant_module_slugs

        active_module_slugs = get_active_tenant_module_slugs(tenant)
        return "accounting" in active_module_slugs
    except Exception:
        return True


def _account_by_code_or_type(*, tenant, code_key: str, account_type: str):
    code = DEFAULT_ACCOUNT_CODES[code_key]
    account = Account.objects.filter(tenant=tenant, code=code, is_active=True).first()
    if account:
        return account
    return (
        Account.objects.filter(
            tenant=tenant,
            account_type=account_type,
            is_active=True,
            allow_posting=True,
        )
        .order_by("code")
        .first()
    )


def ensure_default_accounting_setup(tenant):
    if tenant is None:
        return {
            "accounts_created": 0,
            "journals_created": 0,
            "rules_created": 0,
            "accounts_total": 0,
            "journals_total": 0,
            "rules_total": 0,
        }
    if not is_accounting_enabled_for_tenant(tenant):
        return {
            "accounts_created": 0,
            "journals_created": 0,
            "rules_created": 0,
            "accounts_total": 0,
            "journals_total": 0,
            "rules_total": 0,
            "accounting_enabled": False,
        }

    account_map = {
        account.code: account
        for account in Account.objects.filter(tenant=tenant)
    }
    accounts_created = 0
    for spec in DEFAULT_ACCOUNT_MATRIX:
        account = account_map.get(spec["code"])
        parent = account_map.get(spec["parent"]) if spec["parent"] else None
        defaults = {
            "name": spec["name"],
            "account_type": spec["account_type"],
            "parent": parent,
            "allow_posting": spec["allow_posting"],
            "is_active": True,
            "metadata": {"seeded": True},
        }
        if account is None:
            account = Account.objects.create(tenant=tenant, code=spec["code"], **defaults)
            account_map[spec["code"]] = account
            accounts_created += 1
            continue

        changed = []
        for field, value in defaults.items():
            if getattr(account, field) != value:
                setattr(account, field, value)
                changed.append(field)
        if changed:
            account.save(update_fields=changed + ["updated_at"])

    journal_map = {
        journal.code: journal
        for journal in Journal.objects.filter(tenant=tenant)
    }
    journals_created = 0
    for spec in DEFAULT_JOURNALS:
        journal = journal_map.get(spec["code"])
        defaults = {
            "name": spec["name"],
            "journal_type": spec["journal_type"],
            "is_active": True,
            "metadata": {"seeded": True},
        }
        if journal is None:
            journal = Journal.objects.create(tenant=tenant, code=spec["code"], **defaults)
            journal_map[spec["code"]] = journal
            journals_created += 1
            continue
        changed = []
        for field, value in defaults.items():
            if getattr(journal, field) != value:
                setattr(journal, field, value)
                changed.append(field)
        if changed:
            journal.save(update_fields=changed + ["updated_at"])

    default_rules = [
        {
            "source_type": "invoice",
            "payment_method_code": "",
            "journal": journal_map.get("SALES"),
            "debit_account": account_map.get("1200"),
            "credit_account": account_map.get("4100"),
            "name": "Invoice issue posting",
            "description": "Debit receivables and credit sales revenue when invoices are issued.",
            "is_primary": True,
        },
        {
            "source_type": "payment",
            "payment_method_code": "Cash",
            "journal": journal_map.get("CASH"),
            "debit_account": account_map.get("1120"),
            "credit_account": account_map.get("1200"),
            "name": "Cash receipt posting",
            "description": "Debit cash and credit receivables for cash collections.",
            "is_primary": False,
        },
        {
            "source_type": "payment",
            "payment_method_code": "Mpesa",
            "journal": journal_map.get("BANK"),
            "debit_account": account_map.get("1130"),
            "credit_account": account_map.get("1200"),
            "name": "Mpesa receipt posting",
            "description": "Debit bank/mobile money clearing and credit receivables.",
            "is_primary": True,
        },
        {
            "source_type": "payment",
            "payment_method_code": "Card",
            "journal": journal_map.get("BANK"),
            "debit_account": account_map.get("1130"),
            "credit_account": account_map.get("1200"),
            "name": "Card receipt posting",
            "description": "Debit bank and credit receivables for card collections.",
            "is_primary": False,
        },
        {
            "source_type": "payment",
            "payment_method_code": "Bank Transfer",
            "journal": journal_map.get("BANK"),
            "debit_account": account_map.get("1130"),
            "credit_account": account_map.get("1200"),
            "name": "Bank transfer receipt posting",
            "description": "Debit bank and credit receivables for transfer collections.",
            "is_primary": False,
        },
        {
            "source_type": SOURCE_TYPE_BILL,
            "payment_method_code": "",
            "journal": journal_map.get("GEN"),
            "debit_account": account_map.get("5400") or account_map.get("5100"),
            "credit_account": account_map.get("2110"),
            "name": "Bill recognition posting",
            "description": "Debit expense and credit payables when bills are received or approved.",
            "is_primary": True,
        },
    ]

    rules_created = 0
    for spec in default_rules:
        if not spec["journal"] or not spec["debit_account"] or not spec["credit_account"]:
            continue
        rule = AccountingPostingRule.objects.filter(
            tenant=tenant,
            source_type=spec["source_type"],
            payment_method_code=spec["payment_method_code"],
        ).first()
        defaults = {
            "journal": spec["journal"],
            "debit_account": spec["debit_account"],
            "credit_account": spec["credit_account"],
            "name": spec["name"],
            "description": spec["description"],
            "is_active": True,
            "is_primary": spec["is_primary"],
            "metadata": {"seeded": True},
        }
        if rule is None:
            AccountingPostingRule.objects.create(tenant=tenant, **spec, metadata={"seeded": True}, is_active=True)
            rules_created += 1
            continue
        changed = []
        for field, value in defaults.items():
            if getattr(rule, field) != value:
                setattr(rule, field, value)
                changed.append(field)
        if changed:
            rule.save(update_fields=changed + ["updated_at"])

    year_summary = ensure_default_financial_year_setup(tenant)

    return {
        "accounts_created": accounts_created,
        "journals_created": journals_created,
        "rules_created": rules_created,
        "accounts_total": Account.objects.filter(tenant=tenant).count(),
        "journals_total": Journal.objects.filter(tenant=tenant).count(),
        "rules_total": AccountingPostingRule.objects.filter(tenant=tenant).count(),
        "accounting_enabled": True,
        **year_summary,
    }


def _journal_for_source(*, tenant, source_type: str):
    preferred = {
        "invoice": "SALES",
        "payment": "BANK",
        SOURCE_TYPE_BILL: "GEN",
        "manual": "GEN",
    }.get(source_type, "GEN")
    journal = Journal.objects.filter(tenant=tenant, code=preferred, is_active=True).first()
    if journal:
        return journal
    return Journal.objects.filter(tenant=tenant, is_active=True).order_by("code").first()


def _resolve_rule(*, tenant, source_type: str, payment_method_code: str = ""):
    queryset = AccountingPostingRule.objects.filter(
        tenant=tenant,
        source_type=source_type,
        is_active=True,
    ).select_related("journal", "debit_account", "credit_account")
    if payment_method_code:
        exact = queryset.filter(payment_method_code__iexact=payment_method_code).order_by("-is_primary", "id").first()
        if exact:
            return exact
    return queryset.order_by("-is_primary", "id").first()


def _fallback_rule(*, tenant, source_type: str, payment_method_code: str = ""):
    journal = _journal_for_source(tenant=tenant, source_type=source_type)
    if not journal:
        return None

    if source_type == "invoice":
        debit = _account_by_code_or_type(tenant=tenant, code_key="receivable", account_type="asset")
        credit = _account_by_code_or_type(tenant=tenant, code_key="income", account_type="income")
    elif source_type == SOURCE_TYPE_BILL:
        debit = _account_by_code_or_type(tenant=tenant, code_key="expense", account_type="expense")
        credit = _account_by_code_or_type(tenant=tenant, code_key="payable", account_type="liability")
    elif source_type == "payment":
        mode_key = PAYMENT_MODE_TO_ACCOUNT.get((payment_method_code or "").strip().lower(), "bank")
        debit = _account_by_code_or_type(
            tenant=tenant,
            code_key=mode_key if mode_key in {"cash", "bank", "receivable"} else "bank",
            account_type="asset",
        )
        credit = _account_by_code_or_type(tenant=tenant, code_key="receivable", account_type="asset")
    else:
        return None

    if not debit or not credit:
        return None

    return {
        "journal": journal,
        "debit_account": debit,
        "credit_account": credit,
        "payment_method_code": payment_method_code or "",
    }


def _posting_context(*, tenant, source_type: str, payment_method_code: str = ""):
    rule = _resolve_rule(
        tenant=tenant,
        source_type=source_type,
        payment_method_code=payment_method_code,
    )
    if rule:
        return {
            "journal": rule.journal,
            "debit_account": rule.debit_account,
            "credit_account": rule.credit_account,
            "payment_method_code": rule.payment_method_code or payment_method_code,
        }
    return _fallback_rule(
        tenant=tenant,
        source_type=source_type,
        payment_method_code=payment_method_code,
    )


def _upsert_entry(*, tenant, source_type: str, source_reference: str, entry_date, memo: str, amount, debit_account, credit_account, journal):
    amount = Decimal(str(amount or 0))
    if amount <= 0:
        JournalEntry.objects.filter(
            tenant=tenant,
            source_type=source_type,
            source_reference=source_reference,
        ).delete()
        return None

    if entry_date is None:
        entry_date = timezone.now()
    elif hasattr(entry_date, "hour") and timezone.is_naive(entry_date):
        entry_date = timezone.make_aware(entry_date)
    elif not hasattr(entry_date, "hour"):
        entry_date = timezone.make_aware(
            timezone.datetime.combine(entry_date, timezone.datetime.min.time())
        )

    assert_posting_allowed(tenant=tenant, posting_date=entry_date, source_label=source_type)

    with transaction.atomic():
        entry, _ = JournalEntry.objects.get_or_create(
            tenant=tenant,
            source_type=source_type,
            source_reference=source_reference,
            defaults={
                "journal": journal,
                "entry_date": entry_date,
                "memo": memo,
                "status": "posted",
            },
        )
        entry.journal = journal
        entry.entry_date = entry_date
        entry.memo = memo
        entry.status = "posted"
        entry.save(update_fields=["journal", "entry_date", "memo", "status", "updated_at"])
        entry.lines.all().delete()
        JournalEntryLine.objects.create(
            entry=entry,
            account=debit_account,
            description=memo,
            debit_amount=amount,
            credit_amount=Decimal("0.00"),
        )
        JournalEntryLine.objects.create(
            entry=entry,
            account=credit_account,
            description=memo,
            debit_amount=Decimal("0.00"),
            credit_amount=amount,
        )
        return entry


def _delete_entry(*, tenant, source_type: str, source_reference: str):
    JournalEntry.objects.filter(
        tenant=tenant,
        source_type=source_type,
        source_reference=source_reference,
    ).delete()


def sync_invoice_posting(invoice):
    tenant = getattr(invoice, "tenant", None)
    if tenant is None or not is_accounting_enabled_for_tenant(tenant):
        return None
    if invoice.status not in {"issued", "paid", "overdue"}:
        _delete_entry(tenant=tenant, source_type="invoice", source_reference=f"invoice:{invoice.pk}")
        return None
    ctx = _posting_context(tenant=tenant, source_type="invoice")
    if not ctx:
        return None
    return _upsert_entry(
        tenant=tenant,
        source_type="invoice",
        source_reference=f"invoice:{invoice.pk}",
        entry_date=getattr(invoice, "issued_at", None) or getattr(invoice, "issued_date", None),
        memo=f"Invoice {invoice.invoice_number}",
        amount=invoice.total_amount,
        journal=ctx["journal"],
        debit_account=ctx["debit_account"],
        credit_account=ctx["credit_account"],
    )


def sync_bill_posting(bill):
    tenant = getattr(bill, "tenant", None)
    if tenant is None or not is_accounting_enabled_for_tenant(tenant):
        return None
    if bill.status not in {"received", "approved", "paid", "overdue"}:
        _delete_entry(tenant=tenant, source_type=SOURCE_TYPE_BILL, source_reference=f"bill:{bill.pk}")
        return None
    ctx = _posting_context(tenant=tenant, source_type=SOURCE_TYPE_BILL)
    if not ctx:
        return None
    return _upsert_entry(
        tenant=tenant,
        source_type=SOURCE_TYPE_BILL,
        source_reference=f"bill:{bill.pk}",
        entry_date=getattr(bill, "issue_date", None),
        memo=f"Bill {bill.bill_number}",
        amount=bill.total,
        journal=ctx["journal"],
        debit_account=ctx["debit_account"],
        credit_account=ctx["credit_account"],
    )


def sync_payment_posting(*, invoice, payment_mode: str = "", amount=None, reference: str = ""):
    tenant = getattr(invoice, "tenant", None)
    if tenant is None or not is_accounting_enabled_for_tenant(tenant):
        return None
    if getattr(invoice, "status", "") != "paid":
        return None
    ctx = _posting_context(
        tenant=tenant,
        source_type="payment",
        payment_method_code=payment_mode,
    )
    if not ctx:
        return None
    reference_part = (reference or payment_mode or "settlement").strip().lower().replace(" ", "-")
    return _upsert_entry(
        tenant=tenant,
        source_type="payment",
        source_reference=f"payment:{invoice.pk}:{reference_part}",
        entry_date=getattr(invoice, "updated_at", None) or getattr(invoice, "issued_at", None),
        memo=f"Payment for invoice {invoice.invoice_number}",
        amount=amount or invoice.total_amount,
        journal=ctx["journal"],
        debit_account=ctx["debit_account"],
        credit_account=ctx["credit_account"],
    )


def sync_transaction_posting(transaction_obj):
    tenant = getattr(transaction_obj, "tenant", None)
    if tenant is None or not is_accounting_enabled_for_tenant(tenant):
        return None

    source_reference = f"transaction:{transaction_obj.pk}"
    payment_mode = (getattr(transaction_obj, "payment_mode", "") or "").strip()
    payment_status = (getattr(transaction_obj, "payment_status", "") or "").strip()
    tx_status = (getattr(transaction_obj, "status", "") or "").strip()
    charge = Decimal(str(getattr(transaction_obj, "charge", 0) or 0))

    # Only direct settled weighbridge transactions should post here.
    # Debt / invoiced flows post through invoice + payment entries instead.
    if (
        tx_status != "Completed" or
        charge <= 0 or
        payment_status != "Paid" or
        payment_mode.lower() == "debt" or
        getattr(transaction_obj, "invoiced", False) or
        getattr(transaction_obj, "auto_invoice_id", None)
    ):
        _delete_entry(tenant=tenant, source_type="transaction", source_reference=source_reference)
        return None

    ctx = _posting_context(
        tenant=tenant,
        source_type="payment",
        payment_method_code=payment_mode,
    )
    if not ctx:
        return None

    income_account = _account_by_code_or_type(tenant=tenant, code_key="income", account_type="income")
    if not income_account:
        return None

    tx_identifier = f"TX-{transaction_obj.pk:05d}"
    return _upsert_entry(
        tenant=tenant,
        source_type="transaction",
        source_reference=source_reference,
        entry_date=getattr(transaction_obj, "updated_at", None) or getattr(transaction_obj, "created_at", None),
        memo=f"Weighbridge transaction {tx_identifier}",
        amount=charge,
        journal=ctx["journal"],
        debit_account=ctx["debit_account"],
        credit_account=income_account,
    )
