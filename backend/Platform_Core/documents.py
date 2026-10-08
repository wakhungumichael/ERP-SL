from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from django.template import Context
from django.template.defaultfilters import date as date_filter
from django.template.defaultfilters import floatformat
from django.template.engine import Engine
from django.utils import timezone

from Platform_Core.models import DocumentTemplate, TenantSettings


DOCUMENT_SETTINGS_FIELD_MAP = {
    "invoice": "invoice_template",
    "quotation": "estimate_template",
    "receipt": "receipt_template",
    "statement": "statement_template",
    "purchase_order": "purchase_order_template",
}

DOCUMENT_TITLES = {
    "invoice": "Invoice",
    "quotation": "Estimate",
    "receipt": "Receipt",
    "statement": "Statement",
    "purchase_order": "Purchase Order",
    "report": "Report",
}


@dataclass
class RenderedDocument:
    html: str
    template: Optional[DocumentTemplate]
    settings: Optional[TenantSettings]


def _template_engine():
    return Engine(
        debug=False,
        builtins=[
            "django.template.defaulttags",
            "django.template.defaultfilters",
            "django.template.loader_tags",
        ],
    )


def _money(value, currency="KES"):
    amount = Decimal(value or 0)
    return f"{currency} {amount:,.2f}"


def _safe_logo_url(settings_obj, request=None):
    if not settings_obj:
        return ""
    if getattr(settings_obj, "logo_file", None):
        try:
            url = settings_obj.logo_file.url
            return request.build_absolute_uri(url) if request else url
        except Exception:
            pass
    return settings_obj.logo_url or ""


def _get_settings(tenant):
    if tenant is None:
        return None
    try:
        return tenant.settings
    except TenantSettings.DoesNotExist:
        return None
    except Exception:
        return None


def resolve_document_template(*, tenant, document_type):
    settings_obj = _get_settings(tenant)
    template = None

    if settings_obj:
        settings_field = DOCUMENT_SETTINGS_FIELD_MAP.get(document_type)
        if settings_field:
            template = getattr(settings_obj, settings_field, None)
            if template and not template.is_active:
                template = None

    if template is None:
        template = (
            DocumentTemplate.objects.filter(
                tenant=tenant,
                document_type=document_type,
                is_active=True,
                is_default=True,
            )
            .order_by("-updated_at", "-id")
            .first()
        )

    if template is None:
        template = (
            DocumentTemplate.objects.filter(
                tenant__isnull=True,
                document_type=document_type,
                is_active=True,
                is_default=True,
            )
            .order_by("-updated_at", "-id")
            .first()
        )

    return template, settings_obj


def _default_stylesheet(primary_color):
    return f"""
      :root {{
        --brand-color: {primary_color};
        --brand-color-soft: color-mix(in srgb, {primary_color} 12%, white);
        --text-main: #0f172a;
        --text-muted: #64748b;
        --border: #dbe3ea;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        background: #f6f7fb;
        color: var(--text-main);
        font-family: Georgia, "Times New Roman", serif;
        line-height: 1.5;
      }}
      .document-shell {{
        max-width: 960px;
        margin: 32px auto;
        background: #fff;
        padding: 40px;
        border: 1px solid var(--border);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
      }}
      .document-header {{
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding-bottom: 24px;
        border-bottom: 3px solid var(--brand-color);
        margin-bottom: 28px;
      }}
      .document-brand {{
        display: flex;
        gap: 16px;
        align-items: center;
      }}
      .document-logo {{
        max-width: 92px;
        max-height: 92px;
        object-fit: contain;
      }}
      .document-kicker {{
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--brand-color);
        font-weight: 700;
      }}
      .document-title {{
        margin: 6px 0 0;
        font-size: 34px;
        line-height: 1.1;
      }}
      .document-meta {{
        min-width: 240px;
        background: var(--brand-color-soft);
        border: 1px solid var(--border);
        padding: 16px;
      }}
      .meta-row,
      .summary-row {{
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 8px;
      }}
      .meta-row:last-child,
      .summary-row:last-child {{
        margin-bottom: 0;
      }}
      .meta-label,
      .summary-label {{
        color: var(--text-muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }}
      .meta-value,
      .summary-value {{
        text-align: right;
        font-weight: 700;
      }}
      .document-grid {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
        margin-bottom: 28px;
      }}
      .panel {{
        border: 1px solid var(--border);
        padding: 18px;
      }}
      .panel h3 {{
        margin: 0 0 12px;
        font-size: 13px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--brand-color);
      }}
      table {{
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
      }}
      th {{
        text-align: left;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
        border-bottom: 1px solid var(--border);
        padding: 10px 8px;
      }}
      td {{
        padding: 12px 8px;
        border-bottom: 1px solid #eef2f7;
        vertical-align: top;
      }}
      th.num, td.num {{ text-align: right; }}
      .document-summary {{
        margin-top: 24px;
        margin-left: auto;
        width: min(360px, 100%);
        border: 1px solid var(--border);
        padding: 18px;
      }}
      .summary-row.total {{
        border-top: 2px solid var(--brand-color);
        margin-top: 10px;
        padding-top: 12px;
        font-size: 18px;
      }}
      .notes {{
        margin-top: 28px;
        padding-top: 20px;
        border-top: 1px solid var(--border);
      }}
      .notes h3 {{
        margin: 0 0 8px;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--brand-color);
      }}
      .document-footer {{
        margin-top: 28px;
        color: var(--text-muted);
        font-size: 12px;
        border-top: 1px solid var(--border);
        padding-top: 16px;
      }}
      @media print {{
        body {{ background: #fff; }}
        .document-shell {{
          margin: 0;
          box-shadow: none;
          border: none;
          max-width: none;
          padding: 0;
        }}
      }}
      @media (max-width: 768px) {{
        .document-shell {{ padding: 24px; margin: 0; }}
        .document-header {{ flex-direction: column; }}
        .document-grid {{ grid-template-columns: 1fr; }}
      }}
    """


