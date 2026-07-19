"""
Unit tests for IssueInvoiceView email behaviour.

Verifies that:
1. A customer *with* an email address receives a payment notification email
   containing the invoice number and total amount when a draft invoice is issued.
2. A customer *without* an email address receives no email.
3. Subject, recipient, and body content are correct.
4. An SMTP failure is recorded as a failure log but does not break the API response.

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
    Create the minimum set of related objects needed to support a Customer.
    Returns a dict of named model instances.
    """
    from SL_Weighbridge.models import Company, Branch, Currency, VehicleType

    company = Company.objects.create(
        name="Issue Test Co", address="2 Road", email="co2@test.com", phone="0700000002"
    )
    branch = Branch.objects.create(
        company=company,
        name="Branch2",
        address="2 Road",
        email="branch2@test.com",
        phone="0700000003",
    )
    currency = Currency.objects.create(name="Kenya Shilling2", code="KES", symbol="KSh")
    vehicle_type = VehicleType.objects.create(
        name="Truck",
        charge=800,
        currency=currency,
        max_tare_weight=12000,
    )
    return dict(branch=branch, vehicle_type=vehicle_type, currency=currency)


def _make_customer(name, email):
    from SL_Weighbridge.models import Customer
    return Customer.objects.create(
        name=name,
        phone_number=f"+2547{abs(hash(name)) % 100000000:08d}",
        email=email or None,
    )


def _make_draft_invoice(customer, total=2500.00):
    """Create a draft Invoice for the given customer."""
    from SL_Weighbridge.models import Invoice
    return Invoice.objects.create(
        customer=customer,
        total_amount=total,
        currency="KES",
        status="draft",
        notes="Test draft invoice",
        source_module="manual",
    )


# ── Test cases ────────────────────────────────────────────────────────────────

