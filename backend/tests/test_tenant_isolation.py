"""
Integration tests for tenant data isolation.

Verifies that a user authenticated as Tenant A cannot read Tenant B's data
across three resource domains:

1. Platform views protected by TenantScopedQuerysetMixin
   (TenantSubscription, LicenseKey, IntegrationEndpoint)
2. Weighbridge transactions  (/api/commercial-weighbridge/transactions/)
3. Invoices                  (/api/payments/invoices/)
4. Procurement orders        (/api/procurement/orders/)

Each test confirms one of:
  a) Default list scoping: Tenant A user gets zero Tenant B records even without
     any cross-tenant query params.
  b) Param manipulation blocked: ?tenant_code=<b> yields empty list for Tenant A.
  c) IDOR blocked: Tenant A user fetching Tenant B's object by PK gets 404.
"""

import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient


# ── Shared fixture helpers ─────────────────────────────────────────────────────

def _make_tenant(name, code=None):
    from Platform_Core.models import Tenant
    t = Tenant(name=name)
    if code:
        t.code = code
    t.save()
    return t


def _make_tenant_user(username, tenant, *, password="pass", is_staff=False):
    """Create a Django user bound to *tenant* via TenantUserProfile."""
    from Platform_Core.models import TenantUserProfile
    user = User.objects.create_user(username=username, password=password, is_staff=is_staff)
    TenantUserProfile.objects.create(user=user, tenant=tenant, is_tenant_admin=False)
    return user


def _make_subscription_plan():
    from Platform_Core.models import SubscriptionPlan
    import uuid
    code = f"basic-{uuid.uuid4().hex[:6]}"
    return SubscriptionPlan.objects.create(
        code=code,
        name="Basic",
        billing_period="monthly",
        price=0,
    )


def _make_tenant_subscription(tenant, plan):
    from Platform_Core.models import TenantSubscription
    return TenantSubscription.objects.create(
        tenant=tenant,
        plan=plan,
        status="active",
        start_date=datetime.date.today(),
        amount=0,
    )


def _make_license(tenant):
    from Platform_Core.models import LicenseKey
    import uuid
    return LicenseKey.objects.create(
        tenant=tenant,
        license_key=f"LK-{uuid.uuid4().hex[:12].upper()}",
        status="active",
    )


def _make_integration(tenant):
    from Platform_Core.models import IntegrationEndpoint
    return IntegrationEndpoint.objects.create(
        tenant=tenant,
        name="Test Integration",
        integration_type="payment",
        transport="http",
    )


# ── Weighbridge / Invoice helpers ──────────────────────────────────────────────

def _make_wb_base_objects():
    """Minimal SL_Weighbridge objects needed to create a Transaction."""
    from SL_Weighbridge.models import Company, Branch, Currency, VehicleType, Customer, Item, Vehicle
    import uuid
    sfx = uuid.uuid4().hex[:6]
    company  = Company.objects.create(name=f"Co-{sfx}", address="1 St", email=f"co{sfx}@t.com", phone="0700000000")
    branch   = Branch.objects.create(company=company, name=f"Br-{sfx}", address="1 St", email=f"br{sfx}@t.com", phone="0700000001")
    currency = Currency.objects.create(name=f"KES-{sfx}", code="KES", symbol="KSh")
    vt       = VehicleType.objects.create(name=f"VT-{sfx}", charge=500, currency=currency, max_tare_weight=5000)
    customer = Customer.objects.create(name=f"Cust-{sfx}", phone_number=f"+2547{abs(hash(sfx)) % 100000000:08d}")
    item     = Item.objects.create(name=f"Item-{sfx}", currency=currency)
    vehicle  = Vehicle.objects.create(customer=customer, vehicle_type=vt, number_plate=f"KAA{sfx[:4].upper()}")
    return dict(branch=branch, vt=vt, customer=customer, item=item, vehicle=vehicle)


def _make_transaction(branch, customer, vehicle, vt, item, tenant=None):
    from SL_Weighbridge.models import Transaction
    return Transaction.objects.create(
        branch=branch,
        customer=customer,
        vehicle=vehicle,
        vehicle_type=vt,
        item=item,
        operator="test_op",
        gross_weight=10000,
        tare_weight=2000,
        net_weight=8000,
        status="Completed",
        payment_status="Pending",
        tenant=tenant,
    )


def _make_invoice(customer, tenant=None):
    from SL_Weighbridge.models import Invoice
    return Invoice.objects.create(
        customer=customer,
        total_amount=1500,
        currency="KES",
        status="issued",
        tenant=tenant,
    )


