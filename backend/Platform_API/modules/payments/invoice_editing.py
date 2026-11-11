# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Validated edits of invoice drafts and non-financial invoice details."""
from decimal import Decimal

from django.db.models import Q
from rest_framework import serializers

from Platform_API.modules.mixins import has_active_permission
from SL_Sales.models import OrganisationCharge, Product
from SL_Weighbridge.models import Customer, InvoiceCharge, InvoiceLine
from SL_Weighbridge.invoice_tax import split_inclusive_combined_tax


def can_edit_invoice(user):
    if has_active_permission(user, "SL_Weighbridge.change_invoice"):
        return True
    # Legacy tenant administrators have the same access as organization admins.
    if not user.organization_memberships.filter(is_active=True).exists():
        profile = getattr(user, "tenant_profile", None)
        return bool(profile and profile.is_tenant_admin)
    return False


def can_edit_invoice_items(invoice):
    return (
        invoice.status.lower() == "draft"
        and invoice.source_module == "manual"
        and not invoice.transactions.exists()
        and invoice.issued_at is None
    )


class InvoiceEditLineSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    description = serializers.CharField(max_length=300, allow_blank=True)
    qty = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal("0"), default=Decimal("0"))


INVOICE_DETAIL_FIELDS = {"notes", "due_date", "invoice_date", "billing_address", "billing_contact_name", "billing_email", "billing_phone", "customer_tax_number", "customer_reference"}


class InvoiceBillingDetailsSerializer(serializers.Serializer):
    billing_address = serializers.CharField(required=False, allow_blank=True, max_length=3000)
    billing_contact_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    billing_email = serializers.EmailField(required=False, allow_blank=True, max_length=255)
    billing_phone = serializers.CharField(required=False, allow_blank=True, max_length=50)
    customer_tax_number = serializers.CharField(required=False, allow_blank=True, max_length=80)
    customer_reference = serializers.CharField(required=False, allow_blank=True, max_length=150)