@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="noreply@test.example",
    PLATFORM_NAME="Test ERP",
)
class IssueInvoiceEmailTests(TestCase):
    """Email behaviour of POST /api/payments/invoices/<pk>/issue/."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="teststaff2", password="pass", is_staff=True
        )
        self.client.force_authenticate(user=self.user)
        _create_base_objects()

    # ── helper ────────────────────────────────────────────────────────────────

    def _post_issue(self, invoice_pk):
        url = reverse("invoice-issue", kwargs={"pk": invoice_pk})
        return self.client.post(url, {}, format="json")

    # ── test 1: email is sent when customer has an email ─────────────────────

    def test_email_sent_when_customer_has_email(self):
        """
        POST to /api/payments/invoices/<pk>/issue/ for a customer with a valid
        email address should trigger exactly one outbound email.
        """
        customer = _make_customer("Alice Kariuki", "alice.kariuki@example.com")
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(mail.outbox), 1, "Expected exactly one email to be sent.")

    def test_email_recipient_is_customer_email(self):
        """The email must be addressed to the customer's email address."""
        customer = _make_customer("Bob Kamau", "bob.kamau@example.com")
        inv = _make_draft_invoice(customer)

        self._post_issue(inv.pk)

        sent = mail.outbox[0]
        self.assertIn("bob.kamau@example.com", sent.to)

    def test_email_subject_contains_invoice_number(self):
        """The subject line must reference the invoice number."""
        customer = _make_customer("Carol Akinyi", "carol.akinyi@example.com")
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)
        invoice_number = response.data.get("invoice_number", "")

        sent = mail.outbox[0]
        self.assertIn(invoice_number, sent.subject,
                      f"Subject '{sent.subject}' should contain invoice number '{invoice_number}'.")

    def test_email_body_contains_invoice_number(self):
        """The plain-text body must mention the invoice number."""
        customer = _make_customer("David Omondi", "david.omondi@example.com")
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)
        invoice_number = response.data.get("invoice_number", "")

        sent = mail.outbox[0]
        self.assertIn(invoice_number, sent.body,
                      "Plain-text body should contain the invoice number.")

    def test_email_body_contains_total_amount(self):
        """The plain-text body must state the total amount due."""
        customer = _make_customer("Eva Wanjiru", "eva.wanjiru@example.com")
        inv = _make_draft_invoice(customer, total=2500.00)

        response = self._post_issue(inv.pk)
        total = response.data.get("total_amount", 0)

        sent = mail.outbox[0]
        # The view formats with {:,.2f}, so 2500.00 → "2,500.00"
        formatted_total = f"{float(total):,.2f}"
        self.assertIn(formatted_total, sent.body,
                      f"Plain-text body should contain total amount '{formatted_total}'.")

    def test_html_body_attached(self):
        """The email must carry an HTML alternative body."""
        customer = _make_customer("Frank Njoroge", "frank.njoroge@example.com")
        inv = _make_draft_invoice(customer)

        self._post_issue(inv.pk)

        sent = mail.outbox[0]
        html_bodies = [body for body, mime in getattr(sent, "alternatives", [])
                       if mime == "text/html"]
        self.assertTrue(html_bodies, "Email should have an HTML alternative body.")

    def test_html_body_contains_invoice_number(self):
        """HTML alternative body must reference the invoice number."""
        customer = _make_customer("Grace Mutua", "grace.mutua@example.com")
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)
        invoice_number = response.data.get("invoice_number", "")

        sent = mail.outbox[0]
        html_body = next(
            (body for body, mime in getattr(sent, "alternatives", []) if mime == "text/html"),
            "",
        )
        self.assertIn(invoice_number, html_body,
                      "HTML body should contain the invoice number.")

    # ── test 2: no email when customer has no email address ───────────────────

    def test_no_email_sent_when_customer_email_is_null(self):
        """
        When the customer's email field is NULL, no email should be dispatched.
        The API must still succeed (200).
        """
        customer = _make_customer("Henry Mwenda", None)
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(mail.outbox), 0,
                         "No email should be sent when the customer has no email address.")

    def test_no_email_sent_when_customer_email_is_blank(self):
        """
        When the customer's email is saved as an empty string (falsy), no email
        should be dispatched. The API must still succeed (200).
        """
        from SL_Weighbridge.models import Customer
        customer = Customer.objects.create(
            name="Irene Otieno",
            phone_number="+254798765432",
            email=None,
        )
        # Force an empty string at the DB level (bypassing EmailField validation)
        Customer.objects.filter(pk=customer.pk).update(email="")
        customer.refresh_from_db()

        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(mail.outbox), 0,
                         "No email should be sent when the customer email is blank.")

    # ── test 3: email log written correctly ───────────────────────────────────

    def test_email_log_success_recorded(self):
        """A successful email send must create an InvoiceEmailLog with success=True."""
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("James Kipkorir", "james.kipkorir@example.com")
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)
        invoice_id = response.data.get("id")

        log = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).first()
        self.assertIsNotNone(log, "An InvoiceEmailLog record should be created.")
        self.assertTrue(log.success, "Log should record success=True for a sent email.")
        self.assertEqual(log.recipient, "james.kipkorir@example.com")

    def test_no_email_log_when_no_customer_email(self):
        """No InvoiceEmailLog should be written when the customer has no email."""
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("Karen Chebet", None)
        inv = _make_draft_invoice(customer)

        response = self._post_issue(inv.pk)
        invoice_id = response.data.get("id")

        log_count = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).count()
        self.assertEqual(log_count, 0,
                         "No InvoiceEmailLog should be written when customer has no email.")

    # ── test 4: SMTP failure is recorded and does not break the API ───────────

    def test_email_failure_recorded_as_failure_log(self):
        """
        When send raises an SMTPException the view must still return 200 AND
        write an InvoiceEmailLog row with success=False and a non-empty failure_reason.
        """
        from smtplib import SMTPException
        from unittest.mock import patch
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("Leo Waweru", "leo.waweru@example.com")
        inv = _make_draft_invoice(customer)

        with patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=SMTPException("Connection refused"),
        ):
            response = self._post_issue(inv.pk)

        # Invoice issuance must succeed despite the email failure
        self.assertEqual(response.status_code, 200, response.data)

        invoice_id = response.data.get("id")
        log = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).first()

        self.assertIsNotNone(log, "InvoiceEmailLog should be written even when email fails.")
        self.assertFalse(log.success, "Log entry should record success=False for a failed send.")
        self.assertTrue(
            log.failure_reason,
            "Log entry should record a non-empty failure_reason when email fails.",
        )
        self.assertEqual(log.recipient, "leo.waweru@example.com")

    def test_api_returns_200_when_email_raises(self):
        """
        A broken SMTP backend must not surface as an API error — the response
        must always be 200 so the invoice workflow is not interrupted.
        """
        from smtplib import SMTPException
        from unittest.mock import patch

        customer = _make_customer("Mary Njeri", "mary.njeri@example.com")
        inv = _make_draft_invoice(customer)

        with patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=SMTPException("Relay access denied"),
        ):
            response = self._post_issue(inv.pk)

        self.assertEqual(
            response.status_code, 200,
            "API must return 200 even when the SMTP send raises an exception.",
        )

    # ── test 5: template rendering failure is recorded and does not break the API ──

    def test_template_render_error_recorded_as_failure_log(self):
        """
        When render_to_string raises TemplateDoesNotExist the view must still
        return 200 AND write an InvoiceEmailLog row with success=False and a
        non-empty failure_reason.
        """
        from django.template.exceptions import TemplateDoesNotExist
        from unittest.mock import patch
        from SL_Weighbridge.models import InvoiceEmailLog

        customer = _make_customer("Nina Wambui", "nina.wambui@example.com")
        inv = _make_draft_invoice(customer)

        with patch(
            "django.template.loader.render_to_string",
            side_effect=TemplateDoesNotExist("emails/invoice_issued.html"),
        ):
            response = self._post_issue(inv.pk)

        # Invoice issuance must succeed despite the template error
        self.assertEqual(response.status_code, 200, response.data)

        invoice_id = response.data.get("id")
        log = InvoiceEmailLog.objects.filter(invoice_id=invoice_id).first()

        self.assertIsNotNone(log, "InvoiceEmailLog should be written even when template rendering fails.")
        self.assertFalse(log.success, "Log entry should record success=False when the template is missing.")
        self.assertTrue(
            log.failure_reason,
            "Log entry should record a non-empty failure_reason when template rendering raises.",
        )
        self.assertEqual(log.recipient, "nina.wambui@example.com")

    def test_api_returns_200_when_template_render_raises(self):
        """
        A missing or broken email template must not surface as an API error —
        the response must always be 200 so the invoice workflow is not interrupted.
        """
        from django.template.exceptions import TemplateDoesNotExist
        from unittest.mock import patch

        customer = _make_customer("Oscar Maina", "oscar.maina@example.com")
        inv = _make_draft_invoice(customer)

        with patch(
            "django.template.loader.render_to_string",
            side_effect=TemplateDoesNotExist("emails/invoice_issued.html"),
        ):
            response = self._post_issue(inv.pk)

        self.assertEqual(
            response.status_code, 200,
            "API must return 200 even when render_to_string raises TemplateDoesNotExist.",
        )

    # ── test 6: email log write failure is survivable ─────────────────────────

    def test_api_returns_200_when_email_log_write_fails(self):
        """
        If InvoiceEmailLog.objects.create raises a DatabaseError (e.g. a DB
        constraint violation), the API must still return 200.  The log-write
        failure must never propagate as an HTTP error — the invoice is already
        issued and the DatabaseError guard in the view must absorb it silently.
        """
        from unittest.mock import patch
        from django.db import DatabaseError

        customer = _make_customer("Patricia Ochieng", "patricia.ochieng@example.com")
        inv = _make_draft_invoice(customer)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=DatabaseError("DB constraint violation"),
        ):
            response = self._post_issue(inv.pk)

        self.assertEqual(
            response.status_code, 200,
            "API must return 200 even when the email log write raises a DatabaseError.",
        )

    def test_warning_logged_when_email_log_write_fails(self):
        """
        When InvoiceEmailLog.objects.create raises a DatabaseError, the view
        must emit a WARNING-level log message containing
        'Could not write InvoiceEmailLog' so that operators can diagnose a
        missing audit trail without the failure ever becoming an HTTP error.
        """
        from unittest.mock import patch
        from django.db import DatabaseError

        customer = _make_customer("Queen Wangui", "queen.wangui@example.com")
        inv = _make_draft_invoice(customer)

        with patch(
            "SL_Weighbridge.models.InvoiceEmailLog.objects.create",
            side_effect=DatabaseError("DB constraint violation"),
        ), self.assertLogs("Platform_API.modules.payments.views", level="WARNING") as log_ctx:
            response = self._post_issue(inv.pk)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            any("Could not write InvoiceEmailLog" in msg for msg in log_ctx.output),
            f"Expected a 'Could not write InvoiceEmailLog' warning in logs, got: {log_ctx.output}",
        )
