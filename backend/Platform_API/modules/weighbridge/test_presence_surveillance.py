from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone


class VehiclePresenceSurveillanceTests(TestCase):
    def setUp(self):
        from Platform_Core.models import Tenant, TenantUserProfile
        from SL_Weighbridge.models import (
            Branch,
            Company,
            Currency,
            Customer,
            Item,
            OverweightConfig,
            Vehicle,
            VehicleType,
        )

        self.tenant = Tenant.objects.create(name="Surveillance Tenant", code="surveillance-tenant")
        self.user = User.objects.create_user(username="surveillance", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)

        company = Company.objects.create(
            name="Surveillance Co",
            address="Yard 1",
            email="ops@example.com",
            phone="0700000000",
        )
        self.branch = Branch.objects.create(
            company=company,
            name="Main Yard",
            address="Yard 1",
            email="yard@example.com",
            phone="0700000001",
        )
        self.currency = Currency.objects.create(name="Kenya Shilling", code="KES", symbol="KSh")
        self.vehicle_type = VehicleType.objects.create(
            name="Tipper",
            charge=500,
            currency=self.currency,
            max_tare_weight=12000,
        )
        self.customer = Customer.objects.create(
            tenant=self.tenant,
            name="ACME Quarry",
            phone_number="+254700000001",
            email="customer@example.com",
        )
        self.vehicle = Vehicle.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            vehicle_type=self.vehicle_type,
            number_plate="KDD123D",
        )
        self.item = Item.objects.create(name="Ballast", currency=self.currency)
        self.config = OverweightConfig.objects.create(
            branch=self.branch,
            threshold_kg=1000,
            grace_window_minutes=0,
            surveillance_enabled=True,
        )

    def _create_transaction(self, *, gross_weight=1500, status="Draft", payment_status="Pending"):
        from SL_Weighbridge.models import Transaction

        tx = Transaction.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            customer=self.customer,
            vehicle=self.vehicle,
            operator="operator-1",
            item=self.item,
            vehicle_type=self.vehicle_type,
            status=status,
            gross_weight=gross_weight,
            gross_weight_date=timezone.now(),
            payment_mode="Cash",
            payment_status=payment_status,
            destination="Crusher",
            weight_type="First Weight",
        )
        return tx

    def test_vehicle_presence_above_threshold_becomes_discrepancy_when_unrecorded(self):
        from SL_Weighbridge.models import VehiclePresence, WeighbridgeDiscrepancy
        from SL_Weighbridge.surveillance import maybe_record_overweight_event_from_presence
        from SL_Weighbridge.sweep import run_sweep

        presence = VehiclePresence.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            detected_weight=1500,
            capture_status=False,
            plate_number="KDD123D",
        )

        event = maybe_record_overweight_event_from_presence(presence)
        self.assertIsNotNone(event)
        self.assertEqual(event.capture_source, "vehicle_presence")

        result = run_sweep(tenant=self.tenant)
        self.assertEqual(result["created"], 1)

        presence.refresh_from_db()
        event.refresh_from_db()
        discrepancy = WeighbridgeDiscrepancy.objects.get(overweight_event=event)
        self.assertEqual(discrepancy.resolution_status, "unresolved")
        self.assertTrue(event.discrepancy_raised)
        self.assertEqual(presence.overweight_event_id, event.id)
        self.assertTrue(presence.locked)

    def test_vehicle_presence_is_reconciled_when_matching_transaction_exists(self):
        from SL_Weighbridge.models import VehiclePresence, WeighbridgeDiscrepancy
        from SL_Weighbridge.surveillance import maybe_record_overweight_event_from_presence
        from SL_Weighbridge.sweep import run_sweep

        tx = self._create_transaction(status="Draft", payment_status="Pending")
        presence = VehiclePresence.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            detected_weight=1500,
            capture_status=True,
            plate_number="KDD123D",
        )

        event = maybe_record_overweight_event_from_presence(presence)
        result = run_sweep(tenant=self.tenant)

        self.assertEqual(result["created"], 0)
        event.refresh_from_db()
        self.assertEqual(event.linked_transaction_id, tx.id)
        self.assertFalse(event.discrepancy_raised)
        self.assertFalse(WeighbridgeDiscrepancy.objects.filter(overweight_event=event).exists())

    def test_transaction_origin_events_are_not_discrepancies(self):
        from SL_Weighbridge.models import OverweightEvent, WeighbridgeDiscrepancy
        from SL_Weighbridge.sweep import run_sweep

        tx = self._create_transaction(status="Completed", payment_status="Pending")
        event = OverweightEvent.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            vehicle_plate=self.vehicle.number_plate,
            gross_weight=1500,
            net_weight=1500,
            threshold_at_capture=1000,
            linked_transaction=tx,
            capture_source="transaction",
        )

        result = run_sweep(tenant=self.tenant)

        self.assertEqual(result["created"], 0)
        event.refresh_from_db()
        self.assertFalse(event.discrepancy_raised)
        self.assertFalse(WeighbridgeDiscrepancy.objects.filter(overweight_event=event).exists())

    def test_unrecorded_event_is_auto_resolved_when_transaction_is_saved_later(self):
        from SL_Weighbridge.models import VehiclePresence, WeighbridgeDiscrepancy
        from SL_Weighbridge.surveillance import maybe_record_overweight_event_from_presence
        from SL_Weighbridge.sweep import run_sweep

        presence = VehiclePresence.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            detected_weight=1500,
            capture_status=False,
            plate_number="KDD123D",
        )
        event = maybe_record_overweight_event_from_presence(presence)
        run_sweep(tenant=self.tenant)
        discrepancy = WeighbridgeDiscrepancy.objects.get(overweight_event=event)
        self.assertEqual(discrepancy.resolution_status, "unresolved")

        transaction = self._create_transaction(status="Draft", payment_status="Pending")
        result = run_sweep(tenant=self.tenant)

        self.assertEqual(result["reconciled"], 1)
        event.refresh_from_db()
        discrepancy.refresh_from_db()
        self.assertEqual(event.linked_transaction_id, transaction.id)
        self.assertEqual(discrepancy.resolution_status, "resolved")
