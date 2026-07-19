"""
Unit tests for DebtConsolidateView email behaviour.

Verifies that:
1. A customer *with* an email address receives a payment-link email containing
   the invoice number, total amount, and a payment URL.
2. A customer *without* an email address receives no email.

Tests use Django's locmem email backend so no real SMTP connection is made,
and `django.test.utils.override_settings` to swap in that backend at runtime.
"""

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient


def _create_base_objects():
    """
    Create the minimum set of related objects required to build a Transaction.
    Returns a dict of named model instances.
    """
    from SL_Weighbridge.models import (
        Company, Branch, Currency, VehicleType, Customer, Vehicle, Item,
    )

    company = Company.objects.create(
        name="Test Co", address="1 Road", email="co@test.com", phone="0700000000"
    )
    branch = Branch.objects.create(
        company=company,
        name="Main",
        address="1 Road",
        email="branch@test.com",
        phone="0700000001",
    )
    currency = Currency.objects.create(name="Kenya Shilling", code="KES", symbol="KSh")
    vehicle_type = VehicleType.objects.create(
        name="Lorry",
        charge=500,
        currency=currency,
        max_tare_weight=10000,
    )
    return dict(branch=branch, vehicle_type=vehicle_type, currency=currency)


def _make_customer(name, email):
    from SL_Weighbridge.models import Customer
    return Customer.objects.create(
        name=name,
        phone_number=f"+2547{abs(hash(name)) % 100000000:08d}",
        email=email or None,
    )


def _make_vehicle(customer, vehicle_type):
    from SL_Weighbridge.models import Vehicle
    plate = f"KAA{abs(hash(customer.name)) % 1000:03d}A"
    return Vehicle.objects.create(
        customer=customer,
        vehicle_type=vehicle_type,
        number_plate=plate,
    )


def _make_debt_transaction(customer, branch, vehicle, vehicle_type):
    """Create a Completed Debt transaction with a non-zero charge."""
    from SL_Weighbridge.models import Item, Transaction
    item, _ = Item.objects.get_or_create(name="Sand")
    return Transaction.objects.create(
        branch=branch,
        customer=customer,
        vehicle=vehicle,
        operator="op1",
        item=item,
        vehicle_type=vehicle_type,
        status="Completed",
        payment_mode="Debt",
        payment_status="Pending",
        charge=1500.00,
        destination="Nairobi",
        weight_type="First Weight",
    )


# ── Test cases ────────────────────────────────────────────────────────────────

