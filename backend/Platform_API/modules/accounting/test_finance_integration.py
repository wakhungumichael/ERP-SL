import datetime
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Account, AccountingPeriod, FinancialYear, Journal, JournalEntry, JournalEntryLine, Tenant, TenantUserProfile
from SL_CRM.models import Supplier
from SL_Weighbridge.models import Company, Branch, Customer, Invoice


class FinanceIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Acme Freight", code="acme-freight", is_active=True, status="active")
        self.user = User.objects.create_user("finance_admin", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.client.force_authenticate(self.user)

        self.company = Company.objects.create(
            name="Acme Freight Ltd",
            address="Nairobi",
            email="info@acme.test",
            phone="+254700000001",
        )
        self.branch = Branch.objects.create(
            company=self.company,
            name="Main Branch",
            address="Nairobi",
            email="branch@acme.test",
            phone="+254700000002",
        )
        self.customer = Customer.objects.create(
            name="Customer One",
            phone_number="+254700000003",
            email="customer1@acme.test",
        )
        self.supplier = Supplier.objects.create(
            tenant=self.tenant,
            name="Supplier One",
            email="supplier1@acme.test",
        )

        self.accounts = {
            "receivable": Account.objects.create(tenant=self.tenant, code="1200", name="Accounts Receivable", account_type="asset"),
            "cash": Account.objects.create(tenant=self.tenant, code="1120", name="Cash", account_type="asset"),
            "bank": Account.objects.create(tenant=self.tenant, code="1130", name="Bank", account_type="asset"),
            "payable": Account.objects.create(tenant=self.tenant, code="2110", name="Accounts Payable", account_type="liability"),
            "income": Account.objects.create(tenant=self.tenant, code="4100", name="Sales Revenue", account_type="income"),
            "expense": Account.objects.create(tenant=self.tenant, code="5100", name="Operating Expense", account_type="expense"),
        }
        self.journals = {
            "sales": Journal.objects.create(tenant=self.tenant, code="SALES", name="Sales Journal", journal_type="sales"),
            "bank": Journal.objects.create(tenant=self.tenant, code="BANK", name="Bank Journal", journal_type="bank"),
            "gen": Journal.objects.create(tenant=self.tenant, code="GEN", name="General Journal", journal_type="general"),
        }

    def test_issuing_invoice_creates_accounting_entry(self):
        invoice = Invoice.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            total_amount=Decimal("1500.00"),
            currency="KES",
            due_date=datetime.date.today(),
            status="draft",
        )

        response = self.client.post(reverse("invoice-issue", kwargs={"pk": invoice.pk}))
        self.assertEqual(response.status_code, 200, response.data)

        invoice.refresh_from_db()
        entry = self.tenant.journal_entries.get(source_type="invoice", source_reference=f"invoice:{invoice.pk}")
        self.assertEqual(entry.journal.code, "SALES")
        self.assertEqual(entry.lines.count(), 2)
        self.assertEqual(sum(line.debit_amount for line in entry.lines.all()), Decimal("1500.00"))
        self.assertEqual(sum(line.credit_amount for line in entry.lines.all()), Decimal("1500.00"))

    def test_receiving_payment_creates_payment_entry(self):
        invoice = Invoice.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            total_amount=Decimal("1800.00"),
            currency="KES",
            due_date=datetime.date.today(),
            status="issued",
            issued_at=datetime.datetime.now(datetime.timezone.utc),
        )

        response = self.client.post(
            reverse("invoice-receive-payment", kwargs={"pk": invoice.pk}),
            {"amount": "1800.00", "payment_mode": "Mpesa", "reference": "MPESA-123"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        payment_entry = self.tenant.journal_entries.get(
            source_type="payment",
            source_reference=f"payment:{invoice.pk}:mpesa-123",
        )
        self.assertEqual(payment_entry.journal.code, "BANK")
        self.assertEqual(sum(line.debit_amount for line in payment_entry.lines.all()), Decimal("1800.00"))
        self.assertEqual(sum(line.credit_amount for line in payment_entry.lines.all()), Decimal("1800.00"))

    def test_creating_received_bill_creates_bill_entry(self):
        response = self.client.post(
            reverse("bill-list"),
            {
                "branch": self.branch.pk,
                "supplier": self.supplier.pk,
                "status": "received",
                "reference": "SUP-001",
                "issue_date": str(datetime.date.today()),
                "line_items": [
                    {
                        "description": "Stationery",
                        "quantity": "2",
                        "unit_price": "500.00",
                        "tax_rate": "0.00",
                        "sort_order": 1,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

        bill_id = response.data["id"]
        entry = self.tenant.journal_entries.get(source_type="bill", source_reference=f"bill:{bill_id}")
        self.assertEqual(entry.journal.code, "GEN")
        self.assertEqual(sum(line.debit_amount for line in entry.lines.all()), Decimal("1000.00"))
        self.assertEqual(sum(line.credit_amount for line in entry.lines.all()), Decimal("1000.00"))

    def test_finance_overview_aggregates_cross_module_totals(self):
        Invoice.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            total_amount=Decimal("2200.00"),
            currency="KES",
            due_date=datetime.date.today(),
            status="paid",
            issued_at=datetime.datetime.now(datetime.timezone.utc),
        )
        invoice = Invoice.objects.first()

        self.client.post(
            reverse("invoice-receive-payment", kwargs={"pk": invoice.pk}),
            {"amount": "2200.00", "payment_mode": "Card", "reference": "CARD-001"},
            format="json",
        )

        self.client.post(
            reverse("bill-list"),
            {
                "branch": self.branch.pk,
                "supplier": self.supplier.pk,
                "status": "approved",
                "reference": "SUP-OV-1",
                "issue_date": str(datetime.date.today()),
                "line_items": [
                    {
                        "description": "Fuel",
                        "quantity": "1",
                        "unit_price": "900.00",
                        "tax_rate": "0.00",
                        "sort_order": 1,
                    }
                ],
            },
            format="json",
        )

        response = self.client.get(reverse("accounting-overview"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["receivables"]["issued"], 2200.0)
        self.assertEqual(response.data["payables"]["approved"], 900.0)
        self.assertGreaterEqual(response.data["postings"]["payment"], 1)
        self.assertGreaterEqual(response.data["accounts"]["assets"], 2)

    def test_invoice_issue_is_blocked_for_closed_period(self):
        closed_year = FinancialYear.objects.create(
            tenant=self.tenant,
            name="Financial Year 2026",
            code="FY2026",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status="open",
        )
        AccountingPeriod.objects.create(
            tenant=self.tenant,
            financial_year=closed_year,
            name="Jul 2026",
            code="2026-07",
            start_date=datetime.date(2026, 7, 1),
            end_date=datetime.date(2026, 7, 31),
            status="closed",
            sequence_number=7,
        )
        invoice = Invoice.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            total_amount=Decimal("900.00"),
            currency="KES",
            due_date=datetime.date.today(),
            status="draft",
        )

        response = self.client.post(reverse("invoice-issue", kwargs={"pk": invoice.pk}))
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("accounting period is closed", response.data["error"].lower())

    def test_manual_journal_is_blocked_for_closed_period(self):
        closed_year = FinancialYear.objects.create(
            tenant=self.tenant,
            name="Financial Year 2026",
            code="FY2026-B",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status="open",
        )
        AccountingPeriod.objects.create(
            tenant=self.tenant,
            financial_year=closed_year,
            name="Jul 2026",
            code="2026-07-B",
            start_date=datetime.date(2026, 7, 1),
            end_date=datetime.date(2026, 7, 31),
            status="closed",
            sequence_number=7,
        )

        response = self.client.post(
            reverse("journal-entries"),
            {
                "journal": self.journals["gen"].id,
                "entry_date": "2026-07-15T00:00:00Z",
                "source_type": "manual",
                "status": "posted",
                "memo": "Closed period test",
                "lines": [
                    {
                        "account": self.accounts["cash"].id,
                        "description": "Debit cash",
                        "debit_amount": "100.00",
                        "credit_amount": "0.00",
                    },
                    {
                        "account": self.accounts["income"].id,
                        "description": "Credit income",
                        "debit_amount": "0.00",
                        "credit_amount": "100.00",
                    },
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("accounting period is closed", response.data["error"].lower())

    def test_financial_year_create_rejects_overlap(self):
        FinancialYear.objects.create(
            tenant=self.tenant,
            name="Financial Year 2026",
            code="FY2026-C",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status="open",
        )

        response = self.client.post(
            reverse("accounting-financial-years"),
            {
                "name": "Overlap FY",
                "code": "FY2026-D",
                "start_date": "2026-07-01",
                "end_date": "2027-06-30",
                "status": "draft",
                "auto_generate_periods": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("overlap", response.data["error"].lower())

    def test_accounting_period_create_rejects_overlap(self):
        year = FinancialYear.objects.create(
            tenant=self.tenant,
            name="Financial Year 2026",
            code="FY2026-E",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            status="open",
        )
        AccountingPeriod.objects.create(
            tenant=self.tenant,
            financial_year=year,
            name="Jan 2026",
            code="FY2026-E-01",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 1, 31),
            status="open",
            sequence_number=1,
        )

        response = self.client.post(
            reverse("accounting-periods"),
            {
                "financial_year": year.id,
                "name": "Jan overlap",
                "code": "FY2026-E-01B",
                "start_date": "2026-01-15",
                "end_date": "2026-02-15",
                "period_type": "custom",
                "status": "draft",
                "sequence_number": 2,
                "is_adjustment": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("overlap", response.data["error"].lower())

    def test_reconciliation_session_can_match_statement_line_to_posted_bank_line(self):
        entry = JournalEntry.objects.create(
            tenant=self.tenant,
            journal=self.journals["bank"],
            entry_date=datetime.datetime(2026, 7, 20, tzinfo=datetime.timezone.utc),
            source_type="manual",
            source_reference="recon-test-1",
            memo="Bank deposit for reconciliation",
            status="posted",
        )
        bank_line = JournalEntryLine.objects.create(
            entry=entry,
            account=self.accounts["bank"],
            description="Deposit into bank",
            debit_amount=Decimal("500.00"),
            credit_amount=Decimal("0.00"),
        )
        JournalEntryLine.objects.create(
            entry=entry,
            account=self.accounts["income"],
            description="Revenue",
            debit_amount=Decimal("0.00"),
            credit_amount=Decimal("500.00"),
        )

        session_response = self.client.post(
            reverse("accounting-reconciliation-sessions"),
            {
                "account": self.accounts["bank"].id,
                "name": "Bank July 2026",
                "statement_date_from": "2026-07-01",
                "statement_date_to": "2026-07-31",
                "statement_opening_balance": "1000.00",
                "statement_closing_balance": "1500.00",
            },
            format="json",
        )
        self.assertEqual(session_response.status_code, 201, session_response.data)
        session_id = session_response.data["id"]

        line_response = self.client.post(
            reverse("accounting-reconciliation-lines", kwargs={"session_pk": session_id}),
            {
                "line_date": "2026-07-20",
                "reference": "BANK-DEP-001",
                "description": "Deposit",
                "amount": "500.00",
            },
            format="json",
        )
        self.assertEqual(line_response.status_code, 201, line_response.data)
        line_id = line_response.data["id"]

        candidates_response = self.client.post(
            reverse("accounting-reconciliation-line-candidates", kwargs={"pk": line_id}),
            {},
            format="json",
        )
        self.assertEqual(candidates_response.status_code, 200, candidates_response.data)
        candidate_ids = [row["journal_line_id"] for row in candidates_response.data["candidates"]]
        self.assertIn(bank_line.id, candidate_ids)

        match_response = self.client.post(
            reverse("accounting-reconciliation-line-match", kwargs={"pk": line_id}),
            {"journal_line_id": bank_line.id},
            format="json",
        )
        self.assertEqual(match_response.status_code, 200, match_response.data)
        self.assertEqual(match_response.data["status"], "matched")
        self.assertEqual(match_response.data["matched_journal_line"], bank_line.id)

        session_detail = self.client.get(reverse("accounting-reconciliation-session-detail", kwargs={"pk": session_id}))
        self.assertEqual(session_detail.status_code, 200, session_detail.data)
        self.assertEqual(session_detail.data["summary"]["matched_lines"], 1)
