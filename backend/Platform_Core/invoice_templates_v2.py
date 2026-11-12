# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Frozen previous invoice layouts for exact, customization-safe upgrades."""
from .professional_templates import stylesheet as base_stylesheet


def stylesheet(variant):
    base = base_stylesheet(variant).replace("@page { size: a4; margin: 18mm 16mm 20mm; }", "")
    return base + """
      @page {
        size: a4; margin: 16mm 16mm 16mm;
        @frame invoice_footer {
          -pdf-frame-content: invoice-page-footer;
          left: 16mm; right: 16mm; bottom: 5mm; height: 7mm;
        }
      }
      body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; line-height: 13pt; }
      .business-document { padding: 0; }
      .heading { margin-bottom: 12pt; }
      .heading td { padding: 0 0 12pt; }
      .identity { width: 62%; }
      .document-reference { width: 38%; }
      .company-name { font-size: 15pt; line-height: 18pt; margin: 6pt 0; }
      .document-title { color: #17202a; font-size: 26pt; line-height: 30pt; }
      .invoice-number { font-size: 11pt; line-height: 16pt; }
      .invoice-status { font-size: 9pt; color: #5b6573; margin-top: 4pt; }
      .invoice-meta { margin: 0 0 14pt; background-color: #f4f6f8; }
      .invoice-meta td { width: 25%; padding: 9pt; }
      .invoice-meta .caption, .label { color: #5b6573; font-size: 8pt; font-weight: bold; text-transform: uppercase; }
      .invoice-meta strong { font-size: 9pt; }
      .party { background-color: #ffffff; margin: 0 0 6pt; }
      .party td { padding: 4pt 12pt 8pt 0; }
      .party .bill-to { width: 62%; }
      .party .billing-contact { width: 38%; }
      .party .party-name { font-size: 11pt; line-height: 15pt; margin-bottom: 5pt; }
      .line-items { margin-top: 4pt; margin-bottom: 10pt; }
      .line-items th, .line-items td { padding: 6pt 4pt; font-size: 8pt; line-height: 11pt; }
      .line-items .row-number { width: 3%; color: #5b6573; }
      .line-items .description { width: 29%; }
      .line-items .quantity { width: 5%; }
      .line-items .price, .line-items .net, .line-items .gross { width: 16%; }
      .line-items .tax { width: 15%; }
      .tax-summary-title { margin-top: 6pt; margin-bottom: 4pt; }
      .invoice-tax-summary { margin-bottom: 14pt; }
      .invoice-tax-summary th, .invoice-tax-summary td { padding: 6pt 4pt; font-size: 8.5pt; line-height: 12pt; }
      .invoice-tax-summary .tax-summary-total td { font-weight: bold; border-top: 1px solid #c8d0d8; }
      .invoice-settlement > tbody > tr > td, .invoice-settlement > tr > td { padding: 0; }
      .invoice-payment { width: 48%; }
      .invoice-totals { width: 52%; }
      .invoice-payment .payment-text { font-size: 9pt; line-height: 13pt; }
      .invoice-totals td { padding: 5pt 4pt; }
      .invoice-totals .total-row td { background-color: #f4f6f8; font-size: 11pt; }
      .invoice-notes { margin-top: 10pt; font-size: 9pt; line-height: 12pt; }
      .prepared-by { margin-top: 10pt; font-size: 8pt; color: #5b6573; }
      .document-footer { margin-top: 10pt; padding-top: 8pt; border-top: 1px solid #e1e5ea; font-size: 8pt; color: #5b6573; }
      #invoice-page-footer { color: #5b6573; font-size: 8pt; line-height: 10pt; text-align: right; }
      #invoice-page-footer td { padding: 3pt 0 0; font-size: 8pt; }
      @media screen and (max-width: 600px) {
        .invoice-meta td { padding: 5px; overflow-wrap: anywhere; }
        .invoice-meta strong { font-size: 8pt; }
        .invoice-settlement, .invoice-settlement > tbody, .invoice-settlement > tbody > tr, .invoice-settlement > tbody > tr > td { display: block; width: 100%; }
        .invoice-totals { margin-top: 16px; }
      }
    """