def _brand_stylesheet(primary_color):
    return f"""
      :root {{
        --brand-color: {primary_color};
        --brand-color-soft: color-mix(in srgb, {primary_color} 12%, white);
      }}
    """


def _receipt_stylesheet(primary_color):
    return f"""
      :root {{ --receipt-brand: {primary_color}; --receipt-text: #111827; }}
      * {{ box-sizing: border-box; }}
      @page {{ size: A5 landscape; margin: 5mm; }}
      body {{ margin: 0; background: #f3f4f6; color: var(--receipt-text); font-family: Arial, Helvetica, sans-serif; }}
      .wb-receipt {{ width: 200mm; height: 138mm; margin: 12px auto; padding: 4.5mm 5mm; overflow: hidden; background: #fff; border: 1px solid var(--receipt-brand); font-size: 8pt; line-height: 1.18; }}
      .wb-receipt__header {{ display: grid; grid-template-columns: 42mm 1fr; align-items: center; gap: 4mm; padding-bottom: 2mm; border-bottom: 2px solid var(--receipt-brand); }}
      .wb-receipt__logo {{ display: block; width: 40mm; max-height: 16mm; object-fit: contain; object-position: left center; }}
      .wb-receipt__company {{ font-size: 14pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }}
      .wb-receipt__branch {{ margin-top: 1mm; font-size: 8pt; font-weight: 700; }}
      .wb-receipt__contact {{ grid-column: 1 / -1; color: #4b5563; font-size: 7pt; }}
      .wb-receipt__title-row {{ display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 4mm; padding: 2.5mm 0; border-bottom: 1px dashed var(--receipt-brand); }}
      .wb-receipt__kicker {{ font-size: 7.5pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--receipt-brand); }}
      .wb-receipt__title-row strong {{ font-size: 12pt; }}
      .wb-receipt__issue {{ text-align: right; font-size: 7.5pt; }}
      .wb-receipt__issue span, .wb-receipt__payment span {{ display: block; color: #6b7280; font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; }}
      .wb-receipt__status {{ padding: 1.5mm 3mm; border: 1px solid currentColor; font-size: 7.5pt; font-weight: 800; letter-spacing: .08em; white-space: nowrap; }}
      .wb-receipt__status.is-paid {{ color: #047857; background: #ecfdf5; }}
      .wb-receipt__status.is-pending {{ color: #b45309; background: #fffbeb; }}
      .wb-receipt__details, .wb-receipt__weights {{ width: 100%; border-collapse: collapse; }}
      .wb-receipt__details {{ margin: 2mm 0; }}
      .wb-receipt__details th, .wb-receipt__details td {{ padding: 1.1mm 1.5mm; border-bottom: 1px solid #e5e7eb; text-align: left; }}
      .wb-receipt__details th {{ width: 14%; color: #6b7280; font-size: 7pt; letter-spacing: .07em; text-transform: uppercase; }}
      .wb-receipt__details td {{ width: 36%; font-weight: 700; }}
      .wb-receipt__weights thead {{ background: var(--receipt-brand); color: #fff; }}
      .wb-receipt__weights th, .wb-receipt__weights td {{ padding: 1.5mm; border: 1px solid #d1d5db; text-align: left; }}
      .wb-receipt__weights th:last-child, .wb-receipt__weights td:last-child {{ text-align: right; font-weight: 800; }}
      .wb-receipt__weights tfoot {{ background: #f9fafb; }}
      .wb-receipt__weights tfoot th {{ border-top: 2px solid var(--receipt-brand); font-size: 10pt; text-transform: uppercase; }}
      .wb-receipt__payment {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin-top: 2mm; padding-top: 2mm; border-top: 1px dashed #9ca3af; }}
      .wb-receipt__payment strong {{ font-size: 9pt; }}
      .wb-receipt__payment .wb-receipt__charge {{ text-align: right; }}
      .wb-receipt__payment .wb-receipt__charge strong {{ color: var(--receipt-brand); font-size: 11pt; }}
      .wb-receipt__footer {{ margin-top: 2mm; padding-top: 1.5mm; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 7pt; }}
      @media print {{
        body {{ background: #fff; }}
        .wb-receipt {{ width: 200mm; height: 138mm; margin: 0; }}
      }}
    """


