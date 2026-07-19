"""
Unit tests for ReceivePaymentView resilience.

Verifies that:
1. POST /api/payments/invoices/<pk>/receive-payment/ returns 200 on a happy path.
2. A DatabaseError on the incidental transaction-status-update write does NOT
   surface as an HTTP 500 — the payment is still recorded and the response is 200.
3. Pattern mirrors test_issue_invoice.py and test_debt_consolidate.py so that
   any future email-log write added to this view already has a test harness.
"""

from django.contrib.auth.models import User
from django.db import DatabaseError
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch


def _create_base_objects():
    """
    Create the minimum set of related objects needed to build an Invoice.
    Returns a dict of named model instances.
    """
    from SL_Weighbridge.models import Company, Branch, Currency, VehicleType

    company = Company.objects.create(
        name="RP Test Co", address="3 Road", email="co3@test.com", phone="0700000033"
    )
    branch = Branch.objects.create(
        company=company,
        name="Branch3",
        address="3 Road",
        email="branch3@test.com",
        phone="0700000034",
    )
    currency = Currency.objects.create(name="Kenya Shilling3", code="KES", symbol="KSh")
    vehicle_type = VehicleType.objects.create(
        name="Van",
        charge=600,
        currency=currency,
        max_tare_weight=5000,
    )
    return dict(branch=branch, vehicle_type=vehicle_type, currency=currency)


def _make_customer(name, email=None):
    from SL_Weighbridge.models import Customer
    return Customer.objects.create(
        name=name,
        phone_number=f"+2547{abs(hash(name)) % 100000000:08d}",
        email=email or None,
    )


def _make_issued_invoice(customer, total=1200.00):
    """Create an issued Invoice ready for payment."""
    from django.utils import timezone
    from datetime import timedelta
    from SL_Weighbridge.models import Invoice
    return Invoice.objects.create(
        customer=customer,
        total_amount=total,
        currency="KES",
        status="issued",
        issued_at=timezone.now(),
        due_date=(timezone.now() + timedelta(days=30)).date(),
        notes="Test issued invoice",
        source_module="manual",
    )


# ── Test cases ────────────────────────────────────────────────────────────────

