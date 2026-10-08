import base64
import tempfile
from io import BytesIO

from django.contrib.auth.models import Permission, User
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Weighbridge.models import (
    Branch,
    Company,
    Currency,
    Customer,
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

    def test_view_permissions_allow_customer_and_vehicle_lists(self):
        self.assertEqual(self.client.get(reverse("wb-customers")).status_code, 200)
        self.assertEqual(self.client.get(reverse("wb-vehicles")).status_code, 200)
        self.assertEqual(self.client.get(reverse("sales-customers")).status_code, 200)

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
