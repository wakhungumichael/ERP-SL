"""
Sales module API views.

Covers:
  - Products & Services catalog (tenant-scoped)
  - Estimates (quotes) with line items
  - Recurring invoices
  - Customer statements
  - Customer list proxy (for dropdowns)

All views use the same _apply_tenant_filter pattern as the weighbridge module
to ensure strict tenant isolation.
"""
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle

from Platform_Core.documents import (
    _money,
    _safe_logo_url,
    render_business_document,
    render_estimate_document,
    resolve_document_template,
)
from Platform_Core.email import get_tenant_smtp_connection
from Platform_Core.models import TenantSettings
from Platform_Core.platform import get_active_tenant_module_slugs
from Platform_API.modules.mixins import (
    apply_tenant_filter as _apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403,
)
from Platform_API.modules.payments.views import reconcile_invoice_payment_state
from SL_Sales.models import (
    Product, Estimate, EstimateLineItem,
    RecurringInvoice, RecurringInvoiceLineItem,
    SalesOrder, SalesOrderLineItem,
)
from SL_Inventory.services import sync_sales_order_inventory
from SL_Weighbridge.models import Customer, Invoice, Transaction

try:
    from xhtml2pdf import pisa
except Exception:
    pisa = None

def _tenant_or_400(user):
    """Return the tenant for non-superusers; raise 403 for profileless users."""
    return tenant_or_403(user, "No organization linked to this account.")


def _is_customer_admin(user):
    if user.is_superuser:
        return True
    try:
        if user.tenant_profile.is_tenant_admin:
            return True
    except Exception:
        pass
    return user.organization_memberships.filter(is_active=True, is_org_admin=True).exists()


def _require_sales_customer_permission(user, action):
    if _is_customer_admin(user) or user.has_perm(f"SL_Sales.{action}_salescustomer"):
        return
    raise PermissionDenied("You do not have permission to perform this Sales customer action.")


def _can_view_customer_statements(user):
    if _is_customer_admin(user) or user.has_perm("SL_Sales.can_view_customer_statements"):
        return True
    return False


def _get_tenant_default_tax_rate(tenant):
    if tenant is None:
        return Decimal("0.00")
    try:
        settings_obj = TenantSettings.objects.only("default_tax_rate").get(tenant=tenant)
        return settings_obj.default_tax_rate if settings_obj.default_tax_rate is not None else Decimal("0.00")
    except TenantSettings.DoesNotExist:
        return Decimal("0.00")


def _apply_default_tax_to_lines(lines_data, tenant):
    default_tax_rate = _get_tenant_default_tax_rate(tenant)
    normalized_lines = []
    for line_data in lines_data:
        line_copy = dict(line_data)
        if "tax_rate" not in line_copy or line_copy.get("tax_rate") in (None, ""):
            line_copy["tax_rate"] = default_tax_rate
        normalized_lines.append(line_copy)
    return normalized_lines


def _resolve_invoice_customer(*, tenant, customer=None, customer_name=""):
    if customer is not None:
        return customer

    normalized_name = (customer_name or "").strip()
    if not normalized_name:
        return None

    existing = Customer.objects.filter(tenant=tenant, name__iexact=normalized_name).order_by("id").first()
    if existing is not None:
        return existing

    stamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
    synthetic_phone = f"AUTO{stamp}"[:20]
    return Customer.objects.create(
        tenant=tenant,
        name=normalized_name,
        phone_number=synthetic_phone,
    )


def _invoice_line_payload(*, description, quantity, unit_price, line_total, product_name=""):
    normalized_description = (description or product_name or "Sales item").strip()
    qty_decimal = Decimal(str(quantity or 0))
    unit_price_decimal = Decimal(str(unit_price or 0))
    line_total_decimal = Decimal(str(line_total or 0))

    if qty_decimal > 0 and qty_decimal == qty_decimal.to_integral_value():
        return {
            "description": normalized_description,
            "quantity": int(qty_decimal),
            "unit_price": unit_price_decimal,
            "total_amount": line_total_decimal,
        }

    effective_description = (
        f"{normalized_description} (Qty {qty_decimal.normalize()} @ {unit_price_decimal.normalize()})"
    )
    return {
        "description": effective_description,
        "quantity": 1,
        "unit_price": line_total_decimal,
        "total_amount": line_total_decimal,
    }


def _pdf_link_callback(uri, _rel):
    parsed = urlparse(uri)
    path = parsed.path or uri

    media_url = str(settings.MEDIA_URL or "")
    static_url = str(settings.STATIC_URL or "")
    if media_url and path.startswith(media_url):
        return str(Path(settings.MEDIA_ROOT) / path.removeprefix(media_url))
    if static_url and path.startswith(static_url):
        return str(Path(settings.STATIC_ROOT) / path.removeprefix(static_url))
    if Path(path).exists():
        return path
    return uri


