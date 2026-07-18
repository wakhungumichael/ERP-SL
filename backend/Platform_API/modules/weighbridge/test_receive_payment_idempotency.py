"""
Tests for TransactionReceivePaymentView idempotency guard.

Verifies that a second POST to receive-payment on an already-Paid
transaction returns HTTP 400 instead of silently succeeding.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient


def _create_base_objects():
    from SL_Weighbridge.models import Company, Branch, Currency, VehicleType

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


def _make_completed_transaction(branch, vehicle_type):
    from SL_Weighbridge.models import Customer, Vehicle, Item, Transaction

    customer = Customer.objects.create(
        name="Test Customer",
        phone_number="+254700000001",
        email="customer@test.com",
    )
    vehicle = Vehicle.objects.create(
        customer=customer,
        vehicle_type=vehicle_type,
        number_plate="KBB123A",
    )
    item, _ = Item.objects.get_or_create(name="Gravel")
    return Transaction.objects.create(
        branch=branch,
        customer=customer,
        vehicle=vehicle,
        operator="op1",
        item=item,
        vehicle_type=vehicle_type,
        status="Completed",
        payment_mode="Cash",
        payment_status="Pending",
        charge=1000.00,
        destination="Mombasa",
        weight_type="First Weight",
    )


class ReceivePaymentIdempotencyTests(TestCase):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/receive-payment/
    must reject a second submission with HTTP 400 when already Paid.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="testop", password="pass", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

        base = _create_base_objects()
        self.tx = _make_completed_transaction(base["branch"], base["vehicle_type"])

    def _post_receive_payment(self, method="Cash", reference="REF001"):
        url = reverse("wb-transaction-receive-payment", kwargs={"pk": self.tx.pk})
        return self.client.post(
            url, {"method": method, "reference": reference}, format="json"
        )

    def test_first_payment_succeeds(self):
        """First POST marks the transaction Paid and returns 200."""
        response = self._post_receive_payment()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["payment_status"], "Paid")

    def test_second_payment_returns_400(self):
        """Second POST on an already-Paid transaction returns 400."""
        first = self._post_receive_payment()
        self.assertEqual(first.status_code, 200, first.data)

        second = self._post_receive_payment()
        self.assertEqual(second.status_code, 400, second.data)
        self.assertIn("already been recorded", second.data["error"])

    def test_second_payment_does_not_alter_transaction(self):
        """The transaction record is unchanged after a rejected duplicate POST."""
        from SL_Weighbridge.models import Transaction

        self._post_receive_payment(method="Cash", reference="REF001")
        self._post_receive_payment(method="M-Pesa", reference="REF999")

        self.tx.refresh_from_db()
        self.assertEqual(self.tx.payment_status, "Paid")
        self.assertEqual(self.tx.payment_mode, "Cash")  # first write wins

    def test_pending_transaction_is_rejected_before_idempotency_check(self):
        """A non-Completed transaction still returns 400 with the status error."""
        self.tx.status = "Pending"
        self.tx.save(update_fields=["status"])

        response = self._post_receive_payment()
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only Completed", response.data["error"])