def _default_body(document_type):
    if document_type == "receipt":
        return """
          <main class="wb-receipt">
            <header class="wb-receipt__header">
              {% if branding.logo_url %}
                <img class="wb-receipt__logo" src="{{ branding.logo_url }}" alt="{{ company.name }} logo" />
              {% endif %}
              {% if not branding.logo_url %}
                <div class="wb-receipt__company">{{ company.name|default:"SL-ERP" }}</div>
              {% endif %}
              <div class="wb-receipt__branch">{{ company.branch_name|default:"Main Branch" }}</div>
              {% if company.phone or company.email %}
                <div class="wb-receipt__contact">{{ company.phone }}{% if company.phone and company.email %} | {% endif %}{{ company.email }}</div>
              {% endif %}
            </header>

            <section class="wb-receipt__title-row">
              <div>
                <div class="wb-receipt__kicker">Weighbridge Receipt</div>
                <strong>{{ document.number }}</strong>
              </div>
              <div class="wb-receipt__issue">
                <span>Date</span>
                <strong>{{ document.issue_date }}</strong>
              </div>
              <div class="wb-receipt__status {% if receipt_meta.payment_status == 'Paid' %}is-paid{% else %}is-pending{% endif %}">
                {{ receipt_meta.receipt_label }}
              </div>
            </section>

            <table class="wb-receipt__details">
              <tbody>
                <tr>
                  <th>Customer</th><td>{{ customer.name }}</td>
                  <th>Vehicle No.</th><td>{{ weighing.vehicle_plate|default:"-" }}</td>
                </tr>
                <tr>
                  <th>Item</th><td>{{ weighing.item_name|default:"-" }}</td>
                  <th>Vehicle Type</th><td>{{ weighing.vehicle_type_name|default:"-" }}</td>
                </tr>
                <tr>
                  <th>Destination</th><td>{{ weighing.destination|default:"-" }}</td>
                  <th>Operator</th><td>{{ weighing.operator|default:"-" }}</td>
                </tr>
              </tbody>
            </table>

            <table class="wb-receipt__weights">
              <thead>
                <tr><th>Weighing</th><th>Date &amp; Time</th><th>Weight (kg)</th></tr>
              </thead>
              <tbody>
                <tr><td>1. First Weight</td><td>{{ weighing.gross_weight_date|default:"-" }}</td><td>{{ weighing.gross_weight_display }}</td></tr>
                <tr><td>2. Second Weight</td><td>{{ weighing.tare_weight_date|default:"-" }}</td><td>{{ weighing.tare_weight_display }}</td></tr>
              </tbody>
              <tfoot>
                <tr><th colspan="2">Net Weight</th><th>{{ weighing.net_weight_display }}</th></tr>
              </tfoot>
            </table>

            <section class="wb-receipt__payment">
              <div><span>Payment Mode</span><strong>{{ receipt_meta.payment_mode|default:"-" }}</strong></div>
              <div><span>Payment Status</span><strong>{{ receipt_meta.payment_status }}</strong></div>
              <div class="wb-receipt__charge"><span>Charge</span><strong>{{ totals.total_display }}</strong></div>
            </section>

            {% if branding.footer_text %}
              <footer class="wb-receipt__footer">{{ branding.footer_text }}</footer>
            {% endif %}
          </main>
        """
    if document_type == "report":
        return """
          <div class="document-shell">
            <div class="document-header">
              <div class="document-brand">
                {% if branding.logo_url %}
                  <img class="document-logo" src="{{ branding.logo_url }}" alt="{{ company.name }} logo" />
                {% endif %}
                <div>
                  <div class="document-kicker">{{ company.name|default:"SL-ERP" }}</div>
                  <h1 class="document-title">{{ report.title|default:"Weighbridge Report" }}</h1>
                  <div style="color:#64748b;font-size:14px;">
                    {{ report.category_label|default:"Operations Report" }} · {{ document.issue_date }}
                  </div>
                </div>
              </div>
              <div class="document-meta">
                <div class="meta-row"><span class="meta-label">Report ID</span><span class="meta-value">{{ document.number|default:"REPORT" }}</span></div>
                <div class="meta-row"><span class="meta-label">Prepared By</span><span class="meta-value">{{ company.prepared_by|default:"System User" }}</span></div>
                <div class="meta-row"><span class="meta-label">Date Range</span><span class="meta-value">{{ report.date_range|default:"Current selection" }}</span></div>
                <div class="meta-row"><span class="meta-label">Rows</span><span class="meta-value">{{ report.row_count|default:0 }}</span></div>
              </div>
            </div>

            {% if report.summary %}
              <div class="document-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">
                {% for item in report.summary %}
                  <div class="panel">
                    <h3>{{ item.label }}</h3>
                    <div style="font-size:24px;font-weight:700;">{{ item.value }}</div>
                  </div>
                {% endfor %}
              </div>
            {% endif %}

            {% if report.filters %}
              <div class="panel" style="margin-bottom:24px;">
                <h3>Applied Filters</h3>
                <div class="document-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:0;">
                  {% for item in report.filters %}
                    <div>
                      <div class="summary-label">{{ item.label }}</div>
                      <div style="margin-top:6px;font-weight:600;">{{ item.value }}</div>
                    </div>
                  {% endfor %}
                </div>
              </div>
            {% endif %}

            <table>
              <thead>
                <tr>
                  {% for column in report.columns %}
                    <th class="{% if column.align == 'right' %}num{% endif %}">{{ column.label }}</th>
                  {% endfor %}
                </tr>
              </thead>
              <tbody>
                {% for row in report.display_rows %}
                  <tr>
                    {% for cell in row %}
                      <td class="{% if cell.align == 'right' %}num{% endif %}">{{ cell.value|default:"—" }}</td>
                    {% endfor %}
                  </tr>
                {% empty %}
                  <tr>
                    <td colspan="{{ report.columns|length }}" style="text-align:center;color:#64748b;">No rows matched the current filters.</td>
                  </tr>
                {% endfor %}
              </tbody>
            </table>

            {% if document.notes %}
              <div class="notes">
                <h3>Notes</h3>
                <div>{{ document.notes|linebreaksbr }}</div>
              </div>
            {% endif %}

            <div class="document-footer">
              {{ branding.footer_text|default:"Generated by SL-ERP" }}
            </div>
          </div>
        """

    title = DOCUMENT_TITLES.get(document_type, "Document")
    return f"""
      <div class="document-shell">
        <div class="document-header">
          <div class="document-brand">
            {{% if branding.logo_url %}}
              <img class="document-logo" src="{{{{ branding.logo_url }}}}" alt="{{{{ company.name }}}} logo" />
            {{% endif %}}
            <div>
              <div class="document-kicker">{{{{ company.name|default:"SL-ERP" }}}}</div>
              <h1 class="document-title">{title}</h1>
              <div style="color:#64748b;font-size:14px;">{{{{ document.number }}}}</div>
            </div>
          </div>
          <div class="document-meta">
            <div class="meta-row"><span class="meta-label">Status</span><span class="meta-value">{{{{ document.status|default:"draft"|title }}}}</span></div>
            <div class="meta-row"><span class="meta-label">Issue Date</span><span class="meta-value">{{{{ document.issue_date|default:"-" }}}}</span></div>
            <div class="meta-row"><span class="meta-label">Due / Expiry</span><span class="meta-value">{{{{ document.due_date|default:"-" }}}}</span></div>
            <div class="meta-row"><span class="meta-label">Currency</span><span class="meta-value">{{{{ document.currency|default:"KES" }}}}</span></div>
          </div>
        </div>

        <div class="document-grid">
          <div class="panel">
            <h3>Billed To</h3>
            <div><strong>{{{{ customer.name|default:"Walk-in Customer" }}}}</strong></div>
            {{% if customer.email %}}<div>{{{{ customer.email }}}}</div>{{% endif %}}
            {{% if customer.phone %}}<div>{{{{ customer.phone }}}}</div>{{% endif %}}
          </div>
          <div class="panel">
            <h3>Company</h3>
            <div><strong>{{{{ company.name|default:"SL-ERP" }}}}</strong></div>
            {{% if company.email %}}<div>{{{{ company.email }}}}</div>{{% endif %}}
            {{% if company.phone %}}<div>{{{{ company.phone }}}}</div>{{% endif %}}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th class="num">Qty</th>
              <th class="num">Unit Price</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {{% for line in lines %}}
              <tr>
                <td>{{{{ line.description }}}}</td>
                <td class="num">{{{{ line.quantity }}}}</td>
                <td class="num">{{{{ line.unit_price_display }}}}</td>
                <td class="num">{{{{ line.total_display }}}}</td>
              </tr>
            {{% empty %}}
              <tr>
                <td colspan="4" style="text-align:center;color:#64748b;">No line items.</td>
              </tr>
            {{% endfor %}}
          </tbody>
        </table>

        <div class="document-summary">
          <div class="summary-row"><span class="summary-label">Subtotal</span><span class="summary-value">{{{{ totals.subtotal_display }}}}</span></div>
          <div class="summary-row"><span class="summary-label">Tax</span><span class="summary-value">{{{{ totals.tax_display }}}}</span></div>
          <div class="summary-row"><span class="summary-label">Discount</span><span class="summary-value">{{{{ totals.discount_display }}}}</span></div>
          <div class="summary-row total"><span class="summary-label">Total</span><span class="summary-value">{{{{ totals.total_display }}}}</span></div>
        </div>

        {{% if document.notes or document.terms %}}
          <div class="notes">
            {{% if document.notes %}}
              <h3>Notes</h3>
              <div>{{{{ document.notes|linebreaksbr }}}}</div>
            {{% endif %}}
            {{% if document.terms %}}
              <h3 style="margin-top:18px;">Terms</h3>
              <div>{{{{ document.terms|linebreaksbr }}}}</div>
            {{% endif %}}
          </div>
        {{% endif %}}

        {{% if transaction_image_url %}}
          <div class="transaction-capture" style="margin-top:24px;break-inside:avoid;">
            <div style="margin-bottom:8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--brand-color);">Captured Vehicle Image</div>
            <img src="{{{{ transaction_image_url }}}}" alt="Captured vehicle" style="display:block;width:100%;max-height:360px;object-fit:contain;border:1px solid var(--border);border-radius:8px;" />
          </div>
        {{% endif %}}

        <div class="document-footer">
          {{{{ branding.footer_text|default:"Generated by SL-ERP" }}}}
        </div>
      </div>
    """


