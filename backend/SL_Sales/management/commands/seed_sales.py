"""
Management command: seed_sales
Seeds realistic test data for:
  - SL_Sales:     Products, Estimates (with line items), RecurringInvoices
  - SL_Procurement: Bills (with line items)
  - Platform_Core: Chart of Accounts (Journals + JournalEntries)

Usage:
  python manage.py seed_sales [--tenant-id <id>] [--clear]

  --tenant-id   Target tenant (default: first active tenant found)
  --clear       Delete existing seed data for the tenant before re-seeding
"""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone


def _today():
    return timezone.now().date()


def _past(days):
    return _today() - timedelta(days=days)


def _future(days):
    return _today() + timedelta(days=days)


PRODUCTS_DATA = [
    # (code, name, type, unit, price, tax_rate, description)
    ("WB-001", "Weighbridge Service Fee",    "service", "ticket",  3500.00, 16.0, "Standard commercial weighbridge service per ticket"),
    ("WB-002", "Overweight Surcharge",       "service", "ticket",  5000.00, 16.0, "Applied when vehicle exceeds legal axle limits"),
    ("FUEL-01", "Diesel Fuel",               "product", "litres",   168.50, 16.0, "Industrial grade diesel for fleet operations"),
    ("FUEL-02", "Petrol / Unleaded",         "product", "litres",   175.00, 16.0, "Unleaded petrol for light vehicles"),
    ("PARTS-01","Brake Pads (set)",          "product", "set",      8500.00, 16.0, "OEM-grade brake pads for medium-duty trucks"),
    ("PARTS-02","Engine Oil Filter",         "product", "piece",     450.00, 16.0, "Heavy-duty oil filter for diesel engines"),
    ("PARTS-03","Hydraulic Hose 1m",        "product", "metre",     1200.00, 16.0, "High-pressure hydraulic hose 1/2 inch bore"),
    ("SVC-CAL", "Annual Scale Calibration", "service", "visit",   18000.00, 16.0, "Full KEBS-traceable weighbridge calibration"),
    ("SVC-PM",  "Preventive Maintenance",   "service", "visit",   12500.00, 16.0, "Scheduled 6-month full inspection and service"),
    ("SVC-REP", "Emergency Repair Call-out","service", "visit",   25000.00, 16.0, "On-site emergency repair, min 2 hr labour"),
    ("CERT-001","NTSA Weighbridge Certificate","service","cert",   3000.00,  0.0, "NTSA compliance certificate issuance"),
    ("PPE-001", "Hi-Vis Vest",              "product", "piece",     850.00, 16.0, "Class 2 high-visibility safety vest"),
]

CUSTOMERS = [
    "Kenya Ports Authority",
    "Bamburi Cement Ltd",
    "East African Breweries",
    "Kenya Pipeline Company",
    "Athi River Mining",
    "Devki Steel Mills",
    "Bidco Africa",
    "Naivas Logistics",
]

SUPPLIERS = [
    "Autoparts Kenya Ltd",
    "Total Energies Kenya",
    "Crown Industries",
    "TechnipFMC Kenya",
    "Sameer Industrial Park",
]

ESTIMATE_NOTES = [
    "Quote valid for 30 days from issue date.",
    "Prices exclusive of VAT unless otherwise stated.",
    "Subject to availability of parts.",
    "Delivery charges may apply outside Nairobi.",
    "50% deposit required before commencement of work.",
]

ESTIMATE_TERMS = [
    "Net 30 days from invoice date.",
    "Net 14 days. Late payment attracts 2% per month.",
    "Payment due on delivery.",
    "Advance payment required.",
]

BILL_NOTES = [
    "Received and verified by stores.",
    "Awaiting QC inspection.",
    "Partial delivery — balance due next week.",
    "Invoice matches LPO #2024-0{}.",
    "Urgent — expedite payment approval.",
]


