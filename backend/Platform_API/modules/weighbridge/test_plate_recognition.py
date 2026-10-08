import base64
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from Platform_API.modules.weighbridge.views import VehicleSerializer, _plate_search_query
from SL_Weighbridge.models import Currency, Customer, Vehicle, VehicleType
from SL_Weighbridge.plate_recognition import PlateRecognitionResult


def _snapshot_data_url():
    buffer = BytesIO()
    Image.new("RGB", (80, 40), color=(230, 230, 230)).save(buffer, format="JPEG")
    return f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}"


class CameraPlateRecognitionTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Recognition Tenant",
            code="recognition-tenant",
            is_active=True,
            status="active",
        )
        self.other_tenant = Tenant.objects.create(
            name="Other Recognition Tenant",
            code="other-recognition-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user(username="recognition_admin", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        currency = Currency.objects.create(
            tenant=self.tenant,
            name="Kenya Shilling",
            code="KES",
            symbol="KSh",
        )
        other_currency = Currency.objects.create(
            tenant=self.other_tenant,
            name="Other Kenya Shilling",
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
        other_vehicle_type = VehicleType.objects.create(
            tenant=self.other_tenant,
            name="Other Six Wheeler",
            charge=500,
            currency=other_currency,
            max_tare_weight=20000,
        )
        customer = Customer.objects.create(
            tenant=self.tenant,
            name="Recognition Customer",
            phone_number="+254700000401",
        )
        other_customer = Customer.objects.create(
            tenant=self.other_tenant,
            name="Other Recognition Customer",
            phone_number="+254700000402",
        )
        self.vehicle = Vehicle.objects.create(
            tenant=self.tenant,
            customer=customer,
            vehicle_type=vehicle_type,
            number_plate="KDA 401A",
        )
        self.other_vehicle = Vehicle.objects.create(
            tenant=self.other_tenant,
            customer=other_customer,
            vehicle_type=other_vehicle_type,
            number_plate="KDB402B",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @patch("Platform_API.modules.weighbridge.views.recognize_plate_image")
    def test_recognized_plate_returns_current_tenant_vehicle(self, recognize):
        recognize.return_value = PlateRecognitionResult(plate="KDA401A", confidence=91.2)

        response = self.client.post(
            reverse("wb-camera-recognize-plate"),
            {"image": _snapshot_data_url()},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["detected"])
        self.assertTrue(response.data["matched"])
        self.assertEqual(response.data["vehicle"]["id"], self.vehicle.id)
        self.assertEqual(response.data["vehicle"]["customer_name"], "Recognition Customer")

    def test_plate_lookup_ignores_spacing_and_supports_international_formats(self):
        international_vehicle = Vehicle.objects.create(
            tenant=self.tenant,
            customer=self.vehicle.customer,
            vehicle_type=self.vehicle.vehicle_type,
            number_plate="ZX 4646",
        )

        compact_match_ids = set(
            Vehicle.objects.filter(_plate_search_query("KDA401A")).values_list("id", flat=True)
        )
        international_match_ids = set(
            Vehicle.objects.filter(_plate_search_query("ZX-4646")).values_list("id", flat=True)
        )

        self.assertIn(self.vehicle.id, compact_match_ids)
        self.assertIn(international_vehicle.id, international_match_ids)

    def test_vehicle_serializer_rejects_spacing_only_duplicate_plate(self):
        serializer = VehicleSerializer(data={
            "customer": self.vehicle.customer_id,
            "vehicle_type": self.vehicle.vehicle_type_id,
            "number_plate": "KDA401A",
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("number_plate", serializer.errors)

    @patch("Platform_API.modules.weighbridge.views.recognize_plate_image")
    def test_recognized_plate_never_returns_another_tenant_vehicle(self, recognize):
        recognize.return_value = PlateRecognitionResult(plate="KDB402B", confidence=88.0)

        response = self.client.post(
            reverse("wb-camera-recognize-plate"),
            {"image": _snapshot_data_url()},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["detected"])
        self.assertFalse(response.data["matched"])
        self.assertIsNone(response.data["vehicle"])

    @patch("Platform_API.modules.weighbridge.views.recognize_plate_image", return_value=None)
    def test_unreadable_plate_allows_manual_entry(self, _recognize):
        response = self.client.post(
            reverse("wb-camera-recognize-plate"),
            {"image": _snapshot_data_url()},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["detected"])
        self.assertIn("Enter it manually", response.data["message"])