def _render_template_string(template_string, context):
    engine = _template_engine()
    template = engine.from_string(template_string)
    return template.render(Context(context))


def _invoice_context(invoice, settings_obj, request=None):
    customer = getattr(invoice, "customer", None)
    lines = []
    subtotal = Decimal("0.00")
    for line in invoice.lines.all():
        line_total = Decimal(line.total_amount or 0)
        unit_price = Decimal(line.unit_price or 0)
        subtotal += line_total
        lines.append(
            {
                "description": line.description
                or getattr(getattr(line, "vehicle_type", None), "name", "")
                or "Service",
                "quantity": line.quantity,
                "unit_price": unit_price,
                "unit_price_display": _money(unit_price, invoice.currency or "KES"),
                "total": line_total,
                "total_display": _money(line_total, invoice.currency or "KES"),
            }
        )

    transaction_highlights = []
    for tx in invoice.transactions.select_related("vehicle", "branch", "item", "vehicle_type").all()[:6]:
        transaction_highlights.append(
            {
                "number": f"TX-{tx.pk:05d}",
                "vehicle_plate": getattr(getattr(tx, "vehicle", None), "number_plate", "") or "—",
                "item_name": getattr(getattr(tx, "item", None), "name", "") or "—",
                "destination": getattr(tx, "destination", "") or "—",
                "gross_weight": f"{int(tx.gross_weight or 0):,} kg",
                "tare_weight": f"{int(tx.tare_weight or 0):,} kg",
                "net_weight": f"{int(tx.net_weight or 0):,} kg",
                "payment_mode": getattr(tx, "payment_mode", "") or "—",
                "payment_status": getattr(tx, "payment_status", "") or "Pending",
                "charge_display": _money(tx.charge or 0, invoice.currency or "KES"),
            }
        )

    if not lines and transaction_highlights:
        for raw_tx, tx in zip(invoice.transactions.all()[:6], transaction_highlights):
            amount_decimal = Decimal(raw_tx.charge or 0)
            amount_text = tx["charge_display"]
            subtotal += amount_decimal
            lines.append(
                {
                    "description": f"{tx['number']} • {tx['vehicle_plate']} • {tx['item_name']}",
                    "quantity": 1,
                    "unit_price": amount_decimal,
                    "unit_price_display": amount_text,
                    "total": amount_decimal,
                    "total_display": amount_text,
                }
            )

    total = Decimal(invoice.total_amount or 0)
    tax = max(total - subtotal, Decimal("0.00"))
    tenant = getattr(invoice, "tenant", None)
    note_parts = []
    if invoice.notes:
        note_parts.append(str(invoice.notes))
    if transaction_highlights:
        note_parts.append("Linked Transactions")
        note_parts.extend(
            [
                (
                    f"{tx['number']} | Vehicle {tx['vehicle_plate']} | Item {tx['item_name']} | "
                    f"Net {tx['net_weight']} | Charge {tx['charge_display']} | Payment {tx['payment_status']}"
                )
                for tx in transaction_highlights
            ]
        )
    return {
        "branding": {
            "logo_url": _safe_logo_url(settings_obj, request),
            "primary_color": getattr(settings_obj, "primary_color", "") or "#E85D26",
            "footer_text": getattr(settings_obj, "footer_text", "") or "",
        },
        "company": {
            "name": getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL-ERP",
            "email": getattr(tenant, "contact_email", "") or getattr(settings_obj, "support_email", ""),
            "phone": getattr(tenant, "contact_phone", ""),
            "currency": getattr(tenant, "default_currency", "KES"),
        },
        "customer": {
            "name": getattr(customer, "name", "") or "Walk-in Customer",
            "email": getattr(customer, "email", "") or "",
            "phone": getattr(customer, "phone_number", "") or "",
        },
        "document": {
            "number": invoice.invoice_number or f"INV-{invoice.pk:04d}",
            "status": invoice.status,
            "issue_date": date_filter(getattr(invoice, "issued_at", None) or invoice.issued_date, "d M Y"),
            "due_date": date_filter(invoice.due_date, "d M Y") if invoice.due_date else "",
            "currency": invoice.currency or "KES",
            "notes": "\n".join(note_parts),
            "terms": "",
            "source_module": getattr(invoice, "source_module", "manual"),
        },
        "lines": lines,
        "transaction_highlights": transaction_highlights,
        "totals": {
            "subtotal": subtotal,
            "subtotal_display": _money(subtotal, invoice.currency or "KES"),
            "tax": tax,
            "tax_display": _money(tax, invoice.currency or "KES"),
            "discount": Decimal("0.00"),
            "discount_display": _money(Decimal("0.00"), invoice.currency or "KES"),
            "total": total,
            "total_display": _money(total, invoice.currency or "KES"),
        },
        "generated_at": timezone.now(),
        "helpers": {
            "money": _money,
            "floatformat": floatformat,
        },
    }


