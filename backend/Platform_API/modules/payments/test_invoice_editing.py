# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
import datetime
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import OrganizationMembership, Tenant, TenantUserProfile
from SL_Sales.models import OrganisationCharge, Product
from SL_Weighbridge.models import Customer, Invoice, InvoiceCharge, InvoiceLine


class InvoiceEditingTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Invoice Editing", code="invoice-editing", status="active", is_active=True)
        self.user = User.objects.create_user("invoice-editor", password="pass")
        self.profile = TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Editing Customer", phone_number="+254700124800")
        self.product = Product.objects.create(tenant=self.tenant, code="EDIT", name="Editing service", product_type="service", unit_price=100, tax_rate=16, is_active=True, is_sales_item=True)
        self.invoice = Invoice.objects.create(tenant=self.tenant, customer=self.customer, status="draft", source_module="manual", subtotal_amount=100, total_amount=116, tax_total=16, notes="Original")
        self.line = InvoiceLine.objects.create(invoice=self.invoice, product=self.product, description="Original item", quantity=1, unit_price=100, tax_rate=16, tax_amount=16, total_amount=100)
        self.url = reverse("invoice-detail", args=[self.invoice.pk])
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def as_member(self, with_change_permission=False):
        self.profile.is_tenant_admin = False
        self.profile.save()
        if with_change_permission:
            self.user.user_permissions.add(Permission.objects.get(content_type__app_label="SL_Weighbridge", codename="change_invoice"))
        self.user = User.objects.get(pk=self.user.pk)
        self.client.force_authenticate(self.user)

    def items(self, **overrides):
        return [{"product_id": self.product.pk, "description": "Revised item", "qty": "2.500", "unit_price": "200.00", "tax_rate": "16.00", **overrides}]

    def test_generated_payment_method_route_and_legacy_alias_both_work(self):
        response = self.client.get("/api/payments/payment-methods/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsInstance(response.data, list)
        self.assertEqual(response.data, self.client.get("/api/payments/methods/").data)

    def test_save_then_open_returns_editable_invoice(self):
        created = self.client.post(reverse("invoice-list"), {"customer_id": self.customer.pk, "line_items": self.items(), "tax_mode": "per_line"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        response = self.client.get(reverse("invoice-detail", args=[created.data["id"]]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["can_edit"])
        self.assertTrue(response.data["can_edit_items"])
        self.assertEqual(response.data["lines"][0]["product"], self.product.pk)

    def test_viewer_cannot_patch_even_if_calling_api_directly(self):
        self.as_member()
        self.assertFalse(self.client.get(self.url).data["can_edit"])
        response = self.client.patch(self.url, {"notes": "Unauthorized"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.notes, "Original")

    def test_explicit_change_permission_allows_edit_and_recalculates_totals(self):
        self.as_member(with_change_permission=True)
        number = self.invoice.invoice_number
        response = self.client.patch(self.url, {"line_items": self.items(), "notes": "Updated", "due_date": "2026-12-01"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], self.invoice.pk)
        self.assertEqual(response.data["invoice_number"], number)
        self.assertEqual(response.data["total_amount"], 580)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.subtotal_amount, Decimal("500.00"))
        self.assertEqual(self.invoice.tax_total, Decimal("80.00"))
        self.assertEqual(self.invoice.notes, "Updated")
        self.assertEqual(self.invoice.lines.get().quantity, Decimal("2.500"))

    def test_permission_from_inactive_role_does_not_allow_editing(self):
        self.as_member(with_change_permission=True)
        viewer = Group.objects.create(name=f"tenant:{self.tenant.pk}:Invoice Viewer")
        self.user.groups.add(viewer)
        OrganizationMembership.objects.create(user=self.user, tenant=self.tenant, active_role_group_name=viewer.name, is_default=True)
        self.assertFalse(self.client.get(self.url).data["can_edit"])
        self.assertEqual(self.client.patch(self.url, {"notes": "Denied"}, format="json").status_code, 403)
        viewer.permissions.add(Permission.objects.get(content_type__app_label="SL_Weighbridge", codename="change_invoice"))
        self.assertEqual(self.client.patch(self.url, {"notes": "Allowed"}, format="json").status_code, 200)

    def test_cross_tenant_invoice_is_not_available_for_editing(self):
        other = Tenant.objects.create(name="Other Edit Tenant", code="other-edit-tenant")
        self.invoice.tenant = other
        self.invoice.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.patch(self.url, {"notes": "Denied"}, format="json").status_code, 404)

    def test_foreign_customer_and_product_are_rejected_without_changing_invoice(self):
        other = Tenant.objects.create(name="Foreign Records", code="foreign-invoice-records")
        customer = Customer.objects.create(tenant=other, name="Foreign", phone_number="+254700124801")
        product = Product.objects.create(tenant=other, code="FOREIGN", name="Foreign", is_active=True, is_sales_item=True)
        for payload in [{"customer_id": customer.pk}, {"line_items": self.items(product_id=product.pk)}]:
            with self.subTest(payload=payload):
                response = self.client.patch(self.url, payload, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertTrue(InvoiceLine.objects.filter(pk=self.line.pk).exists())
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.customer_id, self.customer.pk)

    def test_invalid_numbers_missing_fields_and_status_changes_are_rejected(self):
        for payload in [
            {"line_items": self.items(qty="0")},
            {"line_items": self.items(unit_price="NaN")},
            {"line_items": self.items(tax_rate="-1")},
            {"line_items": self.items(unit_price="9999999999.99")},
            {"line_items": [{"description": "Missing required numbers"}]},
            {"line_items": []},
            {"due_date": "not-a-date"},
            {"status": "paid"},
        ]:
            with self.subTest(payload=payload):
                response = self.client.patch(self.url, payload, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertTrue(InvoiceLine.objects.filter(pk=self.line.pk).exists())
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, Decimal("116.00"))

    def test_combined_tax_and_charge_snapshots_are_preserved_on_edit(self):
        rule = OrganisationCharge.objects.create(tenant=self.tenant, name="Saved levy", rate=2, calculation_type="percentage")
        InvoiceCharge.objects.create(invoice=self.invoice, charge_rule=rule, name="Saved levy", rate=2, calculation_type="percentage", amount=2)
        rule.rate = 90
        rule.save()
        response = self.client.patch(self.url, {"line_items": self.items(), "tax_mode": "combined", "combined_tax_rate": 10, "charge_ids": [rule.pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["subtotal_amount"], 500)
        self.assertEqual(response.data["tax_total"], 50)
        self.assertEqual(response.data["charge_total"], 10)
        self.assertEqual(response.data["total_amount"], 560)
        self.assertEqual(response.data["charges"][0]["charge_rule"], rule.pk)
        self.assertEqual(response.data["charges"][0]["rate"], 2)

    def test_deleted_charge_rule_snapshot_can_be_retained(self):
        snapshot = InvoiceCharge.objects.create(invoice=self.invoice, name="Historical fee", rate=15, calculation_type="fixed", amount=15)
        response = self.client.patch(self.url, {"line_items": self.items(), "charge_ids": [-snapshot.pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["charge_total"], 15)
        self.assertIsNone(response.data["charges"][0]["charge_rule"])

    def test_issued_and_module_invoices_allow_metadata_only(self):
        for status, source in [("issued", "manual"), ("paid", "manual"), ("draft", "weighbridge")]:
            with self.subTest(status=status, source=source):
                self.invoice.status, self.invoice.source_module = status, source
                self.invoice.save()
                self.assertFalse(self.client.get(self.url).data["can_edit_items"])
                response = self.client.patch(self.url, {"line_items": self.items()}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                response = self.client.patch(self.url, {"notes": "Updated details", "due_date": None}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.invoice.refresh_from_db()
                self.assertEqual(self.invoice.total_amount, Decimal("116.00"))
                self.assertTrue(InvoiceLine.objects.filter(pk=self.line.pk).exists())
                self.assertIsNone(self.invoice.due_date)

    def test_write_failure_rolls_back_deleted_lines(self):
        with patch.object(InvoiceLine, "save", side_effect=RuntimeError("Simulated database failure")):
            with self.assertRaises(RuntimeError):
                self.client.patch(self.url, {"line_items": self.items()}, format="json")
        self.assertTrue(InvoiceLine.objects.filter(pk=self.line.pk).exists())
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, Decimal("116.00"))

    def test_fractional_quantities_keep_creation_rounding_when_saved_again(self):
        items = [self.items(qty="0.333", unit_price="0.01")[0]] * 2
        created = self.client.post(reverse("invoice-list"), {"customer_id": self.customer.pk, "line_items": items, "tax_mode": "combined", "combined_tax_rate": 16}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        detail_url = reverse("invoice-detail", args=[created.data["id"]])
        stored = self.client.get(detail_url)
        self.assertEqual(stored.status_code, 200, stored.data)
        response = self.client.patch(detail_url, {"line_items": items}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        for field in ["subtotal_amount", "tax_total", "charge_total", "total_amount"]:
            self.assertEqual(response.data[field], stored.data[field], field)

    def test_new_invoice_accepts_backdated_date_without_changing_creation_time(self):
        response = self.client.post(reverse("invoice-list"), {"customer_id": self.customer.pk, "invoice_date": "2025-04-10", "line_items": self.items()}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        invoice = Invoice.objects.get(pk=response.data["id"])
        self.assertEqual(invoice.invoice_date, datetime.date(2025, 4, 10))
        self.assertEqual(invoice.due_date, datetime.date(2025, 5, 10))
        self.assertNotEqual(invoice.issued_date.date(), invoice.invoice_date)
        self.assertEqual(response.data["invoice_date"], "2025-04-10")

    def test_backdate_edit_does_not_change_created_or_issued_timestamps(self):
        self.invoice.status = "issued"
        from django.utils import timezone
        self.invoice.issued_at = timezone.now()
        self.invoice.save()
        created, issued = self.invoice.issued_date, self.invoice.issued_at
        response = self.client.patch(self.url, {"invoice_date": "2025-03-12"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.invoice_date, datetime.date(2025, 3, 12))
        self.assertEqual(self.invoice.issued_date, created)
        self.assertEqual(self.invoice.issued_at, issued)
        self.assertTrue(InvoiceLine.objects.filter(pk=self.line.pk).exists())
        self.assertEqual(self.invoice.total_amount, Decimal("116.00"))

    def test_invalid_invoice_dates_are_rejected_on_create_and_edit(self):
        count = Invoice.objects.count()
        for value in ["bad-date", "2025-02-30", None, ""]:
            with self.subTest(value=value):
                response = self.client.post(reverse("invoice-list"), {"customer_id": self.customer.pk, "invoice_date": value, "line_items": self.items()}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(Invoice.objects.count(), count)
                response = self.client.patch(self.url, {"invoice_date": value}, format="json")
                self.assertEqual(response.status_code, 400, response.data)

    def test_backdating_still_requires_change_permission(self):
        self.as_member()
        response = self.client.patch(self.url, {"invoice_date": "2025-03-12"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)

    def test_document_preview_returns_html_with_backdated_invoice_date(self):
        self.invoice.invoice_date = datetime.date(2025, 3, 12)
        self.invoice.save()
        response = self.client.get(reverse("invoice-document", args=[self.invoice.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response["Content-Type"])
        self.assertNotIn("Content-Disposition", response)
        self.assertContains(response, "12 Mar 2025")
        self.assertContains(response, self.invoice.invoice_number)