class ReceivePaymentViewResilienceTests(TestCase):
    """
    Resilience tests for POST /api/payments/invoices/<pk>/receive-payment/.

    Confirms that incidental DB write failures (e.g. transaction-status update)
    are absorbed and never surface as HTTP errors.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="testpaystaff", password="pass", is_staff=True
        )
        self.client.force_authenticate(user=self.user)
        _create_base_objects()

    # ── helper ────────────────────────────────────────────────────────────────

    def _post_receive(self, invoice_pk, amount=1200.00, payment_mode="Cash"):
        url = reverse("invoice-receive-payment", kwargs={"pk": invoice_pk})
        return self.client.post(
            url,
            {"amount": amount, "payment_mode": payment_mode, "reference": "REF-001"},
            format="json",
        )

    # ── test 1: happy path ────────────────────────────────────────────────────

    def test_receive_payment_returns_200_on_success(self):
        """
        POST to /api/payments/invoices/<pk>/receive-payment/ for a valid issued
        invoice should return 200 and report success.
        """
        customer = _make_customer("Alice Rop")
        inv = _make_issued_invoice(customer)

        response = self._post_receive(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data.get("success"), response.data)

    def test_receive_payment_marks_invoice_paid(self):
        """The invoice status must be 'paid' after a successful payment call."""
        from SL_Weighbridge.models import Invoice

        customer = _make_customer("Bob Rotich")
        inv = _make_issued_invoice(customer)

        self._post_receive(inv.pk)

        inv.refresh_from_db()
        self.assertEqual(inv.status, "paid", "Invoice status should be 'paid' after payment.")

    def test_receive_payment_response_contains_invoice_id(self):
        """The response body should echo back the invoice id."""
        customer = _make_customer("Carol Cheruiyot")
        inv = _make_issued_invoice(customer)

        response = self._post_receive(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(int(response.data.get("invoice_id", 0)), inv.pk)

    # ── test 2: transaction-status update raises DatabaseError ────────────────

    def test_api_returns_200_when_transaction_update_raises_database_error(self):
        """
        If the incidental transaction-status bulk-update raises a DatabaseError
        (e.g. a DB constraint or connection error), the view must still return
        200 — the invoice is already marked paid and the error must be absorbed
        by the try/except guard in the view.
        """
        customer = _make_customer("David Kiptoo")
        inv = _make_issued_invoice(customer)

        with patch(
            "django.db.models.query.QuerySet.update",
            side_effect=DatabaseError("DB constraint error on transaction update"),
        ):
            response = self._post_receive(inv.pk)

        self.assertEqual(
            response.status_code, 200,
            "API must return 200 even when the transaction status update raises a DatabaseError.",
        )

    def test_invoice_marked_paid_even_when_transaction_update_raises(self):
        """
        Even when the transaction-status update raises, the invoice itself must
        be saved as 'paid' because that write happens before the failing update.
        """
        from SL_Weighbridge.models import Invoice

        customer = _make_customer("Eve Komen")
        inv = _make_issued_invoice(customer)

        with patch(
            "django.db.models.query.QuerySet.update",
            side_effect=DatabaseError("DB constraint error on transaction update"),
        ):
            self._post_receive(inv.pk)

        inv.refresh_from_db()
        self.assertEqual(
            inv.status, "paid",
            "Invoice status must be 'paid' even when the transaction-status update fails.",
        )

    def test_response_reports_success_when_transaction_update_raises(self):
        """
        The response body must still report success=True when the secondary
        transaction-status update fails, since the core payment write succeeded.
        """
        customer = _make_customer("Frank Bett")
        inv = _make_issued_invoice(customer)

        with patch(
            "django.db.models.query.QuerySet.update",
            side_effect=DatabaseError("DB constraint error on transaction update"),
        ):
            response = self._post_receive(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            response.data.get("success"),
            "Response should still report success=True when the transaction update fails.",
        )

    # ── test 3: email-log write failure is survivable ─────────────────────────

    def test_api_returns_200_when_email_log_write_raises_database_error(self):
        """
        If InvoiceEmailLog.objects.create raises a DatabaseError (e.g. a DB
        constraint violation or connection drop), the view must still return 200.
        The invoice is already marked paid before the log write; the
        DatabaseError guard in the view must absorb the failure silently.
        """
        customer = _make_customer("Grace Koech")
        inv = _make_issued_invoice(customer)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=DatabaseError("DB constraint on email log"),
        ):
            response = self._post_receive(inv.pk)

        self.assertEqual(
            response.status_code, 200,
            "API must return 200 even when the email log write raises a DatabaseError.",
        )

    def test_invoice_marked_paid_when_email_log_write_raises(self):
        """
        Even when InvoiceEmailLog.objects.create raises, the invoice must
        still be saved as 'paid' — the core payment write happens before the log.
        """
        from SL_Weighbridge.models import Invoice

        customer = _make_customer("Henry Rono")
        inv = _make_issued_invoice(customer)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=DatabaseError("DB constraint on email log"),
        ):
            self._post_receive(inv.pk)

        inv.refresh_from_db()
        self.assertEqual(
            inv.status, "paid",
            "Invoice must be 'paid' even when the email log write fails.",
        )

    def test_warning_logged_when_email_log_write_fails(self):
        """
        When InvoiceEmailLog.objects.create raises a DatabaseError, the view
        must emit a WARNING-level log message containing
        'Could not write InvoiceEmailLog' so operators can diagnose a missing
        audit trail without the failure ever becoming an HTTP error.
        """
        customer = _make_customer("Irene Lagat")
        inv = _make_issued_invoice(customer)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=DatabaseError("DB constraint on email log"),
        ), self.assertLogs("Platform_API.modules.payments.views", level="WARNING") as log_ctx:
            response = self._post_receive(inv.pk)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            any("Could not write InvoiceEmailLog" in msg for msg in log_ctx.output),
            f"Expected a 'Could not write InvoiceEmailLog' warning in logs, got: {log_ctx.output}",
        )

    def test_response_success_true_when_email_log_write_raises(self):
        """
        The response body must still report success=True when the email log
        write fails, since the core payment write succeeded.
        """
        customer = _make_customer("James Kipyego")
        inv = _make_issued_invoice(customer)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=DatabaseError("DB constraint on email log"),
        ):
            response = self._post_receive(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            response.data.get("success"),
            "Response should still report success=True when the email log write fails.",
        )

    # ── test 4: invoice-not-found returns 404, not 500 ────────────────────────

    def test_missing_invoice_returns_404(self):
        """
        Requesting receive-payment for a non-existent invoice pk must return
        404, not 500 — confirming the view handles DoesNotExist cleanly.
        """
        response = self._post_receive(invoice_pk=999999)

        self.assertEqual(
            response.status_code, 404,
            "Missing invoice should yield 404, not a server error.",
        )