def body(variant, *, include_preparer=False):
    layout = """
    <div class="business-document">
      <table class="heading"><tr>
        <td class="identity">
          {% if branding.logo_url %}<div><img src="{{ branding.logo_url }}" alt="Company logo" width="90" style="max-width:90px;max-height:55px;object-fit:contain;" /></div>{% endif %}
          <div class="company-name">{{ company.name }}</div>
          {% if company.address %}<div class="muted">{{ company.address|linebreaksbr }}</div>{% endif %}
          {% if company.email %}<div class="muted">{{ company.email }}</div>{% endif %}
          {% if company.phone %}<div class="muted">{{ company.phone }}</div>{% endif %}
          {% if company.website %}<div class="muted">{{ company.website }}</div>{% endif %}
          {% if company.tax_number %}<div class="muted">Tax ID / PIN: {{ company.tax_number }}</div>{% endif %}
        </td>
        <td class="document-reference">
          <div class="document-title">INVOICE</div>
          <div class="invoice-number"><strong>{{ document.number }}</strong></div>
          <div class="invoice-status">{{ document.status|upper }}</div>
        </td>
      </tr></table>
      <table class="invoice-meta"><tr>
        <td><span class="caption">Invoice date</span><br/><strong>{{ document.issue_date|default:'-' }}</strong></td>
        <td><span class="caption">Payment due</span><br/><strong>{{ document.due_date|default:'On receipt' }}</strong></td>
        <td><span class="caption">Currency</span><br/><strong>{{ document.currency }}</strong></td>
        <td><span class="caption">Customer reference</span><br/><strong>{{ document.customer_reference|default:'-' }}</strong></td>
      </tr></table>
      <table class="party"><tr>
        <td class="bill-to"><div class="label">Bill to</div>
          <div class="party-name"><strong>{{ customer.name }}</strong></div>
          {% if customer.address %}<div>{{ customer.address|linebreaksbr }}</div>{% endif %}
          {% if customer.tax_number %}<div style="margin-top:4pt;">Tax ID / PIN: {{ customer.tax_number }}</div>{% endif %}
        </td>
        <td class="billing-contact"><div class="label">Billing contact</div>
          {% if customer.contact_name %}<div><strong>{{ customer.contact_name }}</strong></div>{% endif %}
          {% if customer.email %}<div>{{ customer.email }}</div>{% endif %}
          {% if customer.phone %}<div>{{ customer.phone }}</div>{% endif %}
          {% if not customer.contact_name and not customer.email and not customer.phone %}<div class="muted">-</div>{% endif %}
        </td>
      </tr></table>
      <table class="line-items" repeat="1"><thead><tr>
        <th width="3%" class="row-number">#</th><th width="29%" class="description">Description</th><th width="5%" class="quantity num">Qty</th>
        <th width="16%" class="price num">Unit price<br/>({{ document.unit_price_basis }})</th>
        <th width="16%" class="net num">Amount<br/>excl. tax</th>
        <th width="15%" class="tax num">Tax<br/>amount</th>
        <th width="16%" class="gross num">Amount<br/>incl. tax</th>
      </tr></thead><tbody>
        {% for line in lines %}<tr>
          <td class="row-number">{{ forloop.counter }}</td>
          <td class="description">{{ line.description|linebreaksbr }}</td><td class="quantity num">{{ line.quantity|floatformat:'-3' }}</td>
          <td class="price num">{{ line.entered_unit_price_display }}</td>
          <td class="net num">{{ line.net_amount_display }}</td>
          <td class="tax num">{{ line.line_tax_display }}</td>
          <td class="gross num">{{ line.gross_amount_display }}</td>
        </tr>{% empty %}<tr><td colspan="7">No line items.</td></tr>{% endfor %}
      </tbody></table>
      <div class="label tax-summary-title">Tax summary</div>
      <table cellpadding="3" class="invoice-tax-summary" repeat="1"><thead><tr>
        <th width="28%">Tax rate</th><th width="24%" class="num">Amount excl. tax</th>
        <th width="24%" class="num">Tax amount</th><th width="24%" class="num">Amount incl. tax</th>
      </tr></thead><tbody>
        {% for group in tax_summary %}<tr>
          <td>{{ group.label }}</td><td class="num">{{ group.net_display }}</td>
          <td class="num">{{ group.tax_display }}</td><td class="num">{{ group.gross_display }}</td>
        </tr>{% endfor %}
        {% if tax_summary|length > 1 %}<tr class="tax-summary-total"><td>Items total</td><td class="num">{{ totals.subtotal_display }}</td>
          <td class="num">{{ totals.tax_display }}</td><td class="num">{{ totals.items_gross_display }}</td></tr>{% endif %}
      </tbody></table>
      <table class="invoice-settlement"><tr>
        <td class="invoice-payment">
          {% if document.payment_instructions %}<div class="label">Payment instructions</div><div class="payment-text">{{ document.payment_instructions|linebreaksbr }}</div>{% endif %}
          {% if document.prices_include_tax %}<div class="muted">Tax is included in the line prices. See the tax summary above.</div>{% endif %}
          <div class="muted" style="margin-top:8pt;">Please quote {{ document.number }} with your payment.</div>
        </td>
        <td class="invoice-totals"><table>
          <tr><td>{{ totals.items_subtotal_label }}</td><td class="num">{{ totals.items_subtotal_display }}</td></tr>
          {% if not document.prices_include_tax %}<tr><td>{{ totals.tax_label }}</td><td class="num">{{ totals.tax_display }}</td></tr>{% endif %}
          {% for charge in charges %}<tr><td>{{ charge.name }}</td><td class="num">{{ charge.amount_display }}</td></tr>{% endfor %}
          {% if totals.unitemized_charge %}<tr><td>Other charges</td><td class="num">{{ totals.unitemized_charge_display }}</td></tr>{% endif %}
          <tr class="total-row"><td>Invoice total</td><td class="num">{{ totals.total_display }}</td></tr>
        </table></td>
      </tr></table>
      {% if document.notes %}<div class="invoice-notes"><strong class="label">Notes</strong><br/>{{ document.notes|linebreaksbr }}</div>{% endif %}
      {% if document.terms %}<div class="invoice-notes"><strong class="label">Terms &amp; conditions</strong><br/>{{ document.terms|linebreaksbr }}</div>{% endif %}
      {% if company.prepared_by %}<div class="prepared-by">Prepared by: <strong>{{ company.prepared_by }}</strong>{% if company.prepared_by_email %} | {{ company.prepared_by_email }}{% endif %}</div>{% endif %}
      <div class="document-footer">{{ branding.footer_text|default:'Thank you for your business.' }}</div>
    </div>
    <div id="invoice-page-footer">{{ document.number }} | Page <pdf:pagenumber /> of <pdf:pagecount /></div>
    """
    if not include_preparer:
        layout = layout.replace('      {% if company.prepared_by %}<div class="prepared-by">Prepared by: <strong>{{ company.prepared_by }}</strong>{% if company.prepared_by_email %} | {{ company.prepared_by_email }}{% endif %}</div>{% endif %}\n', "")
    return layout


