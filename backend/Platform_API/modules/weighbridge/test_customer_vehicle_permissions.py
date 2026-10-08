import base64
import tempfile
from datetime import timedelta
from io import BytesIO

from django.contrib.auth.models import Permission, User
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantSettings, TenantUserProfile
from SL_Weighbridge.models import (
    Branch,
    Company,
    Currency,
    Customer,
    IndicatorConfig,
    Item,
    Transaction,
    Vehicle,
    VehicleType,
    WeighingOperationType,
)


class WeighbridgeMutationPermissionTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Permission Tenant",
            code="permission-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(username="viewer", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=False,
        )
        self.user.user_permissions.add(
            Permission.objects.get(content_type__app_label="SL_Weighbridge", codename="view_customer"),
            Permission.objects.get(content_type__app_label="SL_Weighbridge", codename="view_vehicle"),
        )
        self.customer = Customer.objects.create(
            tenant=self.tenant,
            name="View Only Customer",
            phone_number="+254700000101",
        )
        currency = Currency.objects.create(
            tenant=self.tenant,
            name="Kenya Shilling",
            code="KES",
            symbol="KSh",
        )
        vehicle_type = VehicleType.objects.create(
            tenant=self.tenant,
            name="Six Wheeler",
            charge=500,
            currency=currency,
            max_tare_weight=20000,
        )
        self.vehicle = Vehicle.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            vehicle_type=vehicle_type,
            number_plate="KDA101A",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_weighbridge_view_permissions_do_not_grant_sales_customer_access(self):
        self.assertEqual(self.client.get(reverse("wb-customers")).status_code, 200)
        self.assertEqual(self.client.get(reverse("wb-vehicles")).status_code, 200)
        self.assertEqual(self.client.get(reverse("sales-customers")).status_code, 403)

    def test_customer_mutations_require_change_or_delete_permission(self):
        deactivate = self.client.post(
            reverse("wb-customers-bulk-action"),
            {"ids": [self.customer.id], "action": "deactivate"},
            format="json",
        )
        soft_delete = self.client.delete(
            reverse("wb-customer-detail", kwargs={"pk": self.customer.id})
        )
        sales_edit = self.client.patch(
            reverse("sales-customer-detail", kwargs={"pk": self.customer.id}),
            {"name": "Unauthorized Rename"},
            format="json",
        )

        self.assertEqual(deactivate.status_code, 403)
        self.assertEqual(soft_delete.status_code, 403)
        self.assertEqual(sales_edit.status_code, 403)
        self.customer.refresh_from_db()
        self.assertTrue(self.customer.is_active)
        self.assertFalse(self.customer.is_deleted)
        self.assertEqual(self.customer.name, "View Only Customer")

    def test_vehicle_mutations_require_change_or_delete_permission(self):
        deactivate = self.client.patch(
            reverse("wb-vehicle-detail", kwargs={"pk": self.vehicle.id}),
            {"is_active": False},
            format="json",
        )
        delete = self.client.delete(
            reverse("wb-vehicle-detail", kwargs={"pk": self.vehicle.id})
        )

        self.assertEqual(deactivate.status_code, 403)
        self.assertEqual(delete.status_code, 403)
        self.vehicle.refresh_from_db()
        self.assertTrue(self.vehicle.is_active)


class TransactionVehicleTypeLockTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Transaction Tenant",
            code="transaction-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(username="tenant_admin", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        company = Company.objects.create(
            tenant=self.tenant,
            name="Transaction Company",
            address="Road 1",
            email="company@example.test",
            phone="0700000200",
        )
        self.branch = Branch.objects.create(
            tenant=self.tenant,
            company=company,
            name="Main Branch",
            address="Road 1",
            email="branch@example.test",
            phone="0700000201",
        )
        currency = Currency.objects.create(
            tenant=self.tenant,
            name="Kenya Shilling",
            code="KES",
            symbol="KSh",
        )
        self.configured_type = VehicleType.objects.create(
            tenant=self.tenant,
            name="Configured Type",
            charge=500,
            currency=currency,
            max_tare_weight=30000,
        )
        self.submitted_type = VehicleType.objects.create(
            tenant=self.tenant,
            name="Submitted Type",
            charge=900,
            currency=currency,
            max_tare_weight=30000,
        )
        self.customer = Customer.objects.create(
            tenant=self.tenant,
            name="Transaction Customer",
            phone_number="+254700000202",
        )
        self.vehicle = Vehicle.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            vehicle_type=self.configured_type,
            number_plate="KDB202B",
        )
        self.item = Item.objects.create(
            tenant=self.tenant,
            name="Ballast",
            currency=currency,
        )
        self.operation_type = WeighingOperationType.objects.create(
            tenant=self.tenant,
            code="FIRST_WEIGHT_LOCK_TEST",
            name="First Weight",
            flow_kind="first",
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_transaction_uses_vehicle_master_type_instead_of_submitted_type(self):
        response = self.client.post(
            reverse("wb-transactions"),
            {
                "branch": self.branch.id,
                "customer": self.customer.id,
                "vehicle": self.vehicle.id,
                "vehicle_type": self.submitted_type.id,
                "item": self.item.id,
                "operation_type": self.operation_type.id,
                "operator": "Cashier",
                "weight_type": "First Weight",
                "payment_mode": "Cash",
                "payment_status": "Pending",
                "destination": "Main Yard",
                "gross_weight": 10000,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        transaction = Transaction.objects.get(pk=response.data["id"])
        self.assertEqual(transaction.vehicle_type, self.configured_type)
        self.assertIsNone(response.data["camera_image_url"])

    def test_transaction_accepts_optional_camera_snapshot(self):
        image_buffer = BytesIO()
        Image.new("RGB", (4, 4), color=(20, 80, 120)).save(image_buffer, format="JPEG")
        snapshot = f"data:image/jpeg;base64,{base64.b64encode(image_buffer.getvalue()).decode('ascii')}"

        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            response = self.client.post(
                reverse("wb-transactions"),
                {
                    "branch": self.branch.id,
                    "customer": self.customer.id,
                    "vehicle": self.vehicle.id,
                    "vehicle_type": self.configured_type.id,
                    "item": self.item.id,
                    "operation_type": self.operation_type.id,
                    "operator": "Cashier",
                    "weight_type": "First Weight",
                    "payment_mode": "Cash",
                    "payment_status": "Pending",
                    "destination": "Main Yard",
                    "gross_weight": 10000,
                    "camera_snapshot": snapshot,
                },
                format="json",
            )

            self.assertEqual(response.status_code, 201, response.data)
            transaction = Transaction.objects.get(pk=response.data["id"])
            self.assertTrue(transaction.image.name.startswith("transaction_images/transaction_"))
            self.assertTrue(response.data["camera_image_url"].endswith(".jpg"))


class FirstWeightPairingWorkflowTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="First Weight Workflow Tenant",
            code="first-weight-workflow-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(username="workflow_admin", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.company = Company.objects.create(
            tenant=self.tenant,
            name="Workflow Company",
            address="Road 1",
            email="workflow-company@example.test",
            phone="0700000300",
        )
        self.branch = Branch.objects.create(
            tenant=self.tenant,
            company=self.company,
            name="Workflow Branch",
            address="Road 1",
            email="workflow-branch@example.test",
            phone="0700000301",
        )
        IndicatorConfig.objects.create(
            branch=self.branch,
            indicator_name="Workflow Indicator",
            connection_type="HTTP",
            max_first_weight_age_days=3,
        )
        self.currency = Currency.objects.create(
            tenant=self.tenant,
            name="Kenya Shilling",
            code="KES",
            symbol="KSh",
        )
        self.vehicle_type = VehicleType.objects.create(
            tenant=self.tenant,
            name="Workflow Type",
            charge=500,
            currency=self.currency,
            max_tare_weight=30000,
        )
        self.customer = Customer.objects.create(
            tenant=self.tenant,
            name="Workflow Customer",
            phone_number="+254700000303",
        )
        self.vehicle = Vehicle.objects.create(
            tenant=self.tenant,
            customer=self.customer,
            vehicle_type=self.vehicle_type,
            number_plate="KDC303C",
        )
        self.item = Item.objects.create(tenant=self.tenant, name="Workflow Item", currency=self.currency)
        self.first_operation = WeighingOperationType.objects.create(
            tenant=self.tenant,
            code="FIRST_WEIGHT_WORKFLOW_TEST",
            name="First Weight",
            flow_kind="first",
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_pending_first_weight(self, *, created_at=None):
        transaction = Transaction.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            customer=self.customer,
            vehicle=self.vehicle,
            vehicle_type=self.vehicle_type,
            item=self.item,
            operation_type=self.first_operation,
            operator="Cashier",
            weight_type="First Weight",
            payment_mode="Cash",
            payment_status="Pending",
            destination="Main Yard",
            gross_weight=12000,
            status="Completed",
            paired=False,
        )
        if created_at:
            Transaction.objects.filter(pk=transaction.pk).update(created_at=created_at)
            transaction.refresh_from_db()
        return transaction

    def test_completed_unpaired_first_weight_is_available_for_second_weight(self):
        transaction = self.create_pending_first_weight()

        response = self.client.get(reverse("wb-workflow-context"), {"vehicle_id": self.vehicle.id})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["has_pending_first_weight"])
        self.assertEqual(response.data["first_weight_transaction"]["id"], transaction.id)
        self.assertEqual(response.data["max_first_weight_age_days"], 3)

    def test_first_weight_expires_using_its_branch_configuration(self):
        IndicatorConfig.objects.filter(branch=self.branch).update(max_first_weight_age_days=1)
        self.create_pending_first_weight(created_at=timezone.now() - timedelta(days=2))

        response = self.client.get(reverse("wb-workflow-context"), {"vehicle_id": self.vehicle.id})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["has_pending_first_weight"])

    def test_new_first_weight_is_blocked_while_a_pairable_first_weight_exists(self):
        self.create_pending_first_weight()

        response = self.client.post(
            reverse("wb-transactions"),
            {
                "branch": self.branch.id,
                "customer": self.customer.id,
                "vehicle": self.vehicle.id,
                "vehicle_type": self.vehicle_type.id,
                "item": self.item.id,
                "operation_type": self.first_operation.id,
                "operator": "Cashier",
                "weight_type": "First Weight",
                "payment_mode": "Cash",
                "payment_status": "Pending",
                "destination": "Main Yard",
                "gross_weight": 12000,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("vehicle", response.data)


class TellerReceiptWindowTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Receipt Window Tenant",
            code="receipt-window-tenant",
            is_active=True,
            status="active",
        )
        TenantSettings.objects.create(
            tenant=self.tenant,
            teller_receipt_latest_records=2,
            teller_receipt_max_age_hours=0,
        )
        self.user = User.objects.create_user(username="receipt_teller", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=False)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Receipt Customer", phone_number="0700000400")
        self.currency = Currency.objects.create(tenant=self.tenant, name="Kenya Shilling", code="KES", symbol="KSh")
        self.vehicle_type = VehicleType.objects.create(
            tenant=self.tenant, name="Receipt Vehicle", charge=500, currency=self.currency, max_tare_weight=30000,
        )
        self.vehicle = Vehicle.objects.create(
            tenant=self.tenant, customer=self.customer, vehicle_type=self.vehicle_type, number_plate="KDE404E",
        )
        self.item = Item.objects.create(tenant=self.tenant, name="Receipt Item", currency=self.currency)
        self.branch = Branch.objects.create(
            tenant=self.tenant,
            name="Receipt Branch",
            address="Road 4",
            email="receipt-branch@example.test",
            phone="0700000401",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_transaction(self, offset_hours):
        transaction = Transaction.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            customer=self.customer,
            vehicle=self.vehicle,
            vehicle_type=self.vehicle_type,
            item=self.item,
            operator="Receipt Teller",
            weight_type="First Weight",
            payment_mode="Cash",
            payment_status="Paid",
            destination="Receipt Yard",
            gross_weight=10000,
            status="Completed",
        )
        Transaction.objects.filter(pk=transaction.pk).update(created_at=timezone.now() - timedelta(hours=offset_hours))
        transaction.refresh_from_db()
        return transaction

    def test_teller_can_only_list_the_configured_latest_records(self):
        oldest = self.create_transaction(3)
        middle = self.create_transaction(2)
        newest = self.create_transaction(1)

        response = self.client.get(reverse("wb-transactions"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual([row["id"] for row in response.data["results"]], [newest.id, middle.id])
        self.assertNotIn(oldest.id, [row["id"] for row in response.data["results"]])
        self.assertEqual(self.client.get(reverse("wb-transaction-detail", kwargs={"pk": oldest.id})).status_code, 404)

    def test_teller_requires_reprint_permission_for_allowed_receipt(self):
        transaction = self.create_transaction(1)

        denied = self.client.get(reverse("wb-transaction-receipt", kwargs={"pk": transaction.id}))
        self.assertEqual(denied.status_code, 403)

        self.user.user_permissions.add(
            Permission.objects.get(
                content_type__app_label="SL_Weighbridge",
                codename="can_reprint_recent_weighbridge_receipts",
            )
        )
        allowed = self.client.get(reverse("wb-transaction-receipt", kwargs={"pk": transaction.id}))
        self.assertEqual(allowed.status_code, 200)