class InvoiceEditSerializer(InvoiceBillingDetailsSerializer):
    customer_id = serializers.IntegerField(required=False, min_value=1)
    currency = serializers.CharField(required=False, max_length=10)
    invoice_date = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    line_items = InvoiceEditLineSerializer(many=True, required=False, allow_empty=False)
    tax_mode = serializers.ChoiceField(choices=["per_line", "combined"], required=False)
    combined_tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal("0"), required=False)
    prices_include_tax = serializers.BooleanField(required=False)
    charge_ids = serializers.ListField(child=serializers.IntegerField(), required=False)

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: "This field cannot be edited." for key in unknown})
        financial_fields = set(attrs) - INVOICE_DETAIL_FIELDS
        if financial_fields and not can_edit_invoice_items(self.instance):
            raise serializers.ValidationError("Only draft manual invoices can have customer, currency, items, tax, or charges changed. You can still update the invoice date, due date, and notes.")
        tax_mode = attrs.get("tax_mode", self.instance.tax_mode)
        prices_include_tax = attrs.get("prices_include_tax", self.instance.prices_include_tax)
        if prices_include_tax and tax_mode != "combined":
            raise serializers.ValidationError({"prices_include_tax": "Tax-inclusive prices require combined invoice tax."})
        if attrs.get("invoice_date") and attrs["invoice_date"] != self.instance.invoice_date and self.instance.status.lower() in {"issued", "paid", "overdue"}:
            from Platform_Core.accounting import assert_posting_allowed
            try:
                assert_posting_allowed(tenant=self.instance.tenant, posting_date=self.instance.invoice_date or self.instance.issued_at or self.instance.issued_date, source_label="invoice date change")
                assert_posting_allowed(tenant=self.instance.tenant, posting_date=attrs["invoice_date"], source_label="invoice date change")
            except ValueError as exc:
                raise serializers.ValidationError({"invoice_date": str(exc)}) from exc
        for index, item in enumerate(attrs.get("line_items", [])):
            missing = {key: "This field is required." for key in ("description", "qty", "unit_price") if key not in item}
            if missing:
                raise serializers.ValidationError({"line_items": {index: missing}})
        if "customer_id" in attrs:
            customer = Customer.objects.filter(pk=attrs["customer_id"]).filter(Q(tenant=self.instance.tenant) | Q(tenant__isnull=True)).first()
            if customer is None:
                raise serializers.ValidationError({"customer_id": "Choose a customer from this organization."})
            attrs["customer"] = customer
        return attrs

    def update(self, invoice, data):
        date_changed = "invoice_date" in data and data["invoice_date"] != invoice.invoice_date
        recalculate = bool(set(data) - INVOICE_DETAIL_FIELDS)
        data.pop("customer_id", None)
        if "customer" in data and data["customer"].pk != invoice.customer_id:
            customer = data["customer"]
            for field, value in {"billing_address": customer.address or "", "billing_email": customer.email or "", "billing_phone": customer.phone_number or "", "billing_contact_name": "", "customer_tax_number": "", "customer_reference": ""}.items():
                data.setdefault(field, value)
        items = data.pop("line_items", None)
        selected_ids = data.pop("charge_ids", None)
        if recalculate:
            existing_lines = list(invoice.lines.all())
            if items is None:
                items = [{"product_id": line.product_id, "description": line.description, "qty": line.quantity, "unit_price": line.unit_price, "tax_rate": line.tax_rate} for line in existing_lines]
            if not items:
                raise serializers.ValidationError({"line_items": "Add at least one line item."})
            tax_mode = data.get("tax_mode", invoice.tax_mode)
            combined_rate = data.get("combined_tax_rate", invoice.combined_tax_rate)
            prices_include_tax = data.get("prices_include_tax", invoice.prices_include_tax)
            old_product_ids = {line.product_id for line in existing_lines if line.product_id}
            product_ids = {item.get("product_id") for item in items if item.get("product_id")}
            products = {product.pk: product for product in Product.objects.filter(tenant=invoice.tenant, pk__in=product_ids).filter(Q(is_active=True, is_sales_item=True) | Q(pk__in=old_product_ids))}
            money_field = serializers.DecimalField(max_digits=12, decimal_places=2)
            line_money_field = serializers.DecimalField(max_digits=10, decimal_places=2)
            subtotal, tax_total = Decimal("0"), Decimal("0")
            new_lines = []
            for item in items:
                product_id = item.get("product_id")
                if product_id and product_id not in products:
                    raise serializers.ValidationError({"line_items": "Choose an active sales product from this organization."})
                product = products.get(product_id)
                raw_amount = item["qty"] * item["unit_price"]
                amount = line_money_field.run_validation(raw_amount.quantize(Decimal("0.01")))
                rate = item.get("tax_rate", Decimal("0")) if tax_mode == "per_line" else Decimal("0")
                tax = money_field.run_validation((raw_amount * rate / Decimal("100")).quantize(Decimal("0.01")))
                # Preserve the same fractional-quantity rounding used at creation.
                subtotal += raw_amount
                tax_total += tax
                new_lines.append(InvoiceLine(invoice=invoice, product=product, description=item["description"] or (product.name if product else "Service"), quantity=item["qty"], unit_price=item["unit_price"], tax_rate=rate, tax_amount=tax, total_amount=amount))
            if tax_mode == "combined":
                tax_total = (subtotal * combined_rate / Decimal("100")).quantize(Decimal("0.01"))
            if prices_include_tax:
                amounts, subtotal, tax_total = split_inclusive_combined_tax(
                    [line.quantity * line.unit_price for line in new_lines], combined_rate
                )
                for line, amount in zip(new_lines, amounts):
                    line.total_amount = line_money_field.run_validation(amount)
            snapshots = {(row.charge_rule_id if row.charge_rule_id is not None else -row.pk): row for row in invoice.charges.all()}
            if selected_ids is None:
                selected_ids = list(snapshots)
            rules = {rule.pk: rule for rule in OrganisationCharge.objects.filter(tenant=invoice.tenant, is_active=True, applies_to__in=["invoice", "both"], pk__in=[pk for pk in selected_ids if pk > 0])}
            new_charges, charge_total = [], Decimal("0")
            for pk in dict.fromkeys(selected_ids):
                row = snapshots.get(pk) or rules.get(pk)
                if row is None:
                    raise serializers.ValidationError({"charge_ids": "Choose an active invoice charge from this organization."})
                amount = (subtotal * row.rate / Decimal("100") if row.calculation_type == "percentage" else row.rate).quantize(Decimal("0.01"))
                charge_total += amount
                new_charges.append(InvoiceCharge(invoice=invoice, charge_rule_id=row.charge_rule_id if pk in snapshots else row.pk, name=row.name, calculation_type=row.calculation_type, rate=row.rate, amount=money_field.run_validation(amount)))
            invoice.subtotal_amount = money_field.run_validation(subtotal.quantize(Decimal("0.01")))
            invoice.tax_total = money_field.run_validation(tax_total)
            invoice.charge_total = money_field.run_validation(charge_total)
            invoice.total_amount = money_field.run_validation((subtotal + tax_total + charge_total).quantize(Decimal("0.01")))
            invoice.combined_tax_rate = combined_rate if tax_mode == "combined" else Decimal("0")
            if tax_mode == "combined" and not invoice.combined_tax_name:
                from Platform_Core.models import TenantSettings
                settings = TenantSettings.objects.filter(tenant=invoice.tenant).first()
                invoice.combined_tax_name = settings.default_tax_name if settings else "Tax"
            elif tax_mode != "combined":
                invoice.combined_tax_name = ""
            # All validation completes before replacing any stored invoice rows.
            invoice.lines.all().delete()
            invoice.charges.all().delete()
            for line in new_lines:
                line.save()
            for charge in new_charges:
                charge.save()
        for field, value in data.items():
            if field != "combined_tax_rate":
                setattr(invoice, field, value)
        invoice.save()
        if date_changed and invoice.status.lower() in {"issued", "paid", "overdue"}:
            from Platform_Core.accounting import sync_invoice_posting
            try:
                sync_invoice_posting(invoice)
            except ValueError as exc:
                raise serializers.ValidationError({"invoice_date": str(exc)}) from exc
        return invoice