def _estimate_context(estimate, settings_obj, request=None):
    customer = getattr(estimate, "customer", None)
    currency = getattr(getattr(estimate, "tenant", None), "default_currency", "KES")
    lines = []
    for line in estimate.line_items.all():
        lines.append(
            {
                "description": line.description or getattr(getattr(line, "product", None), "name", "") or "Item",
                "quantity": line.quantity,
                "unit_price": line.unit_price,
                "unit_price_display": _money(line.unit_price, currency),
                "total": line.line_total,
                "total_display": _money(line.line_total, currency),
            }
        )

    tenant = getattr(estimate, "tenant", None)
    return {
        "branding": {
            "logo_url": _safe_logo_url(settings_obj, request),
            "primary_color": getattr(settings_obj, "primary_color", "") or "#E85D26",
            "footer_text": getattr(settings_obj, "footer_text", "") or "",
        },
        "company": {
            "name": getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL-ERP",
            "email": getattr(tenant, "contact_email", "") or getattr(settings_obj, "support_email", ""),
            "phone": getattr(tenant, "contact_phone", ""),
            "currency": currency,
        },
        "customer": {
            "name": getattr(customer, "name", "") or estimate.customer_name or "Prospect",
            "email": getattr(customer, "email", "") or "",
            "phone": getattr(customer, "phone_number", "") or "",
        },
        "document": {
            "number": estimate.estimate_number or f"EST-{estimate.pk:04d}",
            "status": estimate.status,
            "issue_date": date_filter(estimate.issue_date, "d M Y"),
            "due_date": date_filter(estimate.expiry_date, "d M Y") if estimate.expiry_date else "",
            "currency": currency,
            "notes": estimate.notes or "",
            "terms": estimate.terms or "",
        },
        "lines": lines,
        "totals": {
            "subtotal": estimate.subtotal,
            "subtotal_display": _money(estimate.subtotal, currency),
            "tax": estimate.tax_total,
            "tax_display": _money(estimate.tax_total, currency),
            "discount": estimate.discount_total,
            "discount_display": _money(estimate.discount_total, currency),
            "total": estimate.total,
            "total_display": _money(estimate.total, currency),
        },
        "generated_at": timezone.now(),
    }