def previous_print_layout(variant):
    from .invoice_templates_v1 import previous_print_layout as previous
    return previous(variant)


def alignment_stylesheet():
    return """
      .heading .identity, .heading .document-reference { padding-top: 12pt; padding-bottom: 12pt; }
      .heading .document-title { line-height: 32pt; margin: 0 0 6pt; }
      .banner-heading .identity, .banner-heading .document-reference { padding: 16pt 12pt; }
      .centered-heading .identity, .centered-heading .document-reference { padding: 6pt 0; }
      .invoice-meta td { vertical-align: top; padding: 5pt; }
      .heading { margin-bottom: 8pt; }
      .invoice-meta { margin-bottom: 8pt; }
      .party { margin-bottom: 6pt; }
      .line-items { margin-top: 4pt; margin-bottom: 6pt; }
      .line-items td, .line-items th { font-size: 8pt; line-height: 10pt; }
      .invoice-tax-summary { margin-bottom: 8pt; }
      .invoice-tax-summary td, .invoice-tax-summary th { padding: 3pt; font-size: 8pt; line-height: 10pt; }
      .heading .identity, .heading .document-reference { padding-top: 8pt; padding-bottom: 8pt; }
      .banner-heading .identity, .banner-heading .document-reference { padding: 10pt 12pt; }
      .centered-heading .identity, .centered-heading .document-reference { padding: 4pt 0; }
      .centered-heading .muted { font-size: 8pt; line-height: 10pt; }
      .centered-heading .company-name { font-size: 14pt; line-height: 16pt; margin: 2pt 0; }
      .centered-heading .document-title { font-size: 19pt; line-height: 22pt; margin: 0 0 2pt; }
      .centered-heading .invoice-number { font-size: 10pt; line-height: 12pt; }
      .centered-heading .invoice-status { font-size: 8pt; line-height: 10pt; margin: 2pt 0; }
      .heading .muted { font-size: 8pt; line-height: 10pt; }
      .party td { line-height: 11pt; }
      .invoice-notes { font-size: 8pt; line-height: 10pt; margin-top: 6pt; }
      .invoice-settlement td { vertical-align: top; }
      /* Keep each total/QR block intact without chaining the whole closing
         section onto a new page. Notes can flow across page boundaries. */
      .invoice-settlement, .invoice-notes, .prepared-by, .print-document-qr { -pdf-keep-with-next: false; }
      .tax-summary-title, .print-document-qr { -pdf-keep-with-next: true; }
      .document-footer { margin-top: 3pt; padding-top: 3pt; font-size: 7.5pt; line-height: 9pt; }
      .invoice-totals table { width: 100%; }
      .invoice-totals .num { text-align: right; white-space: nowrap; }
    """