class Command(BaseCommand):
    help = "Seed test data for Sales, Purchases, and Accounting modules"

    def add_arguments(self, parser):
        parser.add_argument("--tenant-id", type=int, default=None)
        parser.add_argument("--clear", action="store_true", default=False)

    def handle(self, *args, **options):
        from Platform_Core.models import (
            Account, Journal, JournalEntry, JournalEntryLine, Tenant,
        )
        from SL_Procurement.models import Bill, BillLineItem
        from SL_Sales.models import (
            Estimate, EstimateLineItem,
            Product, RecurringInvoice, RecurringInvoiceLineItem,
        )

        # ── Resolve tenant ────────────────────────────────────────────────────
        tenant_id = options["tenant_id"]
        if tenant_id:
            try:
                tenant = Tenant.objects.get(pk=tenant_id)
            except Tenant.DoesNotExist:
                self.stderr.write(f"Tenant {tenant_id} not found.")
                return
        else:
            tenant = (
                Tenant.objects.filter(status="active").order_by("id").first()
                or Tenant.objects.order_by("id").first()
            )
        if not tenant:
            self.stderr.write("No tenants found. Run platform setup first.")
            return

        self.stdout.write(f"Seeding into tenant: {tenant.name} (id={tenant.pk})")

        # ── Optional clear ────────────────────────────────────────────────────
        if options["clear"]:
            Product.objects.filter(tenant=tenant).delete()
            Estimate.objects.filter(tenant=tenant).delete()
            RecurringInvoice.objects.filter(tenant=tenant).delete()
            Bill.objects.filter(tenant=tenant).delete()
            JournalEntry.objects.filter(tenant=tenant).delete()
            Account.objects.filter(tenant=tenant).delete()
            Journal.objects.filter(tenant=tenant).delete()
            self.stdout.write("  Cleared existing seed data.")

        # ── Products & Services ───────────────────────────────────────────────
        products = []
        for code, name, ptype, unit, price, tax, desc in PRODUCTS_DATA:
            p, created = Product.objects.get_or_create(
                tenant=tenant,
                code=code,
                defaults=dict(
                    name=name,
                    product_type=ptype,
                    unit=unit,
                    unit_price=Decimal(str(price)),
                    tax_rate=Decimal(str(tax)),
                    description=desc,
                    is_active=True,
                ),
            )
            products.append(p)
        self.stdout.write(f"  ✓ {len(products)} products/services")

        # ── Estimates ─────────────────────────────────────────────────────────
        statuses = ["draft", "draft", "sent", "sent", "accepted", "accepted",
                    "declined", "expired"]
        estimate_samples = []
        _est_seq = Estimate.objects.filter(tenant=tenant).count()
        for i, (cust, status) in enumerate(
            zip(CUSTOMERS * 2, statuses * 2), start=1
        ):
            if Estimate.objects.filter(tenant=tenant, customer_name=cust).count() >= 2:
                continue
            _est_seq += 1
            est_number = f"EST-SEED-{tenant.pk}-{_est_seq:04d}"
            if Estimate.objects.filter(tenant=tenant, estimate_number=est_number).exists():
                continue
            issue = _past(random.randint(5, 60))
            expiry = issue + timedelta(days=30)
            est = Estimate.objects.create(
                tenant=tenant,
                customer_name=cust,
                estimate_number=est_number,
                issue_date=issue,
                expiry_date=expiry,
                status=status,
                notes=random.choice(ESTIMATE_NOTES),
                terms=random.choice(ESTIMATE_TERMS),
            )
            # 2-3 line items per estimate
            chosen = random.sample(products, min(3, len(products)))
            for j, prod in enumerate(chosen):
                qty = Decimal(str(random.randint(1, 10)))
                EstimateLineItem.objects.create(
                    estimate=est,
                    product=prod,
                    description=prod.name,
                    quantity=qty,
                    unit_price=prod.unit_price,
                    tax_rate=prod.tax_rate,
                    sort_order=j,
                )
            est.recalculate()
            estimate_samples.append(est)
        self.stdout.write(f"  ✓ {len(estimate_samples)} estimates")

        # ── Recurring Invoices ────────────────────────────────────────────────
        ri_specs = [
            ("Kenya Ports Authority",  "monthly",   "active",  1),
            ("Bamburi Cement Ltd",     "quarterly", "active",  3),
            ("East African Breweries", "monthly",   "active",  1),
            ("Kenya Pipeline Company", "yearly",    "active", 12),
            ("Athi River Mining",      "monthly",   "paused",  1),
            ("Devki Steel Mills",      "weekly",    "active",  0),
            ("Bidco Africa",           "monthly",   "ended",   1),
        ]
        ri_count = 0
        for cust, freq, status, months_ahead in ri_specs:
            if RecurringInvoice.objects.filter(tenant=tenant, customer_name=cust, frequency=freq).exists():
                continue
            start = _past(random.randint(30, 180))
            nxt = _future(months_ahead * 30)
            ri = RecurringInvoice.objects.create(
                tenant=tenant,
                customer_name=cust,
                frequency=freq,
                status=status,
                start_date=start,
                next_invoice_date=nxt,
                notes=f"Auto-generated recurring {freq} billing for {cust}",
            )
            chosen = random.sample(products, min(2, len(products)))
            for j, prod in enumerate(chosen):
                qty = Decimal(str(random.randint(1, 5)))
                RecurringInvoiceLineItem.objects.create(
                    recurring_invoice=ri,
                    product=prod,
                    description=prod.name,
                    quantity=qty,
                    unit_price=prod.unit_price,
                    tax_rate=prod.tax_rate,
                    sort_order=j,
                )
            # Recalculate totals
            lines = ri.line_items.all()
            ri.subtotal = sum(li.line_total for li in lines)
            ri.tax_total = sum(li.line_total * (li.tax_rate / 100) for li in lines)
            ri.total = ri.subtotal + ri.tax_total
            ri.save(update_fields=["subtotal", "tax_total", "total", "updated_at"])
            ri_count += 1
        self.stdout.write(f"  ✓ {ri_count} recurring invoices")

        # ── Bills ─────────────────────────────────────────────────────────────
        bill_specs = [
            ("Autoparts Kenya Ltd",     "LPO-2024-001", "approved", 30),
            ("Total Energies Kenya",    "LPO-2024-002", "paid",     45),
            ("Crown Industries",        "LPO-2024-003", "draft",     7),
            ("TechnipFMC Kenya",        "LPO-2024-004", "received", 14),
            ("Sameer Industrial Park",  "LPO-2024-005", "approved", 21),
            ("Autoparts Kenya Ltd",     "LPO-2024-006", "overdue",  60),
            ("Total Energies Kenya",    "LPO-2024-007", "paid",     90),
            ("Crown Industries",        "LPO-2024-008", "draft",     2),
        ]
        bill_count = 0
        _bill_seq = Bill.objects.filter(tenant=tenant).count()
        for supplier, ref, status, days_ago in bill_specs:
            if Bill.objects.filter(tenant=tenant, reference=ref).exists():
                continue
            _bill_seq += 1
            bill_number = f"BILL-SEED-{tenant.pk}-{_bill_seq:04d}"
            if Bill.objects.filter(tenant=tenant, bill_number=bill_number).exists():
                continue
            issue = _past(days_ago)
            due = issue + timedelta(days=30)
            bill = Bill.objects.create(
                tenant=tenant,
                supplier_name=supplier,
                bill_number=bill_number,
                reference=ref,
                issue_date=issue,
                due_date=due,
                status=status,
                notes=random.choice(BILL_NOTES).format(bill_count + 1),
            )
            chosen = random.sample(products, min(3, len(products)))
            for j, prod in enumerate(chosen):
                qty = Decimal(str(random.randint(1, 10)))
                price = prod.unit_price * Decimal("0.9")  # supplier price = 90% of sell price
                BillLineItem.objects.create(
                    bill=bill,
                    description=prod.name,
                    quantity=qty,
                    unit_price=price,
                    tax_rate=prod.tax_rate,
                    sort_order=j,
                )
            bill.recalculate()
            bill_count += 1
        self.stdout.write(f"  ✓ {bill_count} bills")

        # ── Chart of Accounts ─────────────────────────────────────────────────
        coa_tree = [
            # (code, name, type, parent_code, allow_posting)
            # Assets
            ("1000", "Assets",                   "asset",     None,   False),
            ("1100", "Current Assets",           "asset",     "1000", False),
            ("1110", "Cash and Cash Equivalents","asset",     "1100", True),
            ("1120", "Petty Cash",               "asset",     "1100", True),
            ("1130", "Bank — KCB Main",          "asset",     "1100", True),
            ("1140", "Bank — Equity",            "asset",     "1100", True),
            ("1200", "Accounts Receivable",      "asset",     "1100", True),
            ("1300", "Inventory",                "asset",     "1100", True),
            ("1400", "Prepaid Expenses",         "asset",     "1100", True),
            ("1500", "Non-Current Assets",       "asset",     "1000", False),
            ("1510", "Property & Equipment",     "asset",     "1500", True),
            ("1520", "Vehicles",                 "asset",     "1500", True),
            ("1530", "Weighbridge Equipment",    "asset",     "1500", True),
            ("1540", "Accum. Depreciation",      "asset",     "1500", True),
            # Liabilities
            ("2000", "Liabilities",              "liability", None,   False),
            ("2100", "Current Liabilities",      "liability", "2000", False),
            ("2110", "Accounts Payable",         "liability", "2100", True),
            ("2120", "VAT Payable",              "liability", "2100", True),
            ("2130", "PAYE Payable",             "liability", "2100", True),
            ("2140", "NSSF Payable",             "liability", "2100", True),
            ("2150", "NHIF Payable",             "liability", "2100", True),
            ("2160", "Accrued Expenses",         "liability", "2100", True),
            ("2200", "Non-Current Liabilities",  "liability", "2000", False),
            ("2210", "Bank Loan — KCB",          "liability", "2200", True),
            # Equity
            ("3000", "Equity",                   "equity",    None,   False),
            ("3100", "Share Capital",            "equity",    "3000", True),
            ("3200", "Retained Earnings",        "equity",    "3000", True),
            ("3300", "Current Year Earnings",    "equity",    "3000", True),
            # Income
            ("4000", "Income",                   "income",    None,   False),
            ("4100", "Weighbridge Revenue",      "income",    "4000", True),
            ("4200", "Service Revenue",          "income",    "4000", True),
            ("4300", "Parts Sales Revenue",      "income",    "4000", True),
            ("4400", "Certificate Revenue",      "income",    "4000", True),
            ("4900", "Other Income",             "income",    "4000", True),
            # Expenses
            ("5000", "Expenses",                 "expense",   None,   False),
            ("5100", "Cost of Goods Sold",       "expense",   "5000", True),
            ("5200", "Salaries & Wages",         "expense",   "5000", True),
            ("5300", "Fuel & Lubricants",        "expense",   "5000", True),
            ("5400", "Repairs & Maintenance",    "expense",   "5000", True),
            ("5500", "Rent & Utilities",         "expense",   "5000", True),
            ("5600", "Depreciation",             "expense",   "5000", True),
            ("5700", "Insurance",                "expense",   "5000", True),
            ("5800", "Bank Charges",             "expense",   "5000", True),
            ("5900", "Other Expenses",           "expense",   "5000", True),
        ]

        code_to_account = {}
        # Create top-level first, then children
        created_accounts = 0
        for code, name, atype, parent_code, allow in coa_tree:
            parent_obj = code_to_account.get(parent_code) if parent_code else None
            acc, created = Account.objects.get_or_create(
                tenant=tenant,
                code=code,
                defaults=dict(
                    name=name,
                    account_type=atype,
                    parent=parent_obj,
                    allow_posting=allow,
                    is_active=True,
                ),
            )
            # Update parent if it was just created in an earlier iteration
            if not created and acc.parent is None and parent_obj is not None:
                acc.parent = parent_obj
                acc.save(update_fields=["parent"])
            code_to_account[code] = acc
            if created:
                created_accounts += 1
        self.stdout.write(f"  ✓ {created_accounts} new accounts (chart of accounts)")

        # ── Journals ──────────────────────────────────────────────────────────
        journals_data = [
            ("SALES", "Sales Journal",      "sales"),
            ("CASH",  "Cash Journal",       "cash"),
            ("BANK",  "Bank Journal",       "bank"),
            ("GEN",   "General Journal",    "general"),
            ("ADJ",   "Adjustment Journal", "adjustment"),
        ]
        journals_map = {}
        j_created = 0
        for code, name, jtype in journals_data:
            j, created = Journal.objects.get_or_create(
                tenant=tenant,
                code=code,
                defaults=dict(name=name, journal_type=jtype, is_active=True),
            )
            journals_map[code] = j
            if created:
                j_created += 1
        self.stdout.write(f"  ✓ {j_created} new journals")

        # ── Journal Entries ───────────────────────────────────────────────────
        _je_seq = [JournalEntry.objects.filter(tenant=tenant).count()]

        def _entry(journal_code, date_offset, memo, source, status, lines):
            """lines: list of (account_code, debit, credit, desc)"""
            j = journals_map[journal_code]
            _je_seq[0] += 1
            entry_number = f"{journal_code}-SEED-{tenant.pk}-{_je_seq[0]:04d}"
            if JournalEntry.objects.filter(tenant=tenant, entry_number=entry_number).exists():
                return None
            entry = JournalEntry.objects.create(
                tenant=tenant,
                journal=j,
                entry_number=entry_number,
                entry_date=timezone.make_aware(
                    timezone.datetime.combine(_past(date_offset), timezone.datetime.min.time())
                ),
                memo=memo,
                source_type=source,
                status=status,
            )
            for acc_code, debit, credit, desc in lines:
                acc = code_to_account.get(acc_code)
                if acc:
                    JournalEntryLine.objects.create(
                        entry=entry,
                        account=acc,
                        description=desc,
                        debit_amount=Decimal(str(debit)),
                        credit_amount=Decimal(str(credit)),
                    )
            return entry

        entries_created = 0
        journal_entry_seeds = [
            # (journal, days_ago, memo, source, status, lines)
            ("SALES", 30, "Weighbridge fees — Kenya Ports Authority", "invoice", "posted", [
                ("1200",  40600.00, 0,        "Accounts receivable — KPA"),
                ("4100",  0,        35000.00, "Weighbridge revenue"),
                ("2120",  0,         5600.00, "VAT @ 16%"),
            ]),
            ("SALES", 25, "Service fee — Bamburi Cement", "invoice", "posted", [
                ("1200",  23200.00, 0,        "Accounts receivable — Bamburi"),
                ("4100",  0,        20000.00, "Weighbridge revenue"),
                ("2120",  0,         3200.00, "VAT @ 16%"),
            ]),
            ("BANK", 28, "Payment received — Kenya Ports Authority", "payment", "posted", [
                ("1130",  40600.00, 0,        "KCB Main receipt"),
                ("1200",  0,        40600.00, "Clear AR — KPA"),
            ]),
            ("SALES", 20, "Calibration service — Kenya Pipeline", "invoice", "posted", [
                ("1200",  20880.00, 0,        "Accounts receivable"),
                ("4200",  0,        18000.00, "Service revenue"),
                ("2120",  0,         2880.00, "VAT @ 16%"),
            ]),
            ("SALES", 18, "Parts sale — Athi River Mining", "invoice", "posted", [
                ("1200",  9860.00, 0,         "Accounts receivable"),
                ("4300",  0,        8500.00,  "Parts sales"),
                ("2120",  0,        1360.00,  "VAT @ 16%"),
            ]),
            ("CASH", 15, "Petty cash replenishment", "manual", "posted", [
                ("1120",  10000.00, 0,         "Petty cash top-up"),
                ("1130",  0,        10000.00,  "KCB Main withdrawal"),
            ]),
            ("GEN", 10, "Monthly depreciation — June 2026", "manual", "posted", [
                ("5600",  25000.00, 0,         "Depreciation expense"),
                ("1540",  0,        25000.00,  "Accumulated depreciation"),
            ]),
            ("BANK", 8, "Supplier payment — Autoparts Kenya", "payment", "posted", [
                ("2110",  15000.00, 0,         "Clear accounts payable"),
                ("1130",  0,        15000.00,  "KCB Main payment"),
            ]),
            ("SALES", 5, "Weighbridge fees — Devki Steel — draft", "invoice", "draft", [
                ("1200",  58000.00, 0,         "Accounts receivable — Devki"),
                ("4100",  0,        50000.00,  "Weighbridge revenue"),
                ("2120",  0,         8000.00,  "VAT @ 16%"),
            ]),
            ("GEN", 3, "Accrued salaries — July 2026", "manual", "posted", [
                ("5200",  450000.00, 0,          "Salaries expense"),
                ("2160",  0,         450000.00,  "Accrued payroll"),
            ]),
            ("BANK", 1, "Bank charges — KCB July 2026", "manual", "posted", [
                ("5800",  1250.00, 0,         "Bank service charge"),
                ("1130",  0,        1250.00,  "KCB Main debit"),
            ]),
        ]
        for jcode, days, memo, source, status, lines in journal_entry_seeds:
            # Avoid duplicates by checking memo + tenant
            if not JournalEntry.objects.filter(tenant=tenant, memo=memo).exists():
                _entry(jcode, days, memo, source, status, lines)
                entries_created += 1
        self.stdout.write(f"  ✓ {entries_created} journal entries")

        self.stdout.write(self.style.SUCCESS(
            f"\nSeed complete for '{tenant.name}'. "
            f"Products={len(products)}, "
            f"Estimates={len(estimate_samples)}, "
            f"RecurringInvoices={ri_count}, "
            f"Bills={bill_count}, "
            f"Accounts={created_accounts}, "
            f"Journals={j_created}, "
            f"JournalEntries={entries_created}"
        ))