def _receipt_context(transaction, settings_obj, request=None):
    tenant = getattr(transaction, "tenant", None)
    branch = getattr(transaction, "branch", None)
    customer = getattr(transaction, "customer", None)
    vehicle = getattr(transaction, "vehicle", None)
    vehicle_type = getattr(transaction, "vehicle_type", None)
    item = getattr(transaction, "item", None)
    currency = getattr(tenant, "default_currency", "KES") if tenant else "KES"
    company_name = getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL-ERP"
    payment_status = getattr(transaction, "payment_status", "") or "Pending"
    payment_mode = getattr(transaction, "payment_mode", "") or ""
    receipt_label = "PAID" if payment_status == "Paid" else "PAYMENT PENDING"
    transaction_image_url = ""
    if getattr(transaction, "image", None):
        try:
            image_url = transaction.image.url
            transaction_image_url = request.build_absolute_uri(image_url) if request else image_url
        except (ValueError, OSError):
            pass

    lines = [
        {
            "description": "Gross Weight",
            "quantity": 1,
            "unit_price_display": "",
            "total_display": f"{int(transaction.gross_weight or 0):,} kg" if transaction.gross_weight is not None else "—",
        },
        {
            "description": "Tare Weight",
            "quantity": 1,
            "unit_price_display": "",
            "total_display": f"{int(transaction.tare_weight or 0):,} kg" if transaction.tare_weight is not None else "—",
        },
        {
            "description": "Net Weight",
            "quantity": 1,
            "unit_price_display": "",
            "total_display": f"{int(transaction.net_weight or 0):,} kg" if transaction.net_weight is not None else "—",
        },
    ]

    return {
        "branding": {
            "logo_url": _safe_logo_url(settings_obj, request),
            "primary_color": getattr(settings_obj, "primary_color", "") or "#E85D26",
            "footer_text": getattr(settings_obj, "footer_text", ""),
        },
        "company": {
            "name": company_name,
            "email": getattr(tenant, "contact_email", "") or getattr(settings_obj, "support_email", ""),
            "phone": getattr(tenant, "contact_phone", ""),
            "branch_name": getattr(branch, "name", "") or "Main Branch",
            "currency": currency,
        },
        "customer": {
            "name": getattr(customer, "name", "") or "Walk-in Customer",
            "email": getattr(customer, "email", "") or "",
            "phone": getattr(customer, "phone_number", "") or "",
        },
        "document": {
            "number": f"TX-{transaction.pk:05d}",
            "status": payment_status,
            "issue_date": date_filter(transaction.created_at, "d M Y H:i"),
            "due_date": "",
            "currency": currency,
            "notes": "\n".join(
                part for part in [
                    f"Vehicle: {getattr(vehicle, 'number_plate', '') or '—'}",
                    f"Vehicle Type: {getattr(vehicle_type, 'name', '') or '—'}",
                    f"Item: {getattr(item, 'name', '') or '—'}",
                    f"Destination: {transaction.destination or '—'}",
                    f"Payment Mode: {payment_mode or '—'}",
                    f"Payment Status: {payment_status}",
                    f"Receipt Status: {receipt_label}",
                ] if part
            ),
            "terms": "",
        },
        "lines": lines,
        "totals": {
            "subtotal": transaction.charge or 0,
            "subtotal_display": _money(transaction.charge or 0, currency),
            "tax": Decimal("0.00"),
            "tax_display": _money(Decimal("0.00"), currency),
            "discount": Decimal("0.00"),
            "discount_display": _money(Decimal("0.00"), currency),
            "total": transaction.charge or 0,
            "total_display": _money(transaction.charge or 0, currency),
        },
        "receipt_meta": {
            "payment_status": payment_status,
            "payment_mode": payment_mode,
            "receipt_label": receipt_label,
            "show_pending_banner": payment_status != "Paid",
            "allow_release": payment_status == "Paid" or payment_mode == "Debt",
        },
        "weighing": {
            "vehicle_plate": getattr(vehicle, "number_plate", "") or "",
            "vehicle_type_name": getattr(vehicle_type, "name", "") or "",
            "item_name": getattr(item, "name", "") or "",
            "destination": transaction.destination or "",
            "operator": transaction.operator or "",
            "gross_weight_display": f"{int(transaction.gross_weight or 0):,}" if transaction.gross_weight is not None else "-",
            "tare_weight_display": f"{int(transaction.tare_weight or 0):,}" if transaction.tare_weight is not None else "-",
            "net_weight_display": f"{int(transaction.net_weight or 0):,}" if transaction.net_weight is not None else "-",
            "gross_weight_date": date_filter(transaction.gross_weight_date, "d M Y H:i") if transaction.gross_weight_date else "",
            "tare_weight_date": date_filter(transaction.tare_weight_date, "d M Y H:i") if transaction.tare_weight_date else "",
        },
        "transaction_image_url": transaction_image_url,
        "generated_at": timezone.now(),
    }


def _purchase_order_context(purchase_order, settings_obj, request=None):
    creator = getattr(purchase_order, "created_by", None)
    counterparty_name = getattr(purchase_order, "supplier_name", "") or "Supplier"
    lines = []
    for line in purchase_order.items.all():
        lines.append(
            {
                "description": line.description or "Item",
                "quantity": line.quantity,
                "unit_price": line.unit_price,
                "unit_price_display": _money(line.unit_price, purchase_order.currency or "KES"),
                "total": line.total,
                "total_display": _money(line.total, purchase_order.currency or "KES"),
            }
        )

    return {
        "branding": {
            "logo_url": _safe_logo_url(settings_obj, request),
            "primary_color": getattr(settings_obj, "primary_color", "") or "#E85D26",
            "footer_text": getattr(settings_obj, "footer_text", "") or "",
        },
        "company": {
            "name": getattr(getattr(settings_obj, "tenant", None), "legal_name", "")
            or getattr(getattr(settings_obj, "tenant", None), "name", "")
            or "SL-ERP",
            "email": getattr(getattr(settings_obj, "tenant", None), "contact_email", "")
            or getattr(settings_obj, "support_email", ""),
            "phone": getattr(getattr(settings_obj, "tenant", None), "contact_phone", ""),
            "currency": purchase_order.currency or "KES",
            "prepared_by": creator.get_full_name() if creator else "",
        },
        "customer": {
            "name": counterparty_name,
            "email": getattr(purchase_order, "supplier_email", "") or "",
            "phone": getattr(purchase_order, "supplier_phone", "") or "",
        },
        "document": {
            "number": purchase_order.reference or f"PO-{purchase_order.pk:04d}",
            "status": purchase_order.status,
            "issue_date": date_filter(purchase_order.order_date, "d M Y"),
            "due_date": date_filter(purchase_order.expected_date, "d M Y") if purchase_order.expected_date else "",
            "currency": purchase_order.currency or "KES",
            "notes": purchase_order.notes or "",
            "terms": "",
        },
        "lines": lines,
        "totals": {
            "subtotal": purchase_order.total_amount,
            "subtotal_display": _money(purchase_order.total_amount, purchase_order.currency or "KES"),
            "tax": Decimal("0.00"),
            "tax_display": _money(Decimal("0.00"), purchase_order.currency or "KES"),
            "discount": Decimal("0.00"),
            "discount_display": _money(Decimal("0.00"), purchase_order.currency or "KES"),
            "total": purchase_order.total_amount,
            "total_display": _money(purchase_order.total_amount, purchase_order.currency or "KES"),
        },
        "generated_at": timezone.now(),
    }


