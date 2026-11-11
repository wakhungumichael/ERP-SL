from decimal import Decimal
from random import Random

from django.contrib.auth.models import User
from django.test import TestCase, SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.documents import _invoice_context
from Platform_Core.models import Tenant, TenantSettings, TenantUserProfile
from SL_Sales.models import OrganisationCharge
from SL_Weighbridge.invoice_tax import split_inclusive_combined_tax
from SL_Weighbridge.models import Customer, Invoice


class InclusiveTaxAllocationTests(SimpleTestCase):
    def test_allocated_net_lines_always_balance_with_gross_and_tax(self):
        random = Random(42)
        for _ in range(500):
            amounts = [Decimal(random.randrange(100000)) / 100000 for _ in range(random.randrange(1, 20))]
            rate = Decimal(random.randrange(100000)) / 100
            lines, subtotal, tax = split_inclusive_combined_tax(amounts, rate)
            self.assertEqual(sum(lines), subtotal)
            self.assertEqual(subtotal + tax, sum(amounts).quantize(Decimal(".01")))
            self.assertTrue(all(amount >= 0 and amount == amount.quantize(Decimal(".01")) for amount in lines))


class InclusiveInvoiceTaxTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Inclusive invoices", code="inclusive-tax", status="active")
        self.user = User.objects.create_user("inclusive-admin", password="pass")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.settings = TenantSettings.objects.create(tenant=self.tenant, default_tax_name="VAT", default_tax_rate=16)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Tax Customer", phone_number="+254700112244")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_invoice(self, **overrides):
        payload = {
            "customer_id": self.customer.pk,
            "tax_mode": "combined",
            "combined_tax_rate": "16",
            "prices_include_tax": True,
            "line_items": [{"description": "Service", "qty": "1", "unit_price": "1160.00"}],
            **overrides,
        }
        return self.client.post(reverse("invoice-list"), payload, format="json")

    def invoice(self, **overrides):
        response = self.create_invoice(**overrides)
        self.assertEqual(response.status_code, 201, response.data)
        return Invoice.objects.get(pk=response.data["id"])

    def test_inclusive_total_is_unchanged_and_extracts_tax_not_sixteen_percent_of_gross(self):
        invoice = self.invoice()
        self.assertTrue(invoice.prices_include_tax)
        self.assertEqual(invoice.subtotal_amount, Decimal("1000"))
        self.assertEqual(invoice.tax_total, Decimal("160"))
        self.assertEqual(invoice.total_amount, Decimal("1160"))
        line = invoice.lines.get()
        self.assertEqual(line.unit_price, Decimal("1160"))
        self.assertEqual(line.total_amount, Decimal("1000"))
        data = self.client.get(reverse("invoice-detail", args=[invoice.pk])).data
        self.assertTrue(data["prices_include_tax"])
        self.assertEqual(data["lines"][0]["unit_price"], 1160)
        self.assertEqual(data["lines"][0]["net_unit_price"], 1000)

    def test_rounds_tax_from_one_hundred_inclusive(self):
        invoice = self.invoice(line_items=[{"description": "Service", "qty": 1, "unit_price": 100}])
        self.assertEqual(invoice.subtotal_amount, Decimal("86.21"))
        self.assertEqual(invoice.tax_total, Decimal("13.79"))
        self.assertEqual(invoice.total_amount, Decimal("100"))

    def test_zero_rate_is_allowed(self):
        invoice = self.invoice(combined_tax_rate=0)
        self.assertEqual(invoice.subtotal_amount, Decimal("1160"))
        self.assertEqual(invoice.tax_total, 0)
        self.assertEqual(invoice.total_amount, Decimal("1160"))

    def test_exclusive_is_default_and_false_string_is_not_truthy(self):
        for value in [False, "false"]:
            invoice = self.invoice(prices_include_tax=value)
            self.assertFalse(invoice.prices_include_tax)
            self.assertEqual(invoice.subtotal_amount, Decimal("1160"))
            self.assertEqual(invoice.tax_total, Decimal("185.60"))
            self.assertEqual(invoice.total_amount, Decimal("1345.60"))
        self.assertFalse(Invoice._meta.get_field("prices_include_tax").get_default())

    def test_additional_charges_are_separate_and_percentage_uses_net_subtotal(self):
        percentage = OrganisationCharge.objects.create(tenant=self.tenant, name="Levy", calculation_type="percentage", rate=2)
        fixed = OrganisationCharge.objects.create(tenant=self.tenant, name="Delivery", calculation_type="fixed", rate=50)
        invoice = self.invoice(charge_ids=[percentage.pk, fixed.pk])
        self.assertEqual(invoice.subtotal_amount, Decimal("1000"))
        self.assertEqual(invoice.tax_total, Decimal("160"))
        self.assertEqual(invoice.charge_total, Decimal("70"))
        self.assertEqual(invoice.total_amount, Decimal("1230"))
        self.assertEqual(invoice.charges.get(charge_rule=percentage).amount, Decimal("20"))

    def test_fractional_lines_balance_and_survive_repeated_edits(self):
        for items in [
            [{"description": str(i), "qty": 1, "unit_price": ".01"} for i in range(6)],
            [{"description": str(i), "qty": ".333", "unit_price": ".01"} for i in range(5)],
            [{"description": "A", "qty": "2.375", "unit_price": "123.45"}, {"description": "B", "qty": ".125", "unit_price": "9.99"}],
        ]:
            with self.subTest(items=items):
                invoice = self.invoice(line_items=items)
                original = (invoice.subtotal_amount, invoice.tax_total, invoice.total_amount)
                self.assertEqual(sum(line.total_amount for line in invoice.lines.all()), invoice.subtotal_amount)
                for _ in range(3):
                    response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), {"line_items": items}, format="json")
                    self.assertEqual(response.status_code, 200, response.data)
                    invoice.refresh_from_db()
                    self.assertEqual((invoice.subtotal_amount, invoice.tax_total, invoice.total_amount), original)
                    self.assertEqual(sum(line.total_amount for line in invoice.lines.all()), invoice.subtotal_amount)
                self.assertEqual(list(invoice.lines.values_list("unit_price", flat=True)), [Decimal(item["unit_price"]) for item in items])

    def test_can_change_rate_and_switch_between_exclusive_and_inclusive(self):
        invoice = self.invoice()
        url = reverse("invoice-detail", args=[invoice.pk])
        response = self.client.patch(url, {"combined_tax_rate": 10}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["subtotal_amount"], 1054.55)
        self.assertEqual(response.data["tax_total"], 105.45)
        self.assertEqual(response.data["total_amount"], 1160)
        response = self.client.patch(url, {"prices_include_tax": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["prices_include_tax"])
        self.assertEqual(response.data["subtotal_amount"], 1160)
        self.assertEqual(response.data["total_amount"], 1276)
        response = self.client.patch(url, {"prices_include_tax": True, "combined_tax_rate": 16}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["total_amount"], 1160)
        self.assertEqual(response.data["subtotal_amount"], 1000)

    def test_invalid_treatment_and_rates_are_rejected_without_creating_invoices(self):
        for fields in [
            {"tax_mode": "per_line"},
            {"prices_include_tax": "invalid"},
            {"combined_tax_rate": "NaN"},
            {"combined_tax_rate": "-1"},
            {"combined_tax_rate": "Infinity"},
            {"combined_tax_rate": "bad"},
            {"combined_tax_rate": "1000"},
        ]:
            with self.subTest(fields=fields):
                count = Invoice.objects.count()
                response = self.create_invoice(**fields)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(Invoice.objects.count(), count)

    def test_invalid_edit_does_not_change_saved_invoice(self):
        invoice = self.invoice()
        line_pk = invoice.lines.get().pk
        for payload in [{"tax_mode": "per_line"}, {"combined_tax_rate": "NaN"}, {"prices_include_tax": "invalid"}]:
            response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), payload, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            invoice.refresh_from_db()
            self.assertTrue(invoice.prices_include_tax)
            self.assertEqual(invoice.total_amount, Decimal("1160"))
            self.assertEqual(invoice.lines.get().pk, line_pk)

    def test_issued_invoices_cannot_change_tax_treatment(self):
        invoice = self.invoice()
        invoice.status = "issued"
        invoice.save()
        response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), {"prices_include_tax": False}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        invoice.refresh_from_db()
        self.assertTrue(invoice.prices_include_tax)
        self.assertEqual(invoice.total_amount, Decimal("1160"))

    def test_document_uses_net_prices_balanced_totals_and_included_tax_label(self):
        invoice = self.invoice()
        context = _invoice_context(invoice, self.settings)
        self.assertEqual(context["lines"][0]["unit_price"], Decimal("1000"))
        self.assertEqual(context["lines"][0]["total"], Decimal("1000"))
        self.assertEqual(context["totals"]["subtotal"], Decimal("1000"))
        self.assertEqual(context["totals"]["tax"], Decimal("160"))
        self.assertEqual(context["totals"]["total"], Decimal("1160"))
        self.assertEqual(context["totals"]["tax_label"], "VAT (16%) included")

    def test_entered_milestone_prices_survive_combined_tax_save_and_reopen(self):
        items = [
            {"description": "Milestone 1", "qty": 1, "unit_price": "737500.00"},
            {"description": "Milestone 2", "qty": 1, "unit_price": "590000.00"},
        ]
        invoice = self.invoice(line_items=items)
        for _ in range(2):
            data = self.client.get(reverse("invoice-detail", args=[invoice.pk])).data
            self.assertEqual([line["unit_price"] for line in data["lines"]], [737500, 590000])
            self.assertEqual(data["subtotal_amount"], 1144396.55)
            self.assertEqual(data["tax_total"], 183103.45)
            self.assertEqual(data["total_amount"], 1327500)
            response = self.client.patch(reverse("invoice-detail", args=[invoice.pk]), {"line_items": items}, format="json")
            self.assertEqual(response.status_code, 200, response.data)

    def test_combined_tax_uses_configured_rates_and_all_lines_total(self):
        self.settings.default_tax_name = "Configured tax"
        self.settings.default_tax_rate = Decimal("15")
        self.settings.save()
        for rate in [Decimal("0"), Decimal("7.5"), Decimal("15"), Decimal("20")]:
            with self.subTest(rate=rate):
                gross = Decimal("100") + rate
                inclusive = self.invoice(currency="ZAR", combined_tax_rate=str(rate), line_items=[
                    {"description": "A", "qty": 1, "unit_price": str(gross / 2)},
                    {"description": "B", "qty": 1, "unit_price": str(gross / 2)},
                ])
                self.assertEqual(inclusive.subtotal_amount, Decimal("100"))
                self.assertEqual(inclusive.tax_total, rate)
                self.assertEqual(inclusive.total_amount, gross)
                self.assertEqual(inclusive.combined_tax_name, "Configured tax")
                self.assertEqual(inclusive.currency, "ZAR")
                exclusive = self.invoice(prices_include_tax=False, combined_tax_rate=str(rate), line_items=[
                    {"description": "A", "qty": 1, "unit_price": "40"},
                    {"description": "B", "qty": 1, "unit_price": "60"},
                ])
                self.assertEqual(exclusive.subtotal_amount, Decimal("100"))
                self.assertEqual(exclusive.tax_total, rate)
                self.assertEqual(exclusive.total_amount, gross)
