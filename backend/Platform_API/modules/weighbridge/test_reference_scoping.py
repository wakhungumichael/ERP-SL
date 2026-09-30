from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantBranch, TenantUserProfile
from SL_Weighbridge.models import Branch, Company, Currency, IndicatorConfig, Item, VehicleType, WeighingOperationType


def _make_tenant(name, code):
    return Tenant.objects.create(name=name, code=code, is_active=True, status="active")


def _make_tenant_user(username, tenant):
    user = User.objects.create_user(username=username, password="pass", is_staff=True)
    TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=True)
    return user


def _make_branch(tenant, suffix):
    tenant_branch = TenantBranch.objects.create(
        tenant=tenant,
        name=f"Branch {suffix}",
        address="Road 1",
        email=f"{suffix}@branch.test",
        phone="0700000001",
        is_active=True,
    )
    company = Company.objects.create(
        tenant=tenant,
        name=f"Company {suffix}",
        address="Road 1",
        email=f"{suffix}@company.test",
        phone="0700000000",
    )
    return Branch.objects.create(
        tenant=tenant,
        company=company,
        name=tenant_branch.name,
        address=tenant_branch.address,
        email=tenant_branch.email,
        phone=tenant_branch.phone,
    )


class WeighbridgeReferenceScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Tenant A WB", "tenant-a-wb")
        self.tenant_b = _make_tenant("Tenant B WB", "tenant-b-wb")
        self.user_a = _make_tenant_user("tenant_a_wb_admin", self.tenant_a)
        self.client.force_authenticate(self.user_a)

        self.branch_a = _make_branch(self.tenant_a, "a")
        self.branch_b = _make_branch(self.tenant_b, "b")

        self.currency_a = Currency.objects.create(
            tenant=self.tenant_a,
            name="Kenya Shilling A",
            code="KES",
            symbol="KSh",
        )
        self.currency_b = Currency.objects.create(
            tenant=self.tenant_b,
            name="Kenya Shilling B",
            code="KES",
            symbol="KSh",
        )

        self.vehicle_type_a = VehicleType.objects.create(
            tenant=self.tenant_a,
            name="Tipper A",
            charge=500,
            currency=self.currency_a,
            max_tare_weight=12000,
        )
        self.vehicle_type_b = VehicleType.objects.create(
            tenant=self.tenant_b,
            name="Tipper B",
            charge=650,
            currency=self.currency_b,
            max_tare_weight=15000,
        )

        self.item_a = Item.objects.create(
            tenant=self.tenant_a,
            name="Ballast A",
            currency=self.currency_a,
        )
        self.item_b = Item.objects.create(
            tenant=self.tenant_b,
            name="Ballast B",
            currency=self.currency_b,
        )

        self.indicator_a = IndicatorConfig.objects.create(
            branch=self.branch_a,
            indicator_name="Indicator A",
            connection_type="HTTP",
            live_weight_url="https://tenant-a.example/live",
        )
        self.indicator_b = IndicatorConfig.objects.create(
            branch=self.branch_b,
            indicator_name="Indicator B",
            connection_type="HTTP",
            live_weight_url="https://tenant-b.example/live",
        )

    def test_branch_list_syncs_new_organization_branch_for_indicator_dropdown(self):
        tenant_branch = TenantBranch.objects.create(
            tenant=self.tenant_a,
            name="New Indicator Branch",
            address="Road 2",
            email="indicator-branch@example.test",
            phone="0700000002",
            is_active=True,
        )

        response = self.client.get(
            reverse("wb-branches"),
            {"tenant_id": self.tenant_a.id, "page_size": 200},
        )

        self.assertEqual(response.status_code, 200, response.data)
        results = response.data.get("results", response.data)
        names = {row["name"] for row in results}
        self.assertIn(tenant_branch.name, names)
        self.assertTrue(
            Branch.objects.filter(tenant=self.tenant_a, name=tenant_branch.name).exists()
        )

    def test_branch_list_rejects_another_tenant_id(self):
        response = self.client.get(
            reverse("wb-branches"),
            {"tenant_id": self.tenant_b.id, "page_size": 200},
        )

        self.assertEqual(response.status_code, 200, response.data)
        results = response.data.get("results", response.data)
        self.assertEqual(results, [])

    def test_vehicle_type_list_returns_only_current_tenant_records(self):
        response = self.client.get(reverse("wb-vehicle-types"))

        self.assertEqual(response.status_code, 200, response.data)
        results = response.data.get("results", response.data)
        ids = {row["id"] for row in results}
        self.assertEqual(ids, {self.vehicle_type_a.id})

    def test_vehicle_type_create_allows_current_tenant_admin(self):
        response = self.client.post(
            reverse("wb-vehicle-types"),
            {
                "name": "Flatbed A",
                "description": "Organization scoped vehicle type",
                "charge": 700,
                "max_tare_weight": 18000,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        created = VehicleType.objects.get(id=response.data["id"])
        self.assertEqual(created.tenant, self.tenant_a)

    def test_item_detail_blocks_other_tenant_record(self):
        response = self.client.get(reverse("wb-item-detail", kwargs={"pk": self.item_b.pk}))

        self.assertEqual(response.status_code, 404, response.data)

    def test_indicator_config_list_returns_only_current_tenant_branch_configs(self):
        response = self.client.get(reverse("wb-indicator-configs"))

        self.assertEqual(response.status_code, 200, response.data)
        results = response.data.get("results", response.data)
        ids = {row["id"] for row in results}
        self.assertEqual(ids, {self.indicator_a.id})

    def test_indicator_config_create_rejects_other_tenant_branch(self):
        response = self.client.post(
            reverse("wb-indicator-configs"),
            {
                "branch": self.branch_b.id,
                "indicator_name": "Cross Tenant Config",
                "connection_type": "HTTP",
                "live_weight_url": "https://cross-tenant.example/live",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("do not have permission", str(response.data))

    def test_default_operation_type_only_allows_activation_style_updates(self):
        op_type = WeighingOperationType.objects.create(
            tenant=self.tenant_a,
            code="FIRST_WEIGHT",
            name="First Weight",
            flow_kind="first",
            is_active=True,
            is_default=True,
        )

        response = self.client.patch(
            reverse("wb-weighing-operation-type-detail", kwargs={"pk": op_type.pk}),
            {"name": "Renamed First Weight"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("shared workflow definitions", str(response.data))

        toggle_response = self.client.patch(
            reverse("wb-weighing-operation-type-detail", kwargs={"pk": op_type.pk}),
            {"is_active": False},
            format="json",
        )

        self.assertEqual(toggle_response.status_code, 200, toggle_response.data)
        op_type.refresh_from_db()
        self.assertFalse(op_type.is_active)