def render_business_document(*, tenant, document_type, context, request=None):
    template, settings_obj = resolve_document_template(tenant=tenant, document_type=document_type)
    branding = context.get("branding") or {}
    primary_color = branding.get("primary_color") or "#E85D26"

    # Shared templates are general-purpose. Weighbridge tickets use a dedicated
    # compact print layout, while a tenant's explicitly selected template wins.
    use_compact_receipt = document_type == "receipt" and not getattr(template, "tenant_id", None)
    template_body = _default_body(document_type) if use_compact_receipt else (
        template.body_template if template and template.body_template else _default_body(document_type)
    )
    stylesheet = _receipt_stylesheet(primary_color) if use_compact_receipt else (
        template.stylesheet if template and template.stylesheet else _default_stylesheet(primary_color)
    )
    rendered_body = _render_template_string(template_body, context)
    if document_type == "receipt" and not use_compact_receipt and context.get("transaction_image_url") and "transaction-capture" not in rendered_body:
        rendered_body += _render_template_string(
            """
              <div class="transaction-capture" style="max-width:900px;margin:20px auto;background:#fff;padding:20px;break-inside:avoid;">
                <div style="margin-bottom:8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Captured Vehicle Image</div>
                <img src="{{ transaction_image_url }}" alt="Captured vehicle" style="display:block;width:100%;max-height:360px;object-fit:contain;border:1px solid #cbd5e1;border-radius:8px;" />
              </div>
            """,
            context,
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{context.get("document", {}).get("number", "Document")}</title>
    <style>{_brand_stylesheet(primary_color)}{stylesheet}</style>
  </head>
  <body>{rendered_body}</body>
</html>"""

    return RenderedDocument(html=html, template=template, settings=settings_obj)


def render_document_template_preview(template, *, tenant=None, request=None):
    _, settings_obj = resolve_document_template(tenant=tenant, document_type=template.document_type)
    if settings_obj is None and tenant is not None:
        settings_obj = _get_settings(tenant)

    primary_color = getattr(settings_obj, "primary_color", "") or "#E85D26"
    footer_text = getattr(settings_obj, "footer_text", "") or ""
    company_name = (
        getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL-ERP Demo Company"
    )
    company_email = getattr(tenant, "contact_email", "") or getattr(settings_obj, "support_email", "") or "accounts@example.com"
    company_phone = getattr(tenant, "contact_phone", "") or "+254 700 000 000"
    currency = getattr(tenant, "default_currency", "KES") or "KES"

    sample_lines = [
        {
            "description": "Premium service subscription",
            "quantity": 2,
            "unit_price": Decimal("4500.00"),
            "unit_price_display": _money(Decimal("4500.00"), currency),
            "total": Decimal("9000.00"),
            "total_display": _money(Decimal("9000.00"), currency),
        },
        {
            "description": "Implementation support",
            "quantity": 1,
            "unit_price": Decimal("3000.00"),
            "unit_price_display": _money(Decimal("3000.00"), currency),
            "total": Decimal("3000.00"),
            "total_display": _money(Decimal("3000.00"), currency),
        },
    ]

    sample_number_map = {
        "invoice": "INV-PREVIEW-001",
        "quotation": "EST-PREVIEW-001",
        "receipt": "RCT-PREVIEW-001",
        "purchase_order": "PO-PREVIEW-001",
        "statement": "STM-PREVIEW-001",
        "report": "RPT-PREVIEW-001",
    }
    sample_status_map = {
        "invoice": "issued",
        "quotation": "sent",
        "receipt": "paid",
        "purchase_order": "approved",
        "statement": "current",
        "report": "generated",
    }
    sample_due_label_map = {
        "invoice": "30 Jul 2026",
        "quotation": "02 Aug 2026",
        "receipt": "",
        "purchase_order": "31 Jul 2026",
        "statement": "31 Jul 2026",
        "report": "01 Jul 2026 to 31 Jul 2026",
    }
    notes_map = {
        "invoice": "Preview of how this invoice template will look for your tenant.",
        "quotation": "Preview estimate prepared for approval by your customer.",
        "receipt": "Preview receipt generated after payment confirmation.",
        "purchase_order": "Preview purchase order issued to a supplier.",
        "statement": "Preview customer account statement for the current billing cycle.",
        "report": "Preview of a centralized report template used by ERP reporting modules.",
    }

    if template.document_type == "receipt":
        sample_lines = [
            {
                "description": "Gross Weight",
                "quantity": 1,
                "unit_price_display": "",
                "total_display": "24,000 kg",
            },
            {
                "description": "Tare Weight",
                "quantity": 1,
                "unit_price_display": "",
                "total_display": "12,000 kg",
            },
            {
                "description": "Net Weight",
                "quantity": 1,
                "unit_price_display": "",
                "total_display": "12,000 kg",
            },
        ]

    report_context = {
        "title": "Transactions",
        "category": "operations",
        "category_label": "Operations Report",
        "date_range": "01 Jul 2026 to 31 Jul 2026",
        "row_count": 3,
        "summary": [
            {"label": "Transactions", "value": "152"},
            {"label": "Net Weight", "value": "220,577 kg"},
            {"label": "Approval Queue", "value": "4"},
            {"label": "Open Issues", "value": "2"},
        ],
        "filters": [
            {"label": "Branch", "value": "All branches"},
            {"label": "Operator", "value": "All operators"},
            {"label": "Status", "value": "Completed"},
            {"label": "Payment", "value": "All"},
            {"label": "From", "value": "01 Jul 2026"},
            {"label": "To", "value": "31 Jul 2026"},
        ],
        "columns": [
            {"key": "transaction", "label": "Transaction", "align": "left"},
            {"key": "vehicle", "label": "Vehicle", "align": "left"},
            {"key": "customer", "label": "Customer", "align": "left"},
            {"key": "operator", "label": "Operator", "align": "left"},
            {"key": "net_weight", "label": "Net Weight", "align": "right"},
        ],
        "display_rows": [
            [
                {"value": "00041", "align": "left"},
                {"value": "KDA 123A", "align": "left"},
                {"value": "Preview Customer Ltd", "align": "left"},
                {"value": "Main Cashier", "align": "left"},
                {"value": "14,200 kg", "align": "right"},
            ],
            [
                {"value": "00042", "align": "left"},
                {"value": "KDB 884X", "align": "left"},
                {"value": "Preview Customer Ltd", "align": "left"},
                {"value": "Night Operator", "align": "left"},
                {"value": "12,080 kg", "align": "right"},
            ],
            [
                {"value": "00043", "align": "left"},
                {"value": "KCC 912M", "align": "left"},
                {"value": "Walk-in Customer", "align": "left"},
                {"value": "Main Cashier", "align": "left"},
                {"value": "11,450 kg", "align": "right"},
            ],
        ],
    }

    context = {
        "branding": {
            "logo_url": _safe_logo_url(settings_obj, request),
            "primary_color": primary_color,
            "footer_text": footer_text,
        },
        "company": {
            "name": company_name,
            "email": company_email,
            "phone": company_phone,
            "currency": currency,
            "branch_name": "Head Office",
            "prepared_by": "Tenant Admin",
        },
        "customer": {
            "name": "Preview Customer Ltd",
            "email": "accounts@preview-customer.test",
            "phone": "+254 711 222 333",
        },
        "document": {
            "number": sample_number_map.get(template.document_type, "DOC-PREVIEW-001"),
            "status": sample_status_map.get(template.document_type, "draft"),
            "issue_date": "26 Jul 2026",
            "due_date": sample_due_label_map.get(template.document_type, ""),
            "currency": currency,
            "notes": notes_map.get(template.document_type, "Preview document."),
            "terms": "Payment due within 30 days.",
        },
        "lines": sample_lines,
        "report": report_context,
        "totals": {
            "subtotal": Decimal("12000.00"),
            "subtotal_display": _money(Decimal("12000.00"), currency),
            "tax": Decimal("1920.00"),
            "tax_display": _money(Decimal("1920.00"), currency),
            "discount": Decimal("0.00"),
            "discount_display": _money(Decimal("0.00"), currency),
            "total": Decimal("13920.00") if template.document_type != "receipt" else Decimal("1800.00"),
            "total_display": _money(Decimal("13920.00"), currency) if template.document_type != "receipt" else _money(Decimal("1800.00"), currency),
        },
        "generated_at": timezone.now(),
    }

    primary_color = context["branding"]["primary_color"] or "#E85D26"
    template_body = template.body_template or _default_body(template.document_type)
    stylesheet = template.stylesheet or _default_stylesheet(primary_color)
    rendered_body = _render_template_string(template_body, context)
    html = f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{context["document"]["number"]}</title>
    <style>{_brand_stylesheet(primary_color)}{stylesheet}</style>
  </head>
  <body>{rendered_body}</body>
</html>"""
    return RenderedDocument(html=html, template=template, settings=settings_obj)


def render_invoice_document(invoice, request=None):
    template, settings_obj = resolve_document_template(tenant=getattr(invoice, "tenant", None), document_type="invoice")
    context = _invoice_context(invoice, settings_obj, request=request)
    return render_business_document(
        tenant=getattr(invoice, "tenant", None),
        document_type="invoice",
        context=context,
        request=request,
    )


def render_estimate_document(estimate, request=None):
    template, settings_obj = resolve_document_template(tenant=getattr(estimate, "tenant", None), document_type="quotation")
    context = _estimate_context(estimate, settings_obj, request=request)
    return render_business_document(
        tenant=getattr(estimate, "tenant", None),
        document_type="quotation",
        context=context,
        request=request,
    )


def render_transaction_receipt(transaction, request=None):
    template, settings_obj = resolve_document_template(tenant=getattr(transaction, "tenant", None), document_type="receipt")
    context = _receipt_context(transaction, settings_obj, request=request)
    return render_business_document(
        tenant=getattr(transaction, "tenant", None),
        document_type="receipt",
        context=context,
        request=request,
    )


def render_purchase_order_document(purchase_order, request=None, tenant=None):
    resolved_tenant = tenant or getattr(getattr(getattr(purchase_order, "created_by", None), "tenant_profile", None), "tenant", None)
    _, settings_obj = resolve_document_template(tenant=resolved_tenant, document_type="purchase_order")
    context = _purchase_order_context(purchase_order, settings_obj, request=request)
    return render_business_document(
        tenant=resolved_tenant,
        document_type="purchase_order",
        context=context,
        request=request,
    )