def _make_purchase_order(created_by):
    from SL_Procurement.models import PurchaseOrder
    return PurchaseOrder.objects.create(
        reference=f"PO-TEST-{created_by.pk}",
        supplier_name="Supplier Ltd",
        status="Draft",
        order_date=datetime.date.today(),
        total_amount=5000,
        currency="KES",
        created_by=created_by,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 1. TenantScopedQuerysetMixin — platform-level views
# ═══════════════════════════════════════════════════════════════════════════════

class TenantScopedMixinIsolationTests(TestCase):
    """
    Verify that TenantScopedQuerysetMixin enforces per-user tenant scoping.

    Platform views (subscription-list, license-list, integration-list) require
    superadmin/platform-admin rights, so regular tenant users receive 403 — which
    is itself sufficient isolation.  Superusers tested with ?tenant_code= confirm
    the mixin scopes correctly per tenant.
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Corp", code="alpha-corp")
        self.tenant_b = _make_tenant("Beta Corp", code="beta-corp")
        self.user_a   = _make_tenant_user("user_a", self.tenant_a)
        self.plan     = _make_subscription_plan()

        # Create data that belongs exclusively to Tenant B
        self.sub_b  = _make_tenant_subscription(self.tenant_b, self.plan)
        self.lic_b  = _make_license(self.tenant_b)
        self.intg_b = _make_integration(self.tenant_b)

        self.client.force_authenticate(user=self.user_a)

    # ── Regular tenant user gets 403 on admin-only platform views ─────────────

    def test_regular_tenant_user_cannot_access_subscription_list(self):
        """Platform subscription endpoints require platform admin — tenant users get 403."""
        resp = self.client.get(reverse("subscription-list"))
        self.assertEqual(resp.status_code, 403,
            "Regular tenant user must not access the subscription-list endpoint.")

    def test_regular_tenant_user_cannot_access_license_list(self):
        """Platform license endpoints require platform admin — tenant users get 403."""
        resp = self.client.get(reverse("license-list"))
        self.assertEqual(resp.status_code, 403,
            "Regular tenant user must not access the license-list endpoint.")

    def test_regular_tenant_user_cannot_access_subscription_with_tenant_b_code(self):
        """
        Even passing ?tenant_code=beta-corp, a regular tenant user must not
        reach Tenant B's subscriptions — they get 403 at the permission check.
        """
        resp = self.client.get(reverse("subscription-list"), {"tenant_code": "beta-corp"})
        self.assertEqual(resp.status_code, 403)

    # ── Superuser + mixin: scoped by explicit tenant_code ─────────────────────

    def test_superuser_with_tenant_b_code_sees_only_tenant_b_subscriptions(self):
        """
        A superuser passing ?tenant_code=beta-corp sees Tenant B's subscriptions
        but not Tenant A's — the mixin scopes the queryset.
        """
        superuser = User.objects.create_superuser("su_sub", password="pass")
        self.client.force_authenticate(user=superuser)
        sub_a = _make_tenant_subscription(self.tenant_a, self.plan)

        resp = self.client.get(reverse("subscription-list"), {"tenant_code": "beta-corp"})
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            ids = [r.get("id") or r.get("pk") for r in results]
            self.assertIn(self.sub_b.pk, ids)
            self.assertNotIn(sub_a.pk, ids,
                "Mixin must exclude Tenant A's subscriptions when filtered to beta-corp.")

    def test_superuser_with_tenant_a_code_sees_only_tenant_a_subscriptions(self):
        """
        A superuser passing ?tenant_code=alpha-corp sees Tenant A's subscriptions
        and not Tenant B's.
        """
        superuser = User.objects.create_superuser("su_sub2", password="pass")
        self.client.force_authenticate(user=superuser)
        sub_a = _make_tenant_subscription(self.tenant_a, self.plan)

        resp = self.client.get(reverse("subscription-list"), {"tenant_code": "alpha-corp"})
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            ids = [r.get("id") or r.get("pk") for r in results]
            self.assertIn(sub_a.pk, ids)
            self.assertNotIn(self.sub_b.pk, ids,
                "Mixin must exclude Tenant B's subscriptions when filtered to alpha-corp.")

    def test_superuser_with_tenant_a_code_sees_only_tenant_a_licenses(self):
        lic_a = _make_license(self.tenant_a)
        superuser = User.objects.create_superuser("su_lic", password="pass")
        self.client.force_authenticate(user=superuser)

        resp = self.client.get(reverse("license-list"), {"tenant_code": "alpha-corp"})
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            ids = [r.get("id") or r.get("pk") for r in results]
            self.assertIn(lic_a.pk, ids)
            self.assertNotIn(self.lic_b.pk, ids)

    def test_superuser_with_tenant_a_code_sees_only_tenant_a_integrations(self):
        intg_a = _make_integration(self.tenant_a)
        superuser = User.objects.create_superuser("su_intg", password="pass")
        self.client.force_authenticate(user=superuser)

        resp = self.client.get(reverse("integration-list"), {"tenant_code": "alpha-corp"})
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            ids = [r.get("id") or r.get("pk") for r in results]
            self.assertIn(intg_a.pk, ids)
            self.assertNotIn(self.intg_b.pk, ids)

    def test_superuser_can_see_all_tenants_without_param(self):
        """Superuser with no tenant_code param sees all tenants' subscriptions."""
        superuser = User.objects.create_superuser("su_all", password="pass")
        self.client.force_authenticate(user=superuser)
        sub_a = _make_tenant_subscription(self.tenant_a, self.plan)

        resp = self.client.get(reverse("subscription-list"))
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            ids = [r.get("id") or r.get("pk") for r in results]
            self.assertIn(self.sub_b.pk, ids)
            self.assertIn(sub_a.pk, ids)


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Weighbridge transaction isolation
# ═══════════════════════════════════════════════════════════════════════════════

class WeighbridgeTransactionIsolationTests(TestCase):
    """
    Verify strict tenant isolation on the Platform_API weighbridge endpoints.

    a) Default list — Tenant A user sees only their own tenant's transactions.
    b) Param manipulation — ?tenant_code=<b> returns empty list for Tenant A.
    c) IDOR — Tenant A user fetching Tenant B's transaction by PK gets 404.
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Weighbridge", code="alpha-wb")
        self.tenant_b = _make_tenant("Beta Weighbridge",  code="beta-wb")
        self.user_a   = _make_tenant_user("wb_user_a", self.tenant_a)

        # Tenant B's transaction (tenant FK set to tenant_b)
        objs = _make_wb_base_objects()
        self.tx_b = _make_transaction(**objs, tenant=self.tenant_b)

        # Tenant A's transaction (tenant FK set to tenant_a)
        objs_a = _make_wb_base_objects()
        self.tx_a = _make_transaction(**objs_a, tenant=self.tenant_a)

        self.client.force_authenticate(user=self.user_a)

    def test_transactions_endpoint_requires_authentication(self):
        """Unauthenticated access must be rejected (401 or 403)."""
        self.client.force_authenticate(user=None)
        resp = self.client.get(reverse("wb-transactions"))
        self.assertIn(resp.status_code, (401, 403))

    # ── a) Default list scoping ───────────────────────────────────────────────

    def test_default_list_shows_tenant_a_own_transactions(self):
        """Without any params, Tenant A user sees their own transactions."""
        resp = self.client.get(reverse("wb-transactions"))
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", [])
        ids = [r.get("id") for r in results]
        self.assertIn(self.tx_a.pk, ids,
            "Tenant A user must see their own transactions in the default list.")

    def test_default_list_excludes_tenant_b_transactions(self):
        """Without any params, Tenant A user must NOT see Tenant B's transactions."""
        resp = self.client.get(reverse("wb-transactions"))
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", [])
        ids = [r.get("id") for r in results]
        self.assertNotIn(self.tx_b.pk, ids,
            "Tenant A user must not see Tenant B's transactions in the default list.")

    # ── b) Param manipulation blocked ────────────────────────────────────────

    def test_cross_tenant_param_returns_empty_list(self):
        """Tenant A passing ?tenant_code=beta-wb must receive an empty result set."""
        resp = self.client.get(reverse("wb-transactions"), {"tenant_code": "beta-wb"})
        self.assertIn(resp.status_code, (200, 403))
        if resp.status_code == 200:
            results = resp.data.get("results", [])
            ids = [r.get("id") for r in results]
            self.assertNotIn(self.tx_b.pk, ids,
                "Cross-tenant tenant_code param must not return Tenant B's transactions.")

    def test_mismatched_tenant_code_yields_empty_not_500(self):
        """A completely unknown tenant_code must yield an empty list, not a server error."""
        resp = self.client.get(reverse("wb-transactions"), {"tenant_code": "no-such-tenant"})
        self.assertIn(resp.status_code, (200, 403))
        if resp.status_code == 200:
            self.assertEqual(len(resp.data.get("results", [])), 0)

    # ── c) IDOR blocked ───────────────────────────────────────────────────────

    def test_tenant_a_user_cannot_fetch_tenant_b_transaction_by_pk(self):
        """
        Tenant A user fetching Tenant B's transaction PK directly must receive
        404 — the detail view scopes the queryset to the requesting user's tenant.
        """
        url = reverse("wb-transaction-detail", kwargs={"pk": self.tx_b.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 404,
            "IDOR: Tenant A must not be able to fetch Tenant B's transaction by PK.")

    def test_tenant_a_user_can_fetch_own_transaction_by_pk(self):
        """Tenant A user must still be able to fetch their own transactions by PK."""
        url = reverse("wb-transaction-detail", kwargs={"pk": self.tx_a.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200,
            "Tenant A must be able to access their own transaction by PK.")
        self.assertEqual(resp.data.get("id"), self.tx_a.pk)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Invoice isolation
# ═══════════════════════════════════════════════════════════════════════════════

class InvoiceIsolationTests(TestCase):
    """
    Verify strict tenant isolation on the Platform_API payments endpoints.

    a) Default list — Tenant A user sees only their own tenant's invoices.
    b) Param manipulation — ?tenant_code=<b> returns empty list for Tenant A.
    c) IDOR — Tenant A user fetching Tenant B's invoice by PK gets 404.
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Invoicing", code="alpha-inv")
        self.tenant_b = _make_tenant("Beta Invoicing",  code="beta-inv")
        self.user_a   = _make_tenant_user("inv_user_a", self.tenant_a)

        # Create invoices in each tenant's context
        objs_b = _make_wb_base_objects()
        self.invoice_b = _make_invoice(objs_b["customer"], tenant=self.tenant_b)

        objs_a = _make_wb_base_objects()
        self.invoice_a = _make_invoice(objs_a["customer"], tenant=self.tenant_a)

        self.client.force_authenticate(user=self.user_a)

    def test_invoice_list_requires_authentication(self):
        """Unauthenticated access must be rejected."""
        self.client.force_authenticate(user=None)
        resp = self.client.get(reverse("invoice-list"))
        self.assertIn(resp.status_code, (401, 403))

    # ── a) Default list scoping ───────────────────────────────────────────────

    def test_default_list_shows_tenant_a_own_invoices(self):
        """Tenant A user without any params sees their own invoices."""
        resp = self.client.get(reverse("invoice-list"))
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", [])
        ids = [r.get("id") for r in results]
        self.assertIn(self.invoice_a.pk, ids,
            "Tenant A user must see their own invoices in the default list.")

    def test_default_list_excludes_tenant_b_invoices(self):
        """Tenant A user without any params must NOT see Tenant B's invoices."""
        resp = self.client.get(reverse("invoice-list"))
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data.get("results", [])
        ids = [r.get("id") for r in results]
        self.assertNotIn(self.invoice_b.pk, ids,
            "Tenant A user must not see Tenant B's invoices in the default list.")

    # ── b) Param manipulation blocked ────────────────────────────────────────

    def test_cross_tenant_param_returns_empty_invoice_list(self):
        """Tenant A passing ?tenant_code=beta-inv must receive zero invoices."""
        resp = self.client.get(reverse("invoice-list"), {"tenant_code": "beta-inv"})
        self.assertIn(resp.status_code, (200, 403))
        if resp.status_code == 200:
            results = resp.data.get("results", [])
            ids = [r.get("id") for r in results]
            self.assertNotIn(self.invoice_b.pk, ids,
                "Cross-tenant param must not leak Tenant B's invoices.")
            self.assertEqual(len(results), 0,
                "Result set must be empty when cross-tenant tenant_code is provided.")

    def test_mismatched_tenant_code_yields_empty_not_500(self):
        """A completely unknown tenant code must yield count=0, not an error."""
        resp = self.client.get(reverse("invoice-list"), {"tenant_code": "does-not-exist"})
        self.assertIn(resp.status_code, (200, 403))
        if resp.status_code == 200:
            self.assertEqual(resp.data.get("count", -1), 0)

    # ── c) IDOR blocked ───────────────────────────────────────────────────────

    def test_tenant_a_user_cannot_fetch_tenant_b_invoice_by_pk(self):
        """
        Tenant A user fetching Tenant B's invoice by PK directly must get 404 —
        the detail view scopes the queryset to the requesting user's tenant.
        """
        url = reverse("invoice-detail", kwargs={"pk": self.invoice_b.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 404,
            "IDOR: Tenant A must not be able to fetch Tenant B's invoice by PK.")

    def test_tenant_a_user_can_fetch_own_invoice_by_pk(self):
        """Tenant A must still be able to fetch their own invoice by PK."""
        url = reverse("invoice-detail", kwargs={"pk": self.invoice_a.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200,
            "Tenant A must be able to access their own invoice by PK.")
        self.assertEqual(int(resp.data.get("id", 0)), self.invoice_a.pk)

    def test_tenant_a_user_cannot_patch_tenant_b_invoice(self):
        """Tenant A must not be able to PATCH Tenant B's invoice — 404."""
        url = reverse("invoice-detail", kwargs={"pk": self.invoice_b.pk})
        resp = self.client.patch(url, {"notes": "hacked"}, format="json")
        self.assertEqual(resp.status_code, 404,
            "Tenant A must not be able to modify Tenant B's invoice.")


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Procurement order isolation
# ═══════════════════════════════════════════════════════════════════════════════

class ProcurementOrderIsolationTests(TestCase):
    """
    Verify strict tenant isolation on the Platform_API procurement endpoints.

    a) Default list — Tenant A user sees only their own purchase orders.
    b) Param manipulation — ?tenant_code=<b> returns empty list for Tenant A.
    c) IDOR — Tenant A user fetching Tenant B's PO by PK gets 404.
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Procurement", code="alpha-proc")
        self.tenant_b = _make_tenant("Beta Procurement",  code="beta-proc")
        self.user_a   = _make_tenant_user("proc_user_a", self.tenant_a)
        self.user_b   = _make_tenant_user("proc_user_b", self.tenant_b)

        # Purchase orders created by each tenant's user
        self.po_b = _make_purchase_order(created_by=self.user_b)
        self.po_a = _make_purchase_order(created_by=self.user_a)

        self.client.force_authenticate(user=self.user_a)

    def test_procurement_orders_requires_authentication(self):
        """Unauthenticated access must be rejected."""
        self.client.force_authenticate(user=None)
        resp = self.client.get(reverse("procurement-orders"))
        self.assertIn(resp.status_code, (401, 403))

    # ── a) Default list scoping ───────────────────────────────────────────────

    def test_default_list_shows_tenant_a_own_orders(self):
        """Tenant A user sees their own purchase orders without any params."""
        resp = self.client.get(reverse("procurement-orders"))
        self.assertEqual(resp.status_code, 200, resp.data)
        ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertIn(self.po_a.pk, ids,
            "Tenant A user must see their own purchase orders.")

    def test_default_list_excludes_tenant_b_orders(self):
        """Without any params, Tenant A user must NOT see Tenant B's purchase orders."""
        resp = self.client.get(reverse("procurement-orders"))
        self.assertEqual(resp.status_code, 200, resp.data)
        ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.po_b.pk, ids,
            "Tenant A user must not see Tenant B's purchase orders in the default list.")

    # ── b) Param manipulation blocked ────────────────────────────────────────

    def test_cross_tenant_param_returns_empty_procurement_list(self):
        """Tenant A passing ?tenant_code=beta-proc must receive zero purchase orders."""
        resp = self.client.get(reverse("procurement-orders"), {"tenant_code": "beta-proc"})
        self.assertIn(resp.status_code, (200, 403))
        if resp.status_code == 200:
            results = resp.data.get("results", [])
            ids = [r.get("id") for r in results]
            self.assertNotIn(self.po_b.pk, ids,
                "Cross-tenant param must not return Tenant B's purchase orders.")
            self.assertEqual(len(results), 0)

    # ── c) IDOR blocked ───────────────────────────────────────────────────────

    def test_tenant_a_user_cannot_fetch_tenant_b_order_by_pk(self):
        """
        Tenant A user fetching Tenant B's PO by PK directly must receive 404 —
        the detail view scopes the queryset to the requesting user's tenant.
        """
        url = reverse("procurement-order-detail", kwargs={"pk": self.po_b.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 404,
            "IDOR: Tenant A must not be able to fetch Tenant B's PO by PK.")

    def test_tenant_a_user_can_fetch_own_order_by_pk(self):
        """Tenant A must still be able to fetch their own PO by PK."""
        url = reverse("procurement-order-detail", kwargs={"pk": self.po_a.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200,
            "Tenant A must be able to access their own purchase order.")
        self.assertEqual(int(resp.data.get("id", 0)), self.po_a.pk)

    def test_tenant_a_cannot_patch_tenant_b_order(self):
        """Tenant A must not be able to PATCH Tenant B's PO — must get 404."""
        url = reverse("procurement-order-detail", kwargs={"pk": self.po_b.pk})
        resp = self.client.patch(url, {"notes": "hacked"}, format="json")
        self.assertEqual(resp.status_code, 404,
            "Tenant A must not be able to modify Tenant B's purchase order.")

    def test_superuser_can_fetch_any_tenant_order_by_pk(self):
        """Superusers must be able to fetch any tenant's PO by PK."""
        superuser = User.objects.create_superuser("su_po", password="pass")
        self.client.force_authenticate(user=superuser)
        url = reverse("procurement-order-detail", kwargs={"pk": self.po_b.pk})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200,
            "Superuser must be able to access any tenant's purchase order.")


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Weighbridge mutation endpoint IDOR tests
# ═══════════════════════════════════════════════════════════════════════════════

class WeighbridgeMutationIsolationTests(TestCase):
    """
    Verify that mutation endpoints (approve, recall, email-receipt,
    receive-payment, capture-weight) enforce the same tenant scoping as the
    list/detail endpoints — Tenant A must not be able to mutate Tenant B's
    transactions by guessing PKs.
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Mutations", code="alpha-mut")
        self.tenant_b = _make_tenant("Beta Mutations",  code="beta-mut")
        self.user_a   = _make_tenant_user("mut_user_a", self.tenant_a, is_staff=True)
        _make_tenant_user("mut_user_b", self.tenant_b)

        # Tenant B's completed transaction, assigned to tenant_b
        objs_b = _make_wb_base_objects()
        self.tx_b = _make_transaction(**objs_b, tenant=self.tenant_b)
        # Force to a state that mutation endpoints normally accept
        self.tx_b.status = "Completed"
        self.tx_b.payment_status = "Pending"
        self.tx_b.save()

        # Tenant A's own transaction, assigned to tenant_a
        objs_a = _make_wb_base_objects()
        self.tx_a = _make_transaction(**objs_a, tenant=self.tenant_a)
        self.tx_a.status = "Completed"
        self.tx_a.payment_status = "Pending"
        self.tx_a.save()

        self.client.force_authenticate(user=self.user_a)

    def test_approve_cross_tenant_tx_returns_404(self):
        """Tenant A must not be able to approve Tenant B's transaction."""
        url = reverse("wb-transaction-approve", kwargs={"pk": self.tx_b.pk})
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, 404,
            "IDOR: approving a cross-tenant transaction must return 404.")

    def test_recall_cross_tenant_tx_returns_404(self):
        """Tenant A must not be able to recall Tenant B's transaction."""
        url = reverse("wb-transaction-recall", kwargs={"pk": self.tx_b.pk})
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, 404,
            "IDOR: recalling a cross-tenant transaction must return 404.")

    def test_email_receipt_cross_tenant_tx_returns_404(self):
        """Tenant A must not be able to email-receipt Tenant B's transaction."""
        url = reverse("wb-transaction-email-receipt", kwargs={"pk": self.tx_b.pk})
        resp = self.client.post(url, {"email": "hacker@example.com"}, format="json")
        self.assertEqual(resp.status_code, 404,
            "IDOR: emailing receipt for a cross-tenant transaction must return 404.")

    def test_receive_payment_cross_tenant_tx_returns_404(self):
        """Tenant A must not be able to receive-payment on Tenant B's transaction."""
        url = reverse("wb-transaction-receive-payment", kwargs={"pk": self.tx_b.pk})
        resp = self.client.post(url, {"method": "Cash"}, format="json")
        self.assertEqual(resp.status_code, 404,
            "IDOR: receiving payment for a cross-tenant transaction must return 404.")

    def test_capture_weight_cross_tenant_transaction_id_returns_404(self):
        """
        Tenant A passing transaction_id of a Tenant B transaction to
        capture-weight must receive 404, not apply weight to that transaction.
        """
        url = reverse("wb-capture-weight")
        resp = self.client.post(url, {"transaction_id": self.tx_b.pk}, format="json")
        self.assertEqual(resp.status_code, 404,
            "IDOR: capture-weight with cross-tenant transaction_id must return 404.")

    def test_approve_own_tx_succeeds(self):
        """Tenant A must still be able to approve their own transaction."""
        url = reverse("wb-transaction-approve", kwargs={"pk": self.tx_a.pk})
        resp = self.client.post(url)
        self.assertIn(resp.status_code, (200, 400),
            "Approving an own transaction must not return 404.")
        self.assertNotEqual(resp.status_code, 404)

    def test_receive_payment_own_tx_succeeds(self):
        """Tenant A must still be able to receive payment on their own transaction."""
        url = reverse("wb-transaction-receive-payment", kwargs={"pk": self.tx_a.pk})
        resp = self.client.post(url, {"method": "Cash"}, format="json")
        self.assertIn(resp.status_code, (200, 400),
            "Receiving payment for own transaction must not return 404.")
        self.assertNotEqual(resp.status_code, 404)


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Tenant assignment on create
# ═══════════════════════════════════════════════════════════════════════════════

class TenantAssignmentOnCreateTests(TestCase):
    """
    Verify that the `tenant` FK is correctly populated when new transactions
    and invoices are created via the API, so they appear in the creator's
    tenant-scoped list and are invisible to other tenants.
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Create", code="alpha-create")
        self.tenant_b = _make_tenant("Beta Create",  code="beta-create")
        self.user_a   = _make_tenant_user("create_user_a", self.tenant_a)
        self.user_b   = _make_tenant_user("create_user_b", self.tenant_b)

        self.objs = _make_wb_base_objects()

    def test_created_transaction_is_scoped_to_creator_tenant(self):
        """
        A transaction created by Tenant A's user must have tenant=Tenant A,
        so it is visible in Tenant A's list but not in Tenant B's.
        """
        from SL_Weighbridge.models import Transaction
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.post(
            reverse("wb-transactions"),
            {
                "branch":          self.objs["branch"].pk,
                "customer":        self.objs["customer"].pk,
                "vehicle":         self.objs["vehicle"].pk,
                "vehicle_type":    self.objs["vt"].pk,
                "item":            self.objs["item"].pk,
                "operator":        "test_op",
                "weight_type":     "First Weight",
                "payment_mode":    "Cash",
                "payment_status":  "Pending",
                "destination":     "Test Destination",
                "gross_weight":    10000,
                "tare_weight":     2000,
                "net_weight":      8000,
                "status":          "Completed",
            },
            format="json",
        )
        self.assertIn(resp.status_code, (200, 201), f"Transaction create failed: {resp.data}")

        tx_pk = resp.data.get("id")
        self.assertIsNotNone(tx_pk, "Created transaction must return an id.")

        # Verify tenant is set on the DB record
        tx = Transaction.objects.get(pk=tx_pk)
        self.assertEqual(tx.tenant, self.tenant_a,
            "Created transaction must have tenant=Tenant A automatically.")

    def test_created_transaction_visible_in_own_list_not_other_tenant(self):
        """
        A transaction created by Tenant A must be visible in Tenant A's list
        and invisible in Tenant B's list.
        """
        # Create transaction as Tenant A
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.post(
            reverse("wb-transactions"),
            {
                "branch":          self.objs["branch"].pk,
                "customer":        self.objs["customer"].pk,
                "vehicle":         self.objs["vehicle"].pk,
                "vehicle_type":    self.objs["vt"].pk,
                "item":            self.objs["item"].pk,
                "operator":        "op_a",
                "weight_type":     "First Weight",
                "payment_mode":    "Cash",
                "payment_status":  "Pending",
                "destination":     "Dest A",
                "gross_weight":    5000,
                "tare_weight":     1000,
                "net_weight":      4000,
                "status":          "Pending",
            },
            format="json",
        )
        self.assertIn(resp.status_code, (200, 201))
        tx_pk = resp.data.get("id")

        # Tenant A sees it in their list
        list_resp = self.client.get(reverse("wb-transactions"))
        self.assertEqual(list_resp.status_code, 200)
        ids_a = [r.get("id") for r in list_resp.data.get("results", [])]
        self.assertIn(tx_pk, ids_a, "Tenant A must see their own created transaction.")

        # Tenant B does NOT see it
        self.client.force_authenticate(user=self.user_b)
        list_resp_b = self.client.get(reverse("wb-transactions"))
        self.assertEqual(list_resp_b.status_code, 200)
        ids_b = [r.get("id") for r in list_resp_b.data.get("results", [])]
        self.assertNotIn(tx_pk, ids_b, "Tenant B must not see Tenant A's created transaction.")

    def test_created_invoice_is_scoped_to_creator_tenant(self):
        """
        A manual invoice created by Tenant A's user must have tenant=Tenant A.
        """
        from SL_Weighbridge.models import Invoice
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.post(
            reverse("invoice-list"),
            {
                "customer_id": self.objs["customer"].pk,
                "line_items": [{"description": "Test Service", "quantity": 1, "unit_price": 500}],
                "currency": "KES",
            },
            format="json",
        )
        self.assertIn(resp.status_code, (200, 201), f"Invoice create failed: {resp.data}")

        inv_pk = resp.data.get("id")
        self.assertIsNotNone(inv_pk, "Created invoice must return an id.")

        inv = Invoice.objects.get(pk=inv_pk)
        self.assertEqual(inv.tenant, self.tenant_a,
            "Created invoice must have tenant=Tenant A automatically.")

    def test_created_invoice_visible_in_own_list_not_other_tenant(self):
        """
        A manual invoice created by Tenant A must appear in Tenant A's list
        and be absent from Tenant B's list.
        """
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.post(
            reverse("invoice-list"),
            {
                "customer_id": self.objs["customer"].pk,
                "line_items": [{"description": "Isolation Test", "quantity": 2, "unit_price": 250}],
                "currency": "KES",
            },
            format="json",
        )
        self.assertIn(resp.status_code, (200, 201))
        inv_pk = resp.data.get("id")

        # Tenant A sees it
        list_resp = self.client.get(reverse("invoice-list"))
        self.assertEqual(list_resp.status_code, 200)
        ids_a = [r.get("id") for r in list_resp.data.get("results", [])]
        self.assertIn(inv_pk, ids_a, "Tenant A must see their own created invoice.")

        # Tenant B does NOT see it
        self.client.force_authenticate(user=self.user_b)
        list_resp_b = self.client.get(reverse("invoice-list"))
        self.assertEqual(list_resp_b.status_code, 200)
        ids_b = [r.get("id") for r in list_resp_b.data.get("results", [])]
        self.assertNotIn(inv_pk, ids_b, "Tenant B must not see Tenant A's created invoice.")


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Dashboard / summary / export isolation tests
# ═══════════════════════════════════════════════════════════════════════════════

class DashboardSummaryIsolationTests(TestCase):
    """
    Verify that dashboard, summary, and export endpoints return only data
    belonging to the requesting user's tenant.

    Covers:
    - WeighbridgeDashboardView  (wb-dashboard)
    - TransactionExportCSVView  (wb-transactions-export-csv)
    - PaymentSummaryView        (payment-summary)
    - UninvoicedTransactionsView (uninvoiced-transactions)
    - DebtSummaryView            (debt-summary)
    - ProcurementDashboardView   (procurement-dashboard)
    - CustomerListForInvoiceView (invoice-customers)
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("Alpha Dashboard", code="alpha-dash")
        self.tenant_b = _make_tenant("Beta Dashboard",  code="beta-dash")
        self.user_a   = _make_tenant_user("dash_user_a", self.tenant_a)
        self.user_b   = _make_tenant_user("dash_user_b", self.tenant_b)

        # Tenant B's weighbridge objects
        objs_b = _make_wb_base_objects()
        self.tx_b = _make_transaction(**objs_b, tenant=self.tenant_b)
        self.tx_b.status = "Completed"
        self.tx_b.charge = 500
        self.tx_b.payment_mode = "Debt"
        self.tx_b.payment_status = "Pending"
        self.tx_b.save()

        self.inv_b = _make_invoice(objs_b["customer"], tenant=self.tenant_b)

        # Tenant A's weighbridge objects
        objs_a = _make_wb_base_objects()
        self.tx_a = _make_transaction(**objs_a, tenant=self.tenant_a)
        self.tx_a.status = "Completed"
        self.tx_a.charge = 300
        self.tx_a.payment_mode = "Cash"
        self.tx_a.payment_status = "Pending"
        self.tx_a.save()

        self.inv_a = _make_invoice(objs_a["customer"], tenant=self.tenant_a)

        # Tenant A's purchase order
        self.po_a = _make_purchase_order(created_by=self.user_a)
        self.po_a.status = "Approved"
        self.po_a.save()

        # Tenant B's purchase order
        self.po_b = _make_purchase_order(created_by=self.user_b)
        self.po_b.status = "Approved"
        self.po_b.save()

        self.client.force_authenticate(user=self.user_a)

    # ── WeighbridgeDashboardView ──────────────────────────────────────────────

    def test_dashboard_does_not_leak_tenant_b_recent_transactions(self):
        """
        The weighbridge dashboard's recent_transactions list must not include
        Tenant B's transactions when viewed by Tenant A.
        """
        resp = self.client.get(reverse("wb-dashboard"))
        self.assertEqual(resp.status_code, 200, resp.data)
        recent_ids = [t.get("id") for t in resp.data.get("recent_transactions", [])]
        self.assertNotIn(self.tx_b.pk, recent_ids,
            "Dashboard must not expose Tenant B's transactions to Tenant A.")

    def test_dashboard_shows_tenant_a_own_transactions(self):
        """The weighbridge dashboard must include Tenant A's own recent transactions."""
        resp = self.client.get(reverse("wb-dashboard"))
        self.assertEqual(resp.status_code, 200)
        recent_ids = [t.get("id") for t in resp.data.get("recent_transactions", [])]
        self.assertIn(self.tx_a.pk, recent_ids,
            "Dashboard must include Tenant A's own transactions.")

    # ── TransactionExportCSVView ──────────────────────────────────────────────

    def test_csv_export_does_not_include_tenant_b_transactions(self):
        """
        The CSV export must only contain Tenant A's transactions, not Tenant B's.
        """
        resp = self.client.get(reverse("wb-transactions-export-csv"))
        self.assertEqual(resp.status_code, 200)
        content = resp.content.decode()
        # Tenant B's transaction ID should not appear in the CSV rows
        self.assertNotIn(str(self.tx_b.pk).zfill(5), content,
            "CSV export must not include Tenant B's transactions.")

    # ── PaymentSummaryView ────────────────────────────────────────────────────

    def test_payment_summary_does_not_include_tenant_b_totals(self):
        """
        PaymentSummaryView must return totals only from Tenant A's invoices.
        With only one invoice for each tenant, the issued-status count must
        not include Tenant B's invoice.
        """
        resp = self.client.get(reverse("payment-summary"))
        self.assertEqual(resp.status_code, 200)
        # Tenant B's invoice total is 1500; if cross-tenant leak occurred,
        # the totals would reflect double the expected amount.
        issued = next(
            (r for r in resp.data.get("invoices_by_status", []) if r.get("status") == "issued"),
            None,
        )
        if issued:
            self.assertLessEqual(issued.get("count", 0), 1,
                "Summary must count only Tenant A's invoices, not Tenant B's.")

    # ── UninvoicedTransactionsView ────────────────────────────────────────────

    def test_uninvoiced_transactions_does_not_expose_tenant_b(self):
        """
        /api/payments/uninvoiced-transactions/ must not return Tenant B's
        uninvoiced transactions to Tenant A.
        """
        # Make sure tx_b is uninvoiced
        self.tx_b.invoiced = False
        self.tx_b.save()

        resp = self.client.get(reverse("uninvoiced-transactions"))
        self.assertEqual(resp.status_code, 200)
        ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.tx_b.pk, ids,
            "Uninvoiced transactions view must not expose Tenant B's transactions.")

    # ── DebtSummaryView ───────────────────────────────────────────────────────

    def test_debt_summary_does_not_include_tenant_b_customers(self):
        """
        /api/payments/debt/ must only return Tenant A's customers with debt,
        not Tenant B's.
        """
        resp = self.client.get(reverse("debt-summary"))
        self.assertEqual(resp.status_code, 200)
        customer_ids = [r.get("customer_id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.tx_b.customer_id, customer_ids,
            "Debt summary must not expose Tenant B's customers to Tenant A.")

    # ── ProcurementDashboardView ──────────────────────────────────────────────

    def test_procurement_dashboard_does_not_expose_tenant_b_recent_orders(self):
        """
        /api/procurement/dashboard/ must not include Tenant B's purchase orders
        in the recent list returned to Tenant A.
        """
        resp = self.client.get(reverse("procurement-dashboard"))
        self.assertEqual(resp.status_code, 200)
        recent_ids = [r.get("id") for r in resp.data.get("recent", [])]
        self.assertNotIn(self.po_b.pk, recent_ids,
            "Procurement dashboard must not expose Tenant B's orders to Tenant A.")

    def test_procurement_dashboard_counts_only_tenant_a_orders(self):
        """
        The procurement dashboard total count must only include Tenant A's
        purchase orders, not Tenant B's.
        """
        resp = self.client.get(reverse("procurement-dashboard"))
        self.assertEqual(resp.status_code, 200)
        counts = resp.data.get("counts", {})
        # Tenant A has 1 approved PO; if Tenant B's is included, count >= 2
        total = counts.get("total", 0)
        self.assertLessEqual(total, 1,
            "Procurement dashboard must count only Tenant A's orders.")

    # ── CustomerListForInvoiceView ────────────────────────────────────────────

    def test_customer_list_does_not_expose_tenant_b_customers(self):
        """
        /api/payments/customers/ must not list Tenant B's customers (those whose
        transactions belong exclusively to Tenant B) to Tenant A.
        """
        resp = self.client.get(reverse("invoice-customers"))
        self.assertEqual(resp.status_code, 200)
        customer_ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.tx_b.customer_id, customer_ids,
            "Customer list must not expose Tenant B's customers to Tenant A.")


# ═══════════════════════════════════════════════════════════════════════════════
# 8. Profileless (no TenantUserProfile) non-superuser — deny-all tests
# ═══════════════════════════════════════════════════════════════════════════════

class ProfilelessUserDenyAllTests(TestCase):
    """
    A non-superuser with NO TenantUserProfile must receive an empty result set
    (never global data) for every tenant-scoped endpoint.

    This validates the "fail-closed / deny-all" path in all three-state tenant
    resolver helpers (_apply_tenant_filter, _apply_invoice_tenant_filter,
    _apply_po_tenant_filter).
    """

    def setUp(self):
        self.client = APIClient()
        # Profileless user — no TenantUserProfile attached
        self.profileless_user = User.objects.create_user(
            username="no_profile_user", password="pass"
        )

        # Create some data owned by a real tenant so we can confirm it's hidden
        tenant   = _make_tenant("RealCo", code="realco")
        real_user = _make_tenant_user("real_user_pl", tenant)
        objs     = _make_wb_base_objects()
        self.real_tx  = _make_transaction(**objs, tenant=tenant)
        self.real_inv = _make_invoice(objs["customer"], tenant=tenant)
        self.real_po  = _make_purchase_order(created_by=real_user)

        self.client.force_authenticate(user=self.profileless_user)

    def test_profileless_weighbridge_list_returns_empty(self):
        """Profileless user gets an empty transaction list, not global data."""
        resp = self.client.get(reverse("wb-transactions"))
        self.assertEqual(resp.status_code, 200)
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            ids = [r.get("id") for r in results]
        else:
            ids = [r.get("id") for r in results.get("results", [])]
        self.assertNotIn(self.real_tx.pk, ids,
            "Profileless user must not see any tenant's transactions.")

    def test_profileless_weighbridge_dashboard_is_empty(self):
        """Weighbridge dashboard for profileless user must show zero totals."""
        resp = self.client.get(reverse("wb-dashboard"))
        self.assertEqual(resp.status_code, 200)
        recent_ids = [t.get("id") for t in resp.data.get("recent_transactions", [])]
        self.assertNotIn(self.real_tx.pk, recent_ids,
            "Profileless user dashboard must not expose any tenant's transactions.")

    def test_profileless_csv_export_returns_empty(self):
        """CSV export for profileless user must contain no data rows."""
        resp = self.client.get(reverse("wb-transactions-export-csv"))
        self.assertEqual(resp.status_code, 200)
        content = resp.content.decode()
        self.assertNotIn(str(self.real_tx.pk).zfill(5), content,
            "Profileless user CSV export must not include any tenant's transactions.")

    def test_profileless_invoice_list_returns_empty(self):
        """Profileless user gets an empty invoice list."""
        resp = self.client.get(reverse("invoice-list"))
        self.assertEqual(resp.status_code, 200)
        ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.real_inv.pk, ids,
            "Profileless user must not see any tenant's invoices.")

    def test_profileless_invoice_detail_returns_404(self):
        """Profileless user cannot fetch a specific invoice by PK."""
        resp = self.client.get(reverse("invoice-detail", args=[self.real_inv.pk]))
        self.assertEqual(resp.status_code, 404,
            "Profileless user must get 404 on invoice detail.")

    def test_profileless_procurement_list_returns_empty(self):
        """Profileless user gets an empty procurement list."""
        resp = self.client.get(reverse("procurement-orders"))
        self.assertEqual(resp.status_code, 200)
        ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.real_po.pk, ids,
            "Profileless user must not see any tenant's purchase orders.")

    def test_profileless_procurement_detail_returns_404(self):
        """Profileless user cannot fetch a specific purchase order by PK."""
        resp = self.client.get(reverse("procurement-order-detail", args=[self.real_po.pk]))
        self.assertEqual(resp.status_code, 404,
            "Profileless user must get 404 on procurement order detail.")

    def test_profileless_uninvoiced_transactions_returns_empty(self):
        """Profileless user gets an empty uninvoiced-transactions list."""
        resp = self.client.get(reverse("uninvoiced-transactions"))
        self.assertEqual(resp.status_code, 200)
        ids = [r.get("id") for r in resp.data.get("results", [])]
        self.assertNotIn(self.real_tx.pk, ids,
            "Profileless user must not see any tenant's uninvoiced transactions.")

    def test_profileless_cannot_issue_real_tenant_invoice(self):
        """Profileless user must get 404 when trying to issue another tenant's invoice."""
        resp = self.client.post(reverse("invoice-issue", args=[self.real_inv.pk]))
        self.assertEqual(resp.status_code, 404,
            "Profileless user must get 404 on invoice-issue, not mutate it.")

    def test_profileless_cannot_receive_payment_on_real_tenant_invoice(self):
        """Profileless user must get 404 when trying to receive payment on another tenant's invoice."""
        resp = self.client.post(
            reverse("invoice-receive-payment", args=[self.real_inv.pk]),
            {"amount": 100, "payment_mode": "Cash"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404,
            "Profileless user must get 404 on receive-payment, not mutate the invoice.")

    def test_profileless_cannot_confirm_payment_on_real_tenant_invoice(self):
        """Profileless user must get 404 when trying to confirm payment on another tenant's invoice."""
        resp = self.client.post(
            reverse("invoice-confirm", args=[self.real_inv.pk]),
            {"gateway_reference": "REF123"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404,
            "Profileless user must get 404 on invoice-confirm, not mutate the invoice.")

    def test_profileless_cannot_update_procurement_order_status(self):
        """Profileless user must get 404 when trying to change another tenant's PO status."""
        # Move real PO to submitted first so there's a valid transition to attempt
        self.real_po.status = "Draft"
        self.real_po.save()
        resp = self.client.patch(
            reverse("procurement-order-status", args=[self.real_po.pk]),
            {"status": "Submitted"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404,
            "Profileless user must get 404 on procurement status update, not mutate the PO.")


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Invoice generation / debt consolidation cross-tenant IDOR
# ═══════════════════════════════════════════════════════════════════════════════

class InvoiceGenerationIDORTests(TestCase):
    """
    Tenant A must not be able to generate an invoice using Tenant B's
    transaction IDs (GenerateInvoiceView) or consolidate Tenant B's debt
    (DebtConsolidateView).
    """

    def setUp(self):
        self.client = APIClient()
        self.tenant_a = _make_tenant("GenCo Alpha", code="gen-alpha")
        self.tenant_b = _make_tenant("GenCo Beta",  code="gen-beta")
        self.user_a   = _make_tenant_user("gen_user_a", self.tenant_a)

        objs_b = _make_wb_base_objects()
        # Tenant B completed uninvoiced transaction
        self.tx_b = _make_transaction(**objs_b, tenant=self.tenant_b)
        self.tx_b.status = "Completed"
        self.tx_b.invoiced = False
        self.tx_b.payment_mode = "Debt"
        self.tx_b.payment_status = "Pending"
        self.tx_b.charge = 1200
        self.tx_b.save()

        self.customer_b = objs_b["customer"]
        self.client.force_authenticate(user=self.user_a)

    def test_generate_invoice_with_tenant_b_transaction_ids_is_rejected(self):
        """
        Tenant A POSTing Tenant B's transaction IDs to /api/payments/invoices/generate/
        must receive a 400 error — not create a cross-tenant invoice.
        """
        resp = self.client.post(
            reverse("invoice-generate"),
            {
                "customer_id": self.customer_b.pk,
                "transaction_ids": [self.tx_b.pk],
                "currency": "KES",
            },
            format="json",
        )
        # Must be rejected (400 — invalid transaction IDs since they're out of scope)
        self.assertEqual(resp.status_code, 400,
            "Generating an invoice from cross-tenant transaction IDs must return 400.")

    def test_generate_invoice_does_not_mark_tenant_b_transaction_as_invoiced(self):
        """
        Even if a cross-tenant generate attempt is made, Tenant B's transaction
        must NOT be marked as invoiced.
        """
        self.client.post(
            reverse("invoice-generate"),
            {
                "customer_id": self.customer_b.pk,
                "transaction_ids": [self.tx_b.pk],
                "currency": "KES",
            },
            format="json",
        )
        self.tx_b.refresh_from_db()
        self.assertFalse(self.tx_b.invoiced,
            "Tenant B's transaction must not be marked invoiced by a cross-tenant request.")

    def test_debt_consolidation_does_not_invoice_tenant_b_debt(self):
        """
        Tenant A calling /api/payments/debt/consolidate/ with Tenant B's customer_id
        must receive a 400 error — Tenant B's transactions are out of scope.
        """
        resp = self.client.post(
            reverse("debt-consolidate"),
            {"customer_id": self.customer_b.pk, "currency": "KES"},
            format="json",
        )
        # The tenant-scoped transaction query returns nothing → "no outstanding debt" → 400
        self.assertEqual(resp.status_code, 400,
            "Debt consolidation for a cross-tenant customer must return 400.")