def _html_to_pdf_response(*, html, filename):
    if pisa is None:
        return HttpResponse("PDF generation backend is unavailable.", status=500)

    response = HttpResponse(content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{filename}"'
    pdf_result = pisa.CreatePDF(html, dest=response, link_callback=_pdf_link_callback)
    if pdf_result.err:
        return HttpResponse("Failed to generate PDF document.", status=500)
    return response


def _hex_color(value, fallback="#E85D26"):
    try:
        return colors.HexColor(value or fallback)
    except Exception:
        return colors.HexColor(fallback)


def _statement_pdf_response(*, payload, customer_id, request, tenant):
    _, settings_obj = resolve_document_template(tenant=tenant, document_type="statement")
    branding = payload.get("branding") or {}
    company = payload.get("company") or {}
    customer = payload.get("customer") or {}
    summary = payload.get("summary") or {}
    invoices = payload.get("invoices") or []
    currency = company.get("currency") or getattr(tenant, "default_currency", "KES") or "KES"

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    left = 50
    right = page_width - 50
    y = page_height - 50
    brand_color = _hex_color(branding.get("primary_color"))
    header_center_x = page_width / 2

    logo_path = _pdf_link_callback(_safe_logo_url(settings_obj, request), None)
    if logo_path and Path(logo_path).exists():
        try:
            logo = ImageReader(logo_path)
            original_width, original_height = logo.getSize()
            logo_width = 1.65 * inch
            logo_height = original_height * (logo_width / max(original_width, 1))
            pdf.drawImage(
                logo,
                header_center_x - (logo_width / 2),
                y - logo_height,
                width=logo_width,
                height=logo_height,
                mask="auto",
            )
            y -= logo_height + 10
        except Exception:
            y -= 6
    else:
        y -= 6

    pdf.setFillColor(brand_color)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawCentredString(header_center_x, y, company.get("name") or "SL-ERP")
    pdf.setFont("Helvetica", 10)
    if company.get("email"):
        pdf.drawCentredString(header_center_x, y - 16, company["email"])
    if company.get("phone"):
        pdf.drawCentredString(header_center_x, y - 30, company["phone"])
    pdf.setFillColor(colors.black)
    pdf.setFont("Helvetica-Bold", 15)
    pdf.drawCentredString(header_center_x, y - 50, "Customer Statement")
    pdf.setFont("Helvetica", 10)
    pdf.drawCentredString(header_center_x, y - 66, f"Statement No: STM-{customer_id:04d}")
    pdf.drawCentredString(header_center_x, y - 80, f"Printed {timezone.now().strftime('%d %b %Y')}")

    y -= 105
    pdf.setStrokeColor(brand_color)
    pdf.setLineWidth(2)
    pdf.line(left, y, right, y)
    y -= 20

    section_header_color = colors.HexColor("#284B63")
    section_fill = colors.HexColor("#EEF3F8")

    statement_period = "{} - {}".format(
        request.query_params.get("date_from") or "Opening",
        request.query_params.get("date_to") or timezone.now().date().isoformat(),
    )
    payment_instructions = payload.get("payment_instructions") or {}
    activity_summary = payload.get("activity_summary") or {}
    aging = payload.get("aging") or {}
    recent_payments = payload.get("recent_payments") or []

    customer_info_title = Table([["Customer Information", "Account Summary"]], colWidths=[255, 255])
    customer_info_title.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), section_header_color),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    customer_info_title.wrapOn(pdf, right - left, y)
    customer_info_title.drawOn(pdf, left, y - customer_info_title._height)
    y -= customer_info_title._height

    customer_info = Table([
        ["Customer Code", customer.get("code") or "—", "Opening Balance", _money(summary.get("opening_balance", 0), currency)],
        ["Customer Name", customer.get("name") or "—", "Sales During Period", _money(summary.get("sales_during_period", 0), currency)],
        ["Contact Person", customer.get("contact_person") or "—", "Payments Received", _money(summary.get("payments_received", 0), currency)],
        ["Email", customer.get("email") or "—", "Closing Balance", _money(summary.get("closing_balance", 0), currency)],
        ["Phone", customer.get("phone") or "—", "Amount Overdue", _money(summary.get("amount_overdue", 0), currency)],
        ["Payment Terms", customer.get("payment_terms") or "—", "Statement Period", statement_period],
        ["Tax PIN", customer.get("tax_pin") or "—", "Currency", currency],
        ["Address", customer.get("address") or "—", "Invoices Covered", str(summary.get("invoice_count", 0))],
    ], colWidths=[90, 165, 100, 155])
    customer_info.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, section_fill]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DCE5")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (3, 3), (3, 3), colors.HexColor("#D9EAD3")),
        ("FONTNAME", (3, 3), (3, 3), "Helvetica-Bold"),
    ]))
    customer_info.wrapOn(pdf, right - left, y)
    customer_info.drawOn(pdf, left, y - customer_info._height)
    y -= customer_info._height + 14

    aging_title = Table([["Aging Analysis"]], colWidths=[right - left])
    aging_title.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), section_header_color),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    aging_title.wrapOn(pdf, right - left, y)
    aging_title.drawOn(pdf, left, y - aging_title._height)
    y -= aging_title._height

    aging_table = Table([
        ["Current", "1-30 Days", "31-60 Days", "61-90 Days", "Over 90 Days", "Total"],
        [
            _money(aging.get("current", 0), currency),
            _money(aging.get("days_1_30", 0), currency),
            _money(aging.get("days_31_60", 0), currency),
            _money(aging.get("days_61_90", 0), currency),
            _money(aging.get("days_90_plus", 0), currency),
            _money(aging.get("total", 0), currency),
        ],
    ], colWidths=[85, 85, 85, 85, 85, 85])
    aging_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DCE5")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("BACKGROUND", (0, 1), (-1, 1), section_fill),
    ]))
    aging_table.wrapOn(pdf, right - left, y)
    aging_table.drawOn(pdf, left, y - aging_table._height)
    y -= aging_table._height + 14

    transactions_title = Table([["Outstanding Transactions"]], colWidths=[right - left])
    transactions_title.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), section_header_color),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    transactions_title.wrapOn(pdf, right - left, y)
    transactions_title.drawOn(pdf, left, y - transactions_title._height)
    y -= transactions_title._height

    outstanding_invoices = [
        invoice for invoice in invoices
        if float(invoice.get("balance_amount", 0) or 0) > 0
    ]

    table_rows = [["Invoice", "Date", "Due Date", "Reference", "Description", "Amount", "Paid", "Balance", "Status"]]
    for invoice in outstanding_invoices:
        paid_amount = float(invoice.get("paid_amount", 0) or 0)
        balance_amount = float(invoice.get("balance_amount", 0) or 0)
        tx = (invoice.get("transaction_highlights") or [{}])[0]
        status_badge = invoice.get("status_badge") or str(invoice.get("status", "")).title()
        table_rows.append([
            invoice.get("invoice_number", ""),
            invoice.get("invoice_date", ""),
            invoice.get("due_date", "") or "—",
            tx.get("transaction_number", "") or "—",
            f"{tx.get('vehicle_plate', '')} @ {tx.get('net_weight_display', '')}".strip(" @") or "—",
            _money(invoice.get("total", 0), currency),
            _money(paid_amount, currency),
            _money(balance_amount, currency),
            status_badge,
        ])
    if len(table_rows) == 1:
        table_rows.append(["No outstanding invoices", "", "", "", "", "", "", "", ""])

    table = Table(table_rows, colWidths=[66, 48, 54, 58, 108, 48, 46, 48, 58], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DCE5")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, section_fill]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (5, 1), (7, -1), "RIGHT"),
    ]))
    table.wrapOn(pdf, right - left, y)
    table_height = min(table._height, y - 80)
    table.drawOn(pdf, left, y - table_height)
    y -= table._height + 24

    if y < 260:
        pdf.showPage()
        y = page_height - 60

    payments_title = Table([["Recent Payments", "Account Activity Summary"]], colWidths=[300, 240])
    payments_title.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), section_header_color),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    payments_title.wrapOn(pdf, right - left, y)
    payments_title.drawOn(pdf, left, y - payments_title._height)
    y -= payments_title._height

    recent_payment_rows = [["Receipt No", "Date", "Method", "Reference", "Amount"]]
    if recent_payments:
        for payment in recent_payments[:5]:
            recent_payment_rows.append([
                payment.get("receipt_number", ""),
                payment.get("date", ""),
                payment.get("payment_method", ""),
                payment.get("reference", ""),
                _money(payment.get("amount", 0), currency),
            ])
    else:
        recent_payment_rows.append(["No recent payments", "", "", "", ""])
    recent_payment_table = Table(recent_payment_rows, colWidths=[62, 48, 54, 80, 56])
    recent_payment_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DCE5")),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, section_fill]),
        ("ALIGN", (4, 1), (4, -1), "RIGHT"),
    ]))
    recent_payment_table.wrapOn(pdf, 300, y)
    recent_payment_table.drawOn(pdf, left, y - recent_payment_table._height)

    activity_table = Table([
        ["Total Invoices", str(activity_summary.get("total_invoices", 0))],
        ["Paid Invoices", str(activity_summary.get("paid_invoices", 0))],
        ["Outstanding Invoices", str(activity_summary.get("outstanding_invoices", 0))],
        ["Total Payments", _money(activity_summary.get("total_payments", 0), currency)],
        ["Last Payment", activity_summary.get("last_payment") or "—"],
        ["Last Invoice", activity_summary.get("last_invoice") or "—"],
    ], colWidths=[105, 135])
    activity_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, section_fill]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DCE5")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
    ]))
    activity_table.wrapOn(pdf, 240, y)
    activity_table.drawOn(pdf, left + 300, y - activity_table._height)
    y -= max(recent_payment_table._height, activity_table._height) + 16

    instructions_title = Table([["Payment Instructions"]], colWidths=[right - left])
    instructions_title.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), section_header_color),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    instructions_title.wrapOn(pdf, right - left, y)
    instructions_title.drawOn(pdf, left, y - instructions_title._height)
    y -= instructions_title._height

    notes_table = Table([
        ["Bank", payment_instructions.get("bank") or "—", "Account Name", payment_instructions.get("account_name") or "—"],
        ["Account Number", payment_instructions.get("account_number") or "—", "Branch", payment_instructions.get("branch") or "—"],
        ["Paybill", payment_instructions.get("paybill") or "—", "Reference", payment_instructions.get("reference") or "—"],
        ["Contact Email", payment_instructions.get("contact_email") or "—", "Contact Phone", payment_instructions.get("contact_phone") or "—"],
    ], colWidths=[95, 175, 100, 170])
    notes_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, section_fill]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DCE5")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
    ]))
    if y < 120:
        pdf.showPage()
        y = page_height - 60
    notes_table.wrapOn(pdf, right - left, y)
    notes_table.drawOn(pdf, left, y - notes_table._height)

    footer_text = branding.get("footer_text") or "Generated by SL-ERP"
    pdf.setFont("Helvetica", 9)
    pdf.setFillColor(colors.HexColor("#64748B"))
    pdf.drawString(left, 28, footer_text[:110])
    pdf.drawRightString(right, 28, f"Printed {timezone.now().strftime('%d %b %Y %H:%M')}")

    pdf.showPage()
    pdf.save()
    pdf_bytes = buffer.getvalue()
    buffer.close()

    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="customer_statement_{customer_id}.pdf"'
    return response