@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="noreply@test.example",
    PLATFORM_NAME="Test ERP",
)
class DebtConsolidateEmailTests(TestCase):
    """Email behaviour of POST /api/payments/debt/consolidate/."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="teststaff", password="pass", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

        base = _create_base_objects()
        self.branch = base["branch"]
        self.vehicle_type = base["vehicle_type"]

    # ── helper ────────────────────────────────────────────────────────────────

    def _post_consolidate(self, customer_id, currency="KES"):
        url = reverse("debt-consolidate")
        return self.client.post(
            url, {"customer_id": customer_id, "currency": currency}, format="json"
        )

    # ── test 1: email is sent when customer has an email ─────────────────────

    def test_email_sent_when_customer_has_email(self):
        """
        POST to /api/payments/debt/consolidate/ for a customer with a valid
        email address should trigger exactly one outbound email.
        """
        customer = _make_customer("Alice Wanjiku", "alice@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(mail.outbox), 1, "Expected exactly one email to be sent.")

    def test_email_recipient_is_customer_email(self):
        """The email must be addressed to the customer's email address."""
        customer = _make_customer("Bob Otieno", "bob@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        self._post_consolidate(customer.id)

        sent = mail.outbox[0]
        self.assertIn("bob@example.com", sent.to)

    def test_email_subject_contains_invoice_number(self):
        """The subject line must reference the invoice number."""
        customer = _make_customer("Carol Njeri", "carol@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        invoice_number = response.data.get("invoice_number", "")

        sent = mail.outbox[0]
        self.assertIn(invoice_number, sent.subject,
                      f"Subject '{sent.subject}' should contain invoice number '{invoice_number}'.")

    def test_email_body_contains_invoice_number(self):
        """The plain-text body must mention the invoice number."""
        customer = _make_customer("Daniel Kamau", "daniel@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        invoice_number = response.data.get("invoice_number", "")

        sent = mail.outbox[0]
        self.assertIn(invoice_number, sent.body,
                      "Plain-text body should contain the invoice number.")

    def test_email_body_contains_total_amount(self):
        """The plain-text body must state the total amount due."""
        customer = _make_customer("Eva Chebet", "eva@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        total = response.data.get("total_amount", 0)

        sent = mail.outbox[0]
        # The view formats with {:,.2f}, so 1500.00 → "1,500.00"
        formatted_total = f"{float(total):,.2f}"
        self.assertIn(formatted_total, sent.body,
                      f"Plain-text body should contain total amount '{formatted_total}'.")

    def test_email_body_contains_payment_url(self):
        """The plain-text body must include the payment URL."""
        customer = _make_customer("Frank Maina", "frank@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        payment_url = response.data.get("payment_url", "")

        sent = mail.outbox[0]
        self.assertTrue(
            payment_url and payment_url in sent.body,
            f"Plain-text body should contain payment URL '{payment_url}'.",
        )

    def test_html_body_attached(self):
        """The email must carry an HTML alternative body."""
        customer = _make_customer("Grace Achieng", "grace@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        self._post_consolidate(customer.id)

        sent = mail.outbox[0]
        html_bodies = [body for body, mime in getattr(sent, "alternatives", [])
                       if mime == "text/html"]
        self.assertTrue(html_bodies, "Email should have an HTML alternative body.")

    def test_html_body_contains_invoice_number(self):
        """HTML alternative body must reference the invoice number."""
        customer = _make_customer("Henry Ngugi", "henry@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        invoice_number = response.data.get("invoice_number", "")

        sent = mail.outbox[0]
        html_body = next(
            (body for body, mime in getattr(sent, "alternatives", []) if mime == "text/html"),
            "",
        )
        self.assertIn(invoice_number, html_body,
                      "HTML body should contain the invoice number.")

    def test_html_body_contains_payment_url(self):
        """HTML alternative body must contain the payment URL."""
        customer = _make_customer("Irene Waweru", "irene@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        payment_url = response.data.get("payment_url", "")

        sent = mail.outbox[0]
        html_body = next(
            (body for body, mime in getattr(sent, "alternatives", []) if mime == "text/html"),
            "",
        )
        self.assertTrue(
            payment_url and payment_url in html_body,
            f"HTML body should contain payment URL '{payment_url}'.",
        )

    # ── test 2: no email when customer has no email address ───────────────────

    def test_no_email_sent_when_customer_email_is_null(self):
        """
        When the customer's email field is NULL, no email should be dispatched.
        The API must still succeed (201).
        """
        customer = _make_customer("James Mwangi", None)
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(mail.outbox), 0,
                         "No email should be sent when the customer has no email address.")

    def test_no_email_sent_when_customer_email_is_blank(self):
        """
        When the customer's email is saved as an empty string (falsy), no email
        should be dispatched. The API must still succeed (201).
        """
        from SL_Weighbridge.models import Customer
        # Create with no email then clear it to simulate a blank string in DB
        customer = Customer.objects.create(
            name="John Odhiambo",
            phone_number="+254712345678",
            email=None,
        )
        # Force an empty string at the DB level (bypassing EmailField validation)
        Customer.objects.filter(pk=customer.pk).update(email="")
        customer.refresh_from_db()

        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(mail.outbox), 0,
                         "No email should be sent when the customer email is blank.")

    # ── test 3: email log written correctly ───────────────────────────────────

    def test_email_log_success_recorded(self):
        """A successful email send must create an InvoiceEmailLog with success=True."""
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("Karen Njoki", "karen@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        invoice_id = response.data.get("id")

        log = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).first()
        self.assertIsNotNone(log, "An InvoiceEmailLog record should be created.")
        self.assertTrue(log.success, "Log should record success=True for a sent email.")
        self.assertEqual(log.recipient, "karen@example.com")

    def test_no_email_log_when_no_customer_email(self):
        """No InvoiceEmailLog should be written when the customer has no email."""
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("Leo Mutua", None)
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        response = self._post_consolidate(customer.id)
        invoice_id = response.data.get("id")

        log_count = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).count()
        self.assertEqual(log_count, 0,
                         "No InvoiceEmailLog should be written when customer has no email.")

    # ── test 4: email failure is recorded ────────────────────────────────────

    def test_email_failure_recorded_as_failure_log(self):
        """
        When send_mail raises an SMTPException the view must still create the
        invoice (201) AND write an InvoiceEmailLog row with success=False and a
        non-empty failure_reason.
        """
        from smtplib import SMTPException
        from unittest.mock import patch
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("Mary Auma", "mary@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        with patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=SMTPException("Connection refused"),
        ):
            response = self._post_consolidate(customer.id)

        # Invoice creation must succeed despite the email failure
        self.assertEqual(response.status_code, 201, response.data)

        invoice_id = response.data.get("id")
        log = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).first()

        self.assertIsNotNone(log, "InvoiceEmailLog should be written even when email fails.")
        self.assertFalse(log.success, "Log entry should record success=False for a failed send.")
        self.assertTrue(
            log.failure_reason,
            "Log entry should record a non-empty failure_reason when email fails.",
        )
        self.assertEqual(log.recipient, "mary@example.com")

    def test_api_returns_201_when_email_raises(self):
        """
        A broken SMTP backend must not surface as an API error — the response
        must always be 201 so the invoice workflow is not interrupted.
        """
        from smtplib import SMTPException
        from unittest.mock import patch

        customer = _make_customer("Noah Kipchoge", "noah@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        with patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=SMTPException("Relay access denied"),
        ):
            response = self._post_consolidate(customer.id)

        self.assertEqual(
            response.status_code, 201,
            "API must return 201 even when the SMTP send raises an exception.",
        )

    # ── test 5: email log write failure is survivable ─────────────────────────

    def test_api_returns_201_when_email_log_write_fails(self):
        """
        If InvoiceEmailLog.objects.create raises (e.g. a DB constraint error),
        the API must still return 201.  The log-write failure must never
        propagate as an HTTP error — the invoice is already created and the
        bare-except guard in the view must absorb it silently.
        """
        from unittest.mock import patch

        customer = _make_customer("Patricia Wanjala", "patricia@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=Exception("DB constraint violation"),
        ):
            response = self._post_consolidate(customer.id)

        self.assertEqual(
            response.status_code, 201,
            "API must return 201 even when the email log write raises an exception.",
        )

    def test_warning_logged_when_email_log_write_fails(self):
        """
        When InvoiceEmailLog.objects.create raises, the view must emit a
        WARNING-level log message containing 'Could not write InvoiceEmailLog'
        so that operators can diagnose a missing audit trail without the failure
        ever becoming an HTTP error.
        """
        from unittest.mock import patch

        customer = _make_customer("Queen Adhiambo", "queen@example.com")
        vehicle = _make_vehicle(customer, self.vehicle_type)
        _make_debt_transaction(customer, self.branch, vehicle, self.vehicle_type)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=Exception("DB constraint violation"),
        ), self.assertLogs("Platform_API.modules.payments.views", level="WARNING") as log_ctx:
            response = self._post_consolidate(customer.id)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            any("Could not write InvoiceEmailLog" in msg for msg in log_ctx.output),
            f"Expected a 'Could not write InvoiceEmailLog' warning in logs, got: {log_ctx.output}",
        )
