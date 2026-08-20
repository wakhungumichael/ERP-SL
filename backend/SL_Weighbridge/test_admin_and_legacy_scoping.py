from django.contrib import admin
from django.contrib.auth.models import User
from django.test import RequestFactory, TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from Platform_Core.models import Tenant, TenantUserProfile
from SL_Weighbridge.admin import CompanyAdmin, IndicatorConfigAdmin
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
)
from SL_Weighbridge.views import TransactionListAPI, get_indicator_data_api


def _make_tenant(name, code):
    return Tenant.objects.create(name=name, code=code, is_active=True, status="active")


def _make_tenant_user(username, tenant):
    user = User.objects.create_user(username=username, password="pass", is_staff=True)
    TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=True)
    return user


def _make_operational_objects(tenant, suffix):
    company = Company.objects.create(
        tenant=tenant,
        name=f"Company {suffix}",
        address="Road 1",
        email=f"{suffix}@company.test",
        phone="0700000000",
    )
    branch = Branch.objects.create(
        tenant=tenant,
        company=company,
        name=f"Branch {suffix}",
        address="Road 1",
        email=f"{suffix}@branch.test",
        phone="0700000001",
    )
    currency = Currency.objects.create(
        tenant=tenant,
        name=f"Currency {suffix}",
        code="KES",
        symbol="KSh",
    )
    vehicle_type = VehicleType.objects.create(
        tenant=tenant,
        name=f"Tipper {suffix}",
        charge=500,
        currency=currency,
        max_tare_weight=12000,
    )
    customer = Customer.objects.create(
        tenant=tenant,
        name=f"Customer {suffix}",
        phone_number=f"+2547{suffix}000000",
    )
    item = Item.objects.create(
        tenant=tenant,
        name=f"Item {suffix}",
        currency=currency,
    )
    vehicle = Vehicle.objects.create(
        tenant=tenant,
        customer=customer,
        vehicle_type=vehicle_type,
        number_plate=f"KD{suffix.upper()}123",
    )
    return {
        "company": company,
        "branch": branch,
        "currency": currency,
        "vehicle_type": vehicle_type,
        "customer": customer,
        "item": item,
        "vehicle": vehicle,
    }


class LegacyWeighbridgeTenantScopingTests(TestCase):
    def setUp(self):
        self.request_factory = RequestFactory()
        self.api_factory = APIRequestFactory()

        self.tenant_a = _make_tenant("Legacy Tenant A", "legacy-tenant-a")
        self.tenant_b = _make_tenant("Legacy Tenant B", "legacy-tenant-b")
        self.user_a = _make_tenant_user("legacy_admin_a", self.tenant_a)

        self.base_a = _make_operational_objects(self.tenant_a, "a1")
        self.base_b = _make_operational_objects(self.tenant_b, "b1")

        self.indicator_a = IndicatorConfig.objects.create(
            branch=self.base_a["branch"],
            indicator_name="Indicator A",
            connection_type="HTTP",
            live_weight_url="https://tenant-a.example/live",
        )
        self.indicator_b = IndicatorConfig.objects.create(
            branch=self.base_b["branch"],
            indicator_name="Indicator B",
            connection_type="HTTP",
            live_weight_url="https://tenant-b.example/live",
        )

        self.tx_a = Transaction.objects.create(
            tenant=self.tenant_a,
            branch=self.base_a["branch"],
            customer=self.base_a["customer"],
            vehicle=self.base_a["vehicle"],
            vehicle_type=self.base_a["vehicle_type"],
            item=self.base_a["item"],
            operator="operator-a",
            gross_weight=10000,
            tare_weight=2000,
            net_weight=8000,
            status="Completed",
            payment_mode="Cash",
            payment_status="Pending",
            destination="Crusher",
            weight_type="First Weight",
        )
        Transaction.objects.create(
            tenant=self.tenant_b,
            branch=self.base_b["branch"],
            customer=self.base_b["customer"],
            vehicle=self.base_b["vehicle"],
            vehicle_type=self.base_b["vehicle_type"],
            item=self.base_b["item"],
            operator="operator-b",
            gross_weight=9000,
            tare_weight=1000,
            net_weight=8000,
            status="Completed",
            payment_mode="Cash",
            payment_status="Pending",
            destination="Crusher",
            weight_type="First Weight",
        )

    def test_company_admin_queryset_is_tenant_scoped(self):
        request = self.request_factory.get("/admin/SL_Weighbridge/company/")
        request.user = self.user_a

        qs = CompanyAdmin(Company, admin.site).get_queryset(request)

        self.assertEqual(list(qs.values_list("id", flat=True)), [self.base_a["company"].id])

    def test_indicator_config_admin_queryset_is_tenant_scoped(self):
        request = self.request_factory.get("/admin/SL_Weighbridge/indicatorconfig/")
        request.user = self.user_a

        qs = IndicatorConfigAdmin(IndicatorConfig, admin.site).get_queryset(request)

        self.assertEqual(list(qs.values_list("id", flat=True)), [self.indicator_a.id])

    def test_legacy_transaction_list_api_returns_only_current_tenant_rows(self):
        request = self.api_factory.get("/legacy/api/transactions/")
        force_authenticate(request, user=self.user_a)

        response = TransactionListAPI.as_view()(request)

        self.assertEqual(response.status_code, 200, response.data)
        ids = {row["id"] for row in response.data["results"]}
        self.assertEqual(ids, {self.tx_a.id})

    def test_legacy_indicator_data_api_returns_only_current_tenant_configs(self):
        request = self.api_factory.get("/legacy/api/get-indicator-data/")
        force_authenticate(request, user=self.user_a)

        response = get_indicator_data_api(request)

        self.assertEqual(response.status_code, 200, response.data)
        ids = {row["id"] for row in response.data}
        self.assertEqual(ids, {self.indicator_a.id})