# ── Serializers ───────────────────────────────────────────────────────────────

class ProductSerializer(serializers.ModelSerializer):
    source = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "tenant", "code", "name", "description",
            "product_type", "unit", "unit_price", "tax_rate", "is_active",
            "is_sales_item", "is_purchase_item", "is_stock_item", "is_service",
            "income_account", "expense_account",
            "source",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "tenant", "created_at", "updated_at"]

    def get_source(self, obj):
        code = (obj.code or "").upper()
        if code.startswith("WB-"):
            return "weighbridge"
        return "manual"


class SalesCustomerSerializer(serializers.ModelSerializer):
    transaction_count = serializers.SerializerMethodField()
    invoice_count = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            "id", "tenant", "name", "address", "phone_number", "email",
            "transaction_count", "invoice_count",
        ]
        read_only_fields = ["id", "tenant", "transaction_count", "invoice_count"]

    def get_transaction_count(self, obj):
        tenant = getattr(obj, "tenant", None)
        qs = Transaction.objects.filter(customer=obj)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        return qs.count()

    def get_invoice_count(self, obj):
        tenant = getattr(obj, "tenant", None)
        qs = Invoice.objects.filter(customer=obj)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        return qs.count()


class EstimateLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = EstimateLineItem
        fields = [
            "id", "product", "description", "quantity",
            "unit_price", "tax_rate", "discount_amount", "line_total", "sort_order",
        ]
        read_only_fields = ["id", "line_total"]


class EstimateSerializer(serializers.ModelSerializer):
    line_items   = EstimateLineItemSerializer(many=True, read_only=True)
    customer_display = serializers.SerializerMethodField()

    class Meta:
        model = Estimate
        fields = [
            "id", "tenant", "branch", "customer", "customer_name", "customer_display",
            "estimate_number", "issue_date", "expiry_date", "status",
            "subtotal", "discount_total", "tax_total", "total",
            "notes", "terms", "converted_to_invoice", "converted_to_sales_order",
            "line_items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "estimate_number",
            "subtotal", "tax_total", "total",
            "converted_to_invoice", "converted_to_sales_order", "created_at", "updated_at",
        ]

    def get_customer_display(self, obj):
        if obj.customer:
            return obj.customer.name
        return obj.customer_name


class EstimateWriteSerializer(serializers.ModelSerializer):
    line_items = EstimateLineItemSerializer(many=True, required=False)

    class Meta:
        model = Estimate
        fields = [
            "branch", "customer", "customer_name",
            "issue_date", "expiry_date", "status",
            "discount_total", "notes", "terms",
            "line_items",
        ]

    def _resolve_customer_fields(self, validated_data):
        customer = validated_data.get("customer")
        customer_name = (validated_data.get("customer_name") or "").strip()
        tenant = validated_data.get("tenant") or getattr(self.instance, "tenant", None)

        if customer is not None:
            validated_data["customer_name"] = customer.name
            return validated_data

        if customer_name and tenant is not None:
            resolved_customer = _resolve_invoice_customer(
                tenant=tenant,
                customer=None,
                customer_name=customer_name,
            )
            validated_data["customer"] = resolved_customer
            validated_data["customer_name"] = resolved_customer.name
        return validated_data

    def create(self, validated_data):
        lines_data = validated_data.pop("line_items", [])
        validated_data = self._resolve_customer_fields(validated_data)
        estimate = Estimate.objects.create(**validated_data)
        for line_data in _apply_default_tax_to_lines(lines_data, estimate.tenant):
            EstimateLineItem.objects.create(estimate=estimate, **line_data)
        estimate.recalculate()
        return estimate

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("line_items", None)
        validated_data = self._resolve_customer_fields(validated_data)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            instance.line_items.all().delete()
            for line_data in _apply_default_tax_to_lines(lines_data, instance.tenant):
                EstimateLineItem.objects.create(estimate=instance, **line_data)
        instance.recalculate()
        return instance


class SalesOrderLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesOrderLineItem
        fields = [
            "id", "product", "description", "quantity",
            "unit_price", "tax_rate", "discount_amount", "line_total", "sort_order",
        ]
        read_only_fields = ["id", "line_total"]


class SalesOrderSerializer(serializers.ModelSerializer):
    line_items = SalesOrderLineItemSerializer(many=True, read_only=True)
    customer_display = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            "id", "tenant", "branch", "customer", "customer_name", "customer_display",
            "estimate", "order_number", "order_date", "expected_delivery_date",
            "status", "subtotal", "discount_total", "tax_total", "total",
            "notes", "terms", "converted_to_invoice", "line_items",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "order_number", "subtotal", "tax_total", "total",
            "converted_to_invoice", "created_at", "updated_at",
        ]

    def get_customer_display(self, obj):
        return obj.customer.name if obj.customer else obj.customer_name


class SalesOrderWriteSerializer(serializers.ModelSerializer):
    line_items = SalesOrderLineItemSerializer(many=True, required=False)

    class Meta:
        model = SalesOrder
        fields = [
            "branch", "customer", "customer_name", "estimate",
            "order_date", "expected_delivery_date", "status",
            "discount_total", "notes", "terms", "line_items",
        ]

    def _sync_lines(self, instance, lines_data):
        instance.line_items.all().delete()
        for line_data in _apply_default_tax_to_lines(lines_data, instance.tenant):
            SalesOrderLineItem.objects.create(sales_order=instance, **line_data)
        instance.recalculate()

    def create(self, validated_data):
        lines_data = validated_data.pop("line_items", [])
        instance = SalesOrder.objects.create(**validated_data)
        self._sync_lines(instance, lines_data)
        return instance

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("line_items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


class RecurringInvoiceLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringInvoiceLineItem
        fields = [
            "id", "product", "description", "quantity",
            "unit_price", "tax_rate", "line_total", "sort_order",
        ]
        read_only_fields = ["id", "line_total"]


class RecurringInvoiceSerializer(serializers.ModelSerializer):
    line_items = RecurringInvoiceLineItemSerializer(many=True, read_only=True)
    customer_display = serializers.SerializerMethodField()

    class Meta:
        model = RecurringInvoice
        fields = [
            "id", "tenant", "branch", "customer", "customer_name", "customer_display",
            "frequency", "status", "start_date", "end_date",
            "next_invoice_date", "last_generated_at",
            "subtotal", "tax_total", "total", "notes",
            "line_items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "subtotal", "tax_total", "total",
            "last_generated_at", "created_at", "updated_at",
        ]

    def get_customer_display(self, obj):
        if obj.customer:
            return obj.customer.name
        return obj.customer_name


class RecurringInvoiceWriteSerializer(serializers.ModelSerializer):
    line_items = RecurringInvoiceLineItemSerializer(many=True, required=False)

    class Meta:
        model = RecurringInvoice
        fields = [
            "branch", "customer", "customer_name",
            "frequency", "status", "start_date", "end_date", "next_invoice_date",
            "notes", "line_items",
        ]

    def _sync_lines(self, instance, lines_data):
        instance.line_items.all().delete()
        for line_data in _apply_default_tax_to_lines(lines_data, instance.tenant):
            RecurringInvoiceLineItem.objects.create(recurring_invoice=instance, **line_data)
        lines = instance.line_items.all()
        instance.subtotal = sum(li.line_total for li in lines)
        instance.tax_total = sum(li.line_total * (li.tax_rate / 100) for li in lines)
        instance.total = instance.subtotal + instance.tax_total
        instance.save(update_fields=["subtotal", "tax_total", "total", "updated_at"])

    def create(self, validated_data):
        lines_data = validated_data.pop("line_items", [])
        instance = RecurringInvoice.objects.create(**validated_data)
        self._sync_lines(instance, lines_data)
        return instance

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("line_items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


# ── Products & Services ───────────────────────────────────────────────────────

class ProductListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/sales/products/          — list tenant products
    POST /api/sales/products/          — create product
    Query params: product_type, is_active, search
    """
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tenant = _tenant_or_400(self.request.user)
        qs = _apply_tenant_filter(
            Product.objects.select_related("income_account", "expense_account"),
            self.request.user,
        ).order_by("name")
        if tenant is not None:
            active_modules = get_active_tenant_module_slugs(tenant)
            if not {"weighbridge", "commercial-weighbridge"}.intersection(active_modules):
                qs = qs.exclude(code__istartswith="WB-")
        p = self.request.query_params
        if pt := p.get("product_type"):
            qs = qs.filter(product_type=pt)
        if (ia := p.get("is_active")) is not None:
            qs = qs.filter(is_active=(ia.lower() == "true"))
        if q := p.get("search"):
            qs = qs.filter(name__icontains=q)
        return qs

    def perform_create(self, serializer):
        tenant = _tenant_or_400(self.request.user)
        extra = {"tenant": tenant}
        if "tax_rate" not in serializer.validated_data:
            extra["tax_rate"] = _get_tenant_default_tax_rate(tenant)
        product_type = serializer.validated_data.get("product_type", "service")
        if "is_service" not in serializer.validated_data:
            extra["is_service"] = product_type == "service"
        if "is_stock_item" not in serializer.validated_data:
            extra["is_stock_item"] = product_type == "product"
        if "is_sales_item" not in serializer.validated_data:
            extra["is_sales_item"] = True
        if "is_purchase_item" not in serializer.validated_data:
            extra["is_purchase_item"] = product_type == "product"
        serializer.save(**extra)


class ProductDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET / PATCH / DELETE /api/sales/products/<pk>/"""
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return _apply_tenant_filter(Product.objects.all(), self.request.user)


# ── Estimates ─────────────────────────────────────────────────────────────────

class EstimateListCreateView(APIView):
    """
    GET  /api/sales/estimates/   — list with filters: status, customer_id, date_from, date_to
    POST /api/sales/estimates/   — create with line_items
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"),
            request.user,
        ).order_by("-created_at")
        p = request.query_params
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if cid := p.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if df := p.get("date_from"):
            qs = qs.filter(issue_date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(issue_date__lte=dt)
        return Response(EstimateSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_400(request.user)
        ser = EstimateWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant, created_by=request.user)
        return Response(EstimateSerializer(obj).data, status=status.HTTP_201_CREATED)


class EstimateDetailView(APIView):
    """GET / PATCH / DELETE /api/sales/estimates/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"), user,
        )
        try:
            return qs.get(pk=pk)
        except Estimate.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(EstimateSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = EstimateWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        updated = ser.save()
        return Response(EstimateSerializer(updated).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EstimateDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        obj = EstimateDetailView()._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        rendered = render_estimate_document(obj, request=request)
        response = HttpResponse(rendered.html, content_type="text/html; charset=utf-8")
        if request.query_params.get("download") in {"1", "true", "yes"}:
            response["Content-Disposition"] = f'attachment; filename="{obj.estimate_number}.html"'
        return response


class EstimateEmailSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    subject = serializers.CharField(required=False, allow_blank=True, max_length=255)
    message = serializers.CharField(required=False, allow_blank=True)


class EstimateEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        obj = EstimateDetailView()._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = EstimateEmailSerializer(data=request.data or {})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        rendered = render_estimate_document(obj, request=request)
        settings_obj = rendered.settings
        recipient = (serializer.validated_data.get("email") or "").strip()
        if not recipient and obj.customer:
            recipient = (obj.customer.email or "").strip()
        if not recipient:
            return Response(
                {"error": "No recipient email available. Provide one or update the customer record."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not settings_obj or not settings_obj.smtp_host or not settings_obj.smtp_user:
            return Response(
                {"error": "Tenant SMTP settings are not configured for sending estimate emails."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tenant = getattr(obj, "tenant", None)
        company_name = getattr(tenant, "name", "Your Company")
        subject = (
            serializer.validated_data.get("subject")
            or f"Estimate {obj.estimate_number} from {company_name}"
        )
        plain_message = serializer.validated_data.get("message") or (
            f"Hello,\n\nPlease find estimate {obj.estimate_number} attached/linked below.\n"
            f"Total: {_money(obj.total, getattr(tenant, 'default_currency', 'KES'))}\n\n"
            f"Regards,\n{company_name}"
        )

        connection = get_tenant_smtp_connection(settings_obj)
        email = EmailMultiAlternatives(
            subject=subject,
            body=plain_message,
            from_email=settings_obj.support_email or settings_obj.smtp_user,
            to=[recipient],
            connection=connection,
        )
        custom_message = (serializer.validated_data.get("message") or "").strip()
        html_note = f"<div style='margin-bottom:16px;white-space:pre-wrap'>{custom_message}</div>" if custom_message else ""
        email.attach_alternative(
            f"{html_note}{rendered.html}",
            "text/html",
        )
        email.attach(
            f"{obj.estimate_number}.html",
            rendered.html,
            "text/html",
        )
        email.send()

        return Response(
            {
                "message": f"Estimate emailed to {recipient}.",
                "recipient": recipient,
                "estimate_id": obj.pk,
            },
            status=status.HTTP_200_OK,
        )


class EstimateConvertView(APIView):
    """
    POST /api/sales/estimates/<pk>/convert/
    Converts an accepted estimate into a draft invoice.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"), request.user,
        )
        try:
            estimate = qs.get(pk=pk)
        except Estimate.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if estimate.converted_to_invoice_id:
            return Response(
                {"error": "Already converted.", "invoice_id": estimate.converted_to_invoice_id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Import Invoice model from Weighbridge
        try:
            from SL_Weighbridge.models import Invoice
        except ImportError:
            return Response(
                {"error": "Invoice model unavailable."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Build a draft invoice
        invoice_customer = _resolve_invoice_customer(
            tenant=estimate.tenant,
            customer=estimate.customer,
            customer_name=estimate.customer_name,
        )
        if invoice_customer is None:
            return Response(
                {"error": "Estimate must have a customer before it can be invoiced."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice = Invoice.objects.create(
            tenant=estimate.tenant,
            customer=invoice_customer,
            status="draft",
            notes=estimate.notes,
            total_amount=estimate.total,
            source_module="manual",
            source_id=estimate.pk,
        )
        try:
            from SL_Weighbridge.models import InvoiceLine
        except ImportError:
            return Response(
                {"error": "Invoice line model unavailable."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        for line in estimate.line_items.all():
            InvoiceLine.objects.create(
                invoice=invoice,
                **_invoice_line_payload(
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    line_total=line.line_total,
                    product_name=getattr(line.product, "name", ""),
                ),
            )

        estimate.converted_to_invoice = invoice
        estimate.status = "accepted"
        estimate.save(update_fields=["converted_to_invoice", "status", "updated_at"])

        return Response({
            "message": "Estimate converted to invoice.",
            "invoice_id": invoice.pk,
            "estimate_id": estimate.pk,
        }, status=status.HTTP_201_CREATED)


class EstimateConvertToSalesOrderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        qs = _apply_tenant_filter(
            Estimate.objects.prefetch_related("line_items"),
            request.user,
        )
        try:
            estimate = qs.get(pk=pk)
        except Estimate.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if estimate.converted_to_sales_order_id:
            return Response(
                {"error": "Already converted.", "sales_order_id": estimate.converted_to_sales_order_id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        order = SalesOrder.objects.create(
            tenant=estimate.tenant,
            branch=estimate.branch,
            customer=estimate.customer,
            customer_name=estimate.customer_name,
            estimate=estimate,
            order_date=estimate.issue_date,
            expected_delivery_date=estimate.expiry_date,
            status="confirmed",
            discount_total=estimate.discount_total,
            notes=estimate.notes,
            terms=estimate.terms,
            created_by=request.user,
        )
        for line in estimate.line_items.all():
            SalesOrderLineItem.objects.create(
                sales_order=order,
                product=line.product,
                description=line.description,
                quantity=line.quantity,
                unit_price=line.unit_price,
                tax_rate=line.tax_rate,
                discount_amount=line.discount_amount,
                sort_order=line.sort_order,
            )
        order.recalculate()
        sync_sales_order_inventory(order, actor=request.user)
        estimate.converted_to_sales_order = order
        estimate.status = "accepted"
        estimate.save(update_fields=["converted_to_sales_order", "status", "updated_at"])

        return Response({
            "message": "Estimate converted to sales order.",
            "sales_order_id": order.pk,
            "estimate_id": estimate.pk,
        }, status=status.HTTP_201_CREATED)


class SalesOrderListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            SalesOrder.objects.prefetch_related("line_items"),
            request.user,
        ).order_by("-created_at")
        p = request.query_params
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if cid := p.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if df := p.get("date_from"):
            qs = qs.filter(order_date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(order_date__lte=dt)
        if q := p.get("search"):
            qs = qs.filter(
                Q(order_number__icontains=q) |
                Q(customer_name__icontains=q) |
                Q(customer__name__icontains=q) |
                Q(notes__icontains=q)
            )

        try:
            page = max(int(p.get("page", 1)), 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(max(int(p.get("page_size", 10)), 1), 100)
        except (TypeError, ValueError):
            page_size = 10

        total = qs.count()
        total_pages = max((total + page_size - 1) // page_size, 1)
        if page > total_pages:
            page = total_pages
        start = (page - 1) * page_size
        end = start + page_size
        results = SalesOrderSerializer(qs[start:end], many=True).data
        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "results": results,
            "previous": page - 1 if page > 1 else None,
            "next": page + 1 if page < total_pages else None,
        })

    def post(self, request):
        tenant = _tenant_or_400(request.user)
        ser = SalesOrderWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant, created_by=request.user)
        sync_sales_order_inventory(obj, actor=request.user)
        obj.refresh_from_db()
        return Response(SalesOrderSerializer(obj).data, status=status.HTTP_201_CREATED)


class SalesOrderDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(SalesOrder.objects.prefetch_related("line_items"), user)
        try:
            return qs.get(pk=pk)
        except SalesOrder.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(SalesOrderSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = SalesOrderWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        updated = ser.save()
        sync_sales_order_inventory(updated, actor=request.user)
        return Response(SalesOrderSerializer(updated).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SalesOrderConvertToInvoiceView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        qs = _apply_tenant_filter(
            SalesOrder.objects.prefetch_related("line_items"),
            request.user,
        )
        try:
            order = qs.get(pk=pk)
        except SalesOrder.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if order.converted_to_invoice_id:
            return Response(
                {"error": "Already invoiced.", "invoice_id": order.converted_to_invoice_id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from SL_Weighbridge.models import Invoice, InvoiceLine
        except ImportError:
            return Response({"error": "Invoice model unavailable."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        invoice_customer = _resolve_invoice_customer(
            tenant=order.tenant,
            customer=order.customer,
            customer_name=order.customer_name,
        )
        if invoice_customer is None:
            return Response(
                {"error": "Sales order must have a customer before it can be invoiced."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice = Invoice.objects.create(
            tenant=order.tenant,
            customer=invoice_customer,
            status="draft",
            notes=order.notes,
            total_amount=order.total,
            source_module="manual",
            source_id=order.pk,
        )
        for line in order.line_items.all():
            InvoiceLine.objects.create(
                invoice=invoice,
                **_invoice_line_payload(
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    line_total=line.line_total,
                    product_name=getattr(line.product, "name", ""),
                ),
            )
        order.converted_to_invoice = invoice
        order.status = "invoiced"
        order.save(update_fields=["converted_to_invoice", "status", "updated_at"])
        sync_sales_order_inventory(order, actor=request.user)
        return Response(
            {"message": "Sales order converted to invoice.", "sales_order_id": order.pk, "invoice_id": invoice.pk},
            status=status.HTTP_201_CREATED,
        )


# ── Recurring Invoices ────────────────────────────────────────────────────────

class RecurringInvoiceListCreateView(APIView):
    """GET / POST /api/sales/recurring-invoices/"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_tenant_filter(
            RecurringInvoice.objects.prefetch_related("line_items"),
            request.user,
        ).order_by("-created_at")
        p = request.query_params
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if f := p.get("frequency"):
            qs = qs.filter(frequency=f)
        return Response(RecurringInvoiceSerializer(qs, many=True).data)

    def post(self, request):
        tenant = _tenant_or_400(request.user)
        ser = RecurringInvoiceWriteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = ser.save(tenant=tenant, created_by=request.user)
        return Response(RecurringInvoiceSerializer(obj).data, status=status.HTTP_201_CREATED)


class RecurringInvoiceDetailView(APIView):
    """GET / PATCH / DELETE /api/sales/recurring-invoices/<pk>/"""
    permission_classes = [IsAuthenticated]

    def _get(self, pk, user):
        qs = _apply_tenant_filter(
            RecurringInvoice.objects.prefetch_related("line_items"), user,
        )
        try:
            return qs.get(pk=pk)
        except RecurringInvoice.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(RecurringInvoiceSerializer(obj).data)

    def patch(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ser = RecurringInvoiceWriteSerializer(obj, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response(RecurringInvoiceSerializer(ser.save()).data)

    def delete(self, request, pk):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Customer Statement ────────────────────────────────────────────────────────

class CustomerStatementView(APIView):
    """
    GET /api/sales/customer-statements/<customer_id>/
    Returns invoice and payment summary for a single customer.
    Query params: date_from, date_to
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, customer_id):
        if not _can_view_customer_statements(request.user):
            return Response(
                {"error": "You do not have permission to view customer statements."},
                status=status.HTTP_403_FORBIDDEN,
            )
        tenant = _tenant_or_400(request.user)
        _, settings_obj = resolve_document_template(tenant=tenant, document_type="statement")
        cust_qs = _apply_tenant_filter(Customer.objects.all(), request.user)
        try:
            customer = cust_qs.get(pk=customer_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=404)

        p = request.query_params
        all_inv_qs = _apply_tenant_filter(
            Invoice.objects.filter(customer=customer).prefetch_related(
                "transactions__vehicle",
                "transactions__item",
                "transactions__branch",
            ),
            request.user,
        )
        tx_qs = _apply_tenant_filter(
            Transaction.objects.filter(customer=customer),
            request.user,
        )
        statement_scope_qs = all_inv_qs
        if df := p.get("date_from"):
            tx_qs = tx_qs.filter(created_at__date__gte=df)
        if dt := p.get("date_to"):
            statement_scope_qs = statement_scope_qs.filter(issued_date__date__lte=dt)
            tx_qs = tx_qs.filter(created_at__date__lte=dt)
        inv_qs = statement_scope_qs
        if df := p.get("date_from"):
            inv_qs = inv_qs.filter(issued_date__date__gte=df)
        inv_qs = inv_qs.order_by("-issued_date", "-id")

        invoices = list(inv_qs)
        statement_scope_invoices = list(statement_scope_qs.order_by("-issued_date", "-id"))
        invoice_snapshots = []
        total_invoiced = Decimal("0.00")
        total_paid = Decimal("0.00")
        outstanding = Decimal("0.00")
        for inv in invoices:
            reconciliation = reconcile_invoice_payment_state(inv, persist=True)
            total_invoiced += reconciliation["total_amount"]
            total_paid += reconciliation["paid_amount"]
            outstanding += reconciliation["balance_amount"]
            invoice_snapshots.append((inv, reconciliation))

        opening_balance = Decimal("0.00")
        if p.get("date_from"):
            opening_invoices = all_inv_qs.filter(issued_date__date__lt=p.get("date_from"))
            for inv in opening_invoices:
                opening_balance += reconcile_invoice_payment_state(inv, persist=True)["balance_amount"]

        period_payments = Decimal("0.00")
        recent_payments = []
        paid_transactions = []
        try:
            paid_transactions = list(
                _apply_tenant_filter(
                    Transaction.objects.filter(
                        customer=customer,
                        payment_status="Paid",
                        payment_received_at__isnull=False,
                    ).select_related("vehicle", "auto_invoice"),
                    request.user,
                ).order_by("-payment_received_at", "-id")
            )
        except Exception:
            paid_transactions = []

        statement_date_from = p.get("date_from")
        statement_date_to = p.get("date_to")
        for tx in paid_transactions:
            paid_on = getattr(tx, "payment_received_at", None)
            if not paid_on:
                continue
            paid_on_date = paid_on.date()
            if statement_date_from and paid_on_date < timezone.datetime.fromisoformat(statement_date_from).date():
                continue
            if statement_date_to and paid_on_date > timezone.datetime.fromisoformat(statement_date_to).date():
                continue
            charge_amount = Decimal(str(getattr(tx, "charge", 0) or 0))
            period_payments += charge_amount
            if len(recent_payments) < 8:
                recent_payments.append({
                    "receipt_number": f"RCPT-{tx.pk:05d}",
                    "date": paid_on_date.isoformat(),
                    "payment_method": getattr(tx, "payment_mode", "") or "—",
                    "reference": getattr(tx, "payment_reference", "") or f"TX-{tx.pk:05d}",
                    "amount": float(charge_amount),
                })

        aging_buckets = {
            "current": Decimal("0.00"),
            "days_1_30": Decimal("0.00"),
            "days_31_60": Decimal("0.00"),
            "days_61_90": Decimal("0.00"),
            "days_90_plus": Decimal("0.00"),
        }
        today = timezone.now().date()
        for inv in statement_scope_invoices:
            reconciliation = reconcile_invoice_payment_state(inv, persist=True)
            balance_amount = reconciliation["balance_amount"]
            if balance_amount <= 0:
                continue
            due_date = getattr(inv, "due_date", None)
            if not due_date:
                aging_buckets["current"] += balance_amount
                continue
            age_days = max((today - due_date).days, 0)
            if age_days > 90:
                aging_buckets["days_90_plus"] += balance_amount
            elif age_days > 60:
                aging_buckets["days_61_90"] += balance_amount
            elif age_days > 30:
                aging_buckets["days_31_60"] += balance_amount
            elif age_days > 0:
                aging_buckets["days_1_30"] += balance_amount
            else:
                aging_buckets["current"] += balance_amount

        amount_overdue = (
            aging_buckets["days_1_30"] +
            aging_buckets["days_31_60"] +
            aging_buckets["days_61_90"] +
            aging_buckets["days_90_plus"]
        )

        company_name = ""
        company_email = ""
        company_phone = ""
        currency = getattr(tenant, "default_currency", "KES") if tenant else "KES"
        if tenant is not None:
            company_name = getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or ""
            company_email = getattr(tenant, "contact_email", "") or ""
            company_phone = getattr(tenant, "contact_phone", "") or ""
        payment_terms_days = getattr(settings_obj, "default_payment_terms_days", 30) if settings_obj else 30
        customer_code = f"CUST-{customer.pk:06d}"
        last_payment = recent_payments[0] if recent_payments else None
        last_invoice = invoice_snapshots[0][0] if invoice_snapshots else None

        return Response({
            "customer": {
                "id": customer.pk,
                "code": customer_code,
                "name": customer.name,
                "phone": getattr(customer, "phone_number", ""),
                "email": getattr(customer, "email", ""),
                "address": getattr(customer, "address", "") or "",
                "account_manager": "",
                "contact_person": customer.name,
                "tax_pin": "",
                "credit_limit": None,
                "available_credit": None,
                "payment_terms": f"Net {payment_terms_days} Days",
            },
            "company": {
                "name": company_name,
                "email": company_email,
                "phone": company_phone,
                "currency": currency,
            },
            "branding": {
                "logo_url": _safe_logo_url(settings_obj, request),
                "primary_color": getattr(settings_obj, "primary_color", "") or "#E85D26",
                "footer_text": getattr(settings_obj, "footer_text", "") or "",
            },
            "summary": {
                "total_invoiced": float(total_invoiced),
                "total_paid":     float(total_paid),
                "outstanding":    float(outstanding),
                "opening_balance": float(opening_balance),
                "sales_during_period": float(total_invoiced),
                "payments_received": float(period_payments),
                "closing_balance": float(opening_balance + total_invoiced - period_payments),
                "amount_overdue": float(amount_overdue),
                "pending_amount": 0.0,
                "debt_amount": 0.0,
                "invoice_count":  len(invoices),
                "pending_count":  0,
            },
            "aging": {
                "current": float(aging_buckets["current"]),
                "days_1_30": float(aging_buckets["days_1_30"]),
                "days_31_60": float(aging_buckets["days_31_60"]),
                "days_61_90": float(aging_buckets["days_61_90"]),
                "days_90_plus": float(aging_buckets["days_90_plus"]),
                "total": float(sum(aging_buckets.values(), Decimal("0.00"))),
            },
            "invoices": [
                {
                    "id": inv.pk,
                    "invoice_number": getattr(inv, "invoice_number", f"INV-{inv.pk:04d}"),
                    "status":         reconciliation["status"],
                    "invoice_date":   (getattr(inv, "issued_at", None) or inv.issued_date).date().isoformat(),
                    "total":          float(inv.total_amount or 0),
                    "paid_amount":    float(reconciliation["paid_amount"]),
                    "balance_amount": float(reconciliation["balance_amount"]),
                    "due_date":       str(inv.due_date) if getattr(inv, "due_date", None) else None,
                    "source_module":  getattr(inv, "source_module", "manual"),
                    "created_at":     inv.issued_date.isoformat(),
                    "status_badge": (
                        "Paid" if reconciliation["balance_amount"] == Decimal("0.00")
                        else "Overdue" if getattr(inv, "due_date", None) and getattr(inv, "due_date", None) < today
                        else "Outstanding"
                    ),
                    "transaction_highlights": [
                        {
                            "transaction_number": f"TX-{tx.pk:05d}",
                            "vehicle_plate": getattr(getattr(tx, "vehicle", None), "number_plate", "") or "—",
                            "item_name": getattr(getattr(tx, "item", None), "name", "") or "—",
                            "branch_name": getattr(getattr(tx, "branch", None), "name", "") or "—",
                            "destination": getattr(tx, "destination", "") or "—",
                            "payment_mode": getattr(tx, "payment_mode", "") or "—",
                            "payment_status": getattr(tx, "payment_status", "") or "Pending",
                            "net_weight_display": f"{int(tx.net_weight or 0):,} kg",
                            "charge_display": _money(tx.charge or 0, currency),
                        }
                        for tx in inv.transactions.all()[:3]
                    ],
                }
                for inv, reconciliation in invoice_snapshots
            ],
            "pending_transactions": [],
            "recent_payments": recent_payments,
            "activity_summary": {
                "total_invoices": len(invoices),
                "paid_invoices": sum(1 for _, rec in invoice_snapshots if rec["balance_amount"] == Decimal("0.00")),
                "outstanding_invoices": sum(1 for _, rec in invoice_snapshots if rec["balance_amount"] > Decimal("0.00")),
                "total_payments": float(period_payments),
                "last_payment": last_payment["date"] if last_payment else None,
                "last_invoice": getattr(last_invoice, "invoice_number", "") if last_invoice else "",
            },
            "payment_instructions": {
                "bank": "",
                "account_name": company_name,
                "account_number": "",
                "branch": "",
                "paybill": "",
                "reference": customer_code,
                "contact_email": company_email or getattr(settings_obj, "support_email", "") if settings_obj else company_email,
                "contact_phone": company_phone,
            },
        })


class CustomerStatementDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, customer_id):
        statement_response = CustomerStatementView().get(request, customer_id)
        if statement_response.status_code != 200:
            return statement_response

        payload = statement_response.data
        tenant = _tenant_or_400(request.user)
        _, settings_obj = resolve_document_template(tenant=tenant, document_type="statement")
        currency = payload.get("company", {}).get("currency") or getattr(tenant, "default_currency", "KES") or "KES"

        lines = []
        for invoice in payload.get("invoices", []):
            lines.append({
                "description": f"Invoice {invoice['invoice_number']} ({invoice.get('status', '').title()})",
                "quantity": 1,
                "unit_price": Decimal(str(invoice["total"])),
                "unit_price_display": _money(invoice["total"], currency),
                "total": Decimal(str(invoice["total"])),
                "total_display": _money(invoice["total"], currency),
            })

        document_context = {
            "branding": payload.get("branding", {
                "logo_url": _safe_logo_url(settings_obj, request),
                "primary_color": getattr(settings_obj, "primary_color", "") or "#E85D26",
                "footer_text": getattr(settings_obj, "footer_text", "") or "",
            }),
            "company": payload.get("company", {}),
            "customer": payload.get("customer", {}),
            "document": {
                "number": f"STM-{customer_id:04d}",
                "status": "current",
                "issue_date": timezone.now().strftime("%d %b %Y"),
                "due_date": request.query_params.get("date_to", ""),
                "currency": currency,
                "notes": (
                    f"Outstanding balance: {_money(payload['summary']['outstanding'], currency)}\n"
                    f"Total paid: {_money(payload['summary']['total_paid'], currency)}\n"
                    f"Invoice count: {payload['summary']['invoice_count']}"
                ),
                "terms": "This statement summarizes invoice balances and settled payments for the selected customer.",
            },
            "lines": lines,
            "totals": {
                "subtotal": Decimal(str(payload["summary"]["total_invoiced"])),
                "subtotal_display": _money(payload["summary"]["total_invoiced"], currency),
                "tax": Decimal("0.00"),
                "tax_display": _money(0, currency),
                "discount": Decimal("0.00"),
                "discount_display": _money(0, currency),
                "total": Decimal(str(payload["summary"]["outstanding"])),
                "total_display": _money(payload["summary"]["outstanding"], currency),
            },
            "generated_at": timezone.now(),
        }
        rendered = render_business_document(
            tenant=tenant,
            document_type="statement",
            context=document_context,
            request=request,
        )
        wants_pdf = (
            request.query_params.get("download") == "pdf"
        )
        if wants_pdf:
            return _statement_pdf_response(
                payload=payload,
                customer_id=customer_id,
                request=request,
                tenant=tenant,
            )
        return HttpResponse(rendered.html, content_type="text/html; charset=utf-8")


class AgingReportView(APIView):
    """
    GET /api/sales/aging/
    Receivables aging buckets from customer invoices.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            from SL_Weighbridge.models import Invoice
        except ImportError:
            return Response({"results": [], "summary": {}})

        today = timezone.now().date()
        qs = _apply_tenant_filter(
            Invoice.objects.select_related("customer"),
            request.user,
        ).filter(status__in=["issued", "overdue"])

        results = []
        totals = {"current": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_90_plus": 0.0}
        for inv in qs.order_by("due_date", "issued_date")[:500]:
            due_date = getattr(inv, "due_date", None)
            age_days = max((today - due_date).days, 0) if due_date else 0
            amount = float(inv.total_amount or 0)
            bucket = "current"
            if age_days > 90:
                bucket = "days_90_plus"
            elif age_days > 60:
                bucket = "days_61_90"
            elif age_days > 30:
                bucket = "days_31_60"
            elif age_days > 0:
                bucket = "days_1_30"
            totals[bucket] += amount
            results.append(
                {
                    "invoice_id": inv.pk,
                    "invoice_number": getattr(inv, "invoice_number", f"INV-{inv.pk:04d}"),
                    "customer_name": getattr(getattr(inv, "customer", None), "name", ""),
                    "due_date": str(due_date) if due_date else None,
                    "age_days": age_days,
                    "amount": amount,
                    "bucket": bucket,
                }
            )
        totals["total_outstanding"] = sum(totals.values())
        return Response({"summary": totals, "results": results})


# ── Customers proxy ───────────────────────────────────────────────────────────

class SalesCustomerListView(APIView):
    """
    GET /api/sales/customers/
    Lightweight customer list for dropdown selects (name, id).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_sales_customer_permission(request.user, "view")
        qs = _apply_tenant_filter(Customer.objects.all(), request.user).order_by("name", "id")
        if q := request.query_params.get("search"):
            qs = qs.filter(
                Q(name__icontains=q) |
                Q(phone_number__icontains=q) |
                Q(email__icontains=q)
            )

        serializer = SalesCustomerSerializer(qs[:100], many=True)
        return Response({"customers": serializer.data})

    def post(self, request):
        _require_sales_customer_permission(request.user, "add")
        tenant = _tenant_or_400(request.user)
        serializer = SalesCustomerSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        customer = serializer.save(tenant=tenant)
        return Response(SalesCustomerSerializer(customer).data, status=status.HTTP_201_CREATED)


class SalesCustomerDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_customer(self, user, pk):
        try:
            return _apply_tenant_filter(Customer.objects.all(), user).get(pk=pk)
        except Customer.DoesNotExist:
            return None

    def get(self, request, pk):
        _require_sales_customer_permission(request.user, "view")
        customer = self._get_customer(request.user, pk)
        if customer is None:
            return Response({"error": "Customer not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(SalesCustomerSerializer(customer).data)

    def patch(self, request, pk):
        _require_sales_customer_permission(request.user, "change")
        customer = self._get_customer(request.user, pk)
        if customer is None:
            return Response({"error": "Customer not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = SalesCustomerSerializer(customer, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        updated = serializer.save()
        return Response(SalesCustomerSerializer(updated).data)
