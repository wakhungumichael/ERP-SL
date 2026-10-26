# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""A4 business layouts shared by browser previews and PDF exports."""


def stylesheet(variant):
    font = "Times-Roman, Georgia, serif" if variant == "classic" else "Helvetica, Arial, sans-serif"
    padding = "6px" if variant == "compact" else "10px"
    return """
      @page { size: a4; margin: 18mm 16mm 20mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #ffffff; color: #17202a; font-family: FONT; font-size: 10pt; line-height: 14pt; }
      div, p { margin: 0; padding: 0; }
      .business-document { max-width: 900px; margin: 24px auto; padding: 24px; }
      table { width: 100%; border-collapse: collapse; }
      td, th { vertical-align: top; padding: PAD; line-height: 14pt; }
      .heading { border-bottom: 3px solid {{ branding.primary_color }}; margin-bottom: 20px; }
      .identity { width: 58%; }
      .document-reference { width: 42%; text-align: right; }
      .company-name { font-size: 17pt; font-weight: bold; margin-bottom: 5px; }
      .document-title { font-size: 25pt; font-weight: bold; color: {{ branding.primary_color }}; margin-bottom: 6px; }
      .muted { color: #5b6573; font-size: 9pt; }
      .label { color: {{ branding.primary_color }}; font-weight: bold; font-size: 9pt; text-transform: uppercase; margin-bottom: 6px; }
      .party { background-color: #f4f6f8; margin-bottom: 20px; }
      .party td { width: 50%; }
      .line-items { margin-top: 16px; margin-bottom: 18px; }
      .line-items th { border-top: 2px solid {{ branding.primary_color }}; border-bottom: 1px solid #aab2bd; background-color: #f4f6f8; font-size: 9pt; text-align: left; }
      .line-items td { border-bottom: 1px solid #e1e5ea; }
      .line-items .description { width: 43%; overflow-wrap: anywhere; }
      .line-items .quantity { width: 12%; }
      .line-items .amount { width: 23%; }
      .num { text-align: right; }
      .totals td { padding: 5px 8px; }
      .total-row td { border-top: 2px solid {{ branding.primary_color }}; font-size: 12pt; font-weight: bold; }
      .notes { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e1e5ea; }
      .footer { margin-top: 24px; border-top: 1px solid #e1e5ea; padding-top: 10px; color: #5b6573; font-size: 8pt; }
      .heading div, .party div, .notes div { margin: 0; padding: 0; border: 0; }
      @media print { .business-document { margin: 0; padding: 0; max-width: none; } }
      @media screen and (max-width: 600px) {
        .business-document { margin: 0; padding: 12px; }
        .heading, .heading tbody, .heading tr, .heading td, .party, .party tbody, .party tr, .party td { display: block; width: 100%; }
        .document-reference { text-align: left; }
        .line-items td, .line-items th { padding: 6px 3px; font-size: 8pt; overflow-wrap: anywhere; }
      }
    """.replace("FONT", font).replace("PAD", padding) + (
        ".heading { border-top: 7px solid {{ branding.primary_color }}; } .company-name { font-size: 20pt; }"
        if variant == "modern" else ""
    )


def body(label, variant):
    party_label = "Supplier" if label == "Purchase Order" else "Customer"
    date_label = "Valid Until" if label == "Estimate" else "Due Date"
    total_label = "Outstanding Balance" if label == "Statement" else "Total"
    layout = """
    <div class="business-document">
      <table class="heading"><tr>
        <td class="identity">
          {% if branding.logo_url %}<div><img src="{{ branding.logo_url }}" alt="Company logo" width="90" style="max-width:90px;max-height:75px;object-fit:contain;" /></div>{% endif %}
          <div class="company-name">{{ company.name }}</div>
          {% if company.email %}<div class="muted">{{ company.email }}</div>{% endif %}
          {% if company.phone %}<div class="muted">{{ company.phone }}</div>{% endif %}
        </td>
        <td class="document-reference">
          <div class="document-title">DOCUMENT_LABEL</div>
          <div><strong>{{ document.number }}</strong></div>
          <div class="muted">{{ document.status|title }}</div>
          <div style="margin-top:10px;">Date: {{ document.issue_date|default:'—' }}</div>
          {% if document.due_date %}<div>DATE_LABEL: {{ document.due_date }}</div>{% endif %}
          <div>Currency: {{ document.currency|default:'KES' }}</div>
        </td>
      </tr></table>
      <table class="party"><tr>
        <td><div class="label">PARTY_LABEL</div><strong>{{ customer.name|default:'Walk-in Customer' }}</strong>
          {% if customer.email %}<div>{{ customer.email }}</div>{% endif %}
          {% if customer.phone %}<div>{{ customer.phone }}</div>{% endif %}
        </td>
        <td><div class="label">Issued By</div><strong>{{ company.name }}</strong>
          {% if company.address %}<div>{{ company.address }}</div>{% endif %}
          {% if company.email %}<div>{{ company.email }}</div>{% endif %}
        </td>
      </tr></table>
      <table class="line-items" repeat="1"><thead><tr>
        <th class="description">Description</th><th class="quantity num">Qty</th><th class="amount num">Unit Price</th><th class="amount num">Amount</th>
      </tr></thead><tbody>
        {% for line in lines %}<tr>
          <td class="description">{{ line.description|linebreaksbr }}</td><td class="quantity num">{{ line.quantity|floatformat:2 }}</td>
          <td class="amount num">{{ line.unit_price_display }}</td><td class="amount num">{{ line.total_display }}</td>
        </tr>{% empty %}<tr><td colspan="4">No line items.</td></tr>{% endfor %}
      </tbody></table>
      <table class="totals"><tr><td style="width:50%;"></td><td style="width:50%;">
        <table>
          <tr><td>Subtotal</td><td class="num">{{ totals.subtotal_display }}</td></tr>
          <tr><td>Tax</td><td class="num">{{ totals.tax_display }}</td></tr>
          <tr><td>Discount</td><td class="num">{{ totals.discount_display }}</td></tr>
          <tr class="total-row"><td>TOTAL_LABEL</td><td class="num">{{ totals.total_display }}</td></tr>
        </table>
      </td></tr></table>
      {% if document.notes %}<div class="notes"><div class="label">Notes</div>{{ document.notes|linebreaksbr }}</div>{% endif %}
      {% if document.terms %}<div class="notes"><div class="label">Terms &amp; Conditions</div>{{ document.terms|linebreaksbr }}</div>{% endif %}
      <div class="footer">{{ branding.footer_text|default:'Thank you for your business.' }}</div>
    </div>
    """.replace("DOCUMENT_LABEL", label).replace("PARTY_LABEL", party_label).replace("DATE_LABEL", date_label).replace("TOTAL_LABEL", total_label)
    if label == "Statement":
        start = layout.index('      <table class="line-items"')
        end = layout.index('      <table class="totals"', start)
        layout = layout[:start] + """
          {% if statement_invoices %}
          <table class="line-items" repeat="1"><thead><tr><th>Invoice / Date</th><th>Due Date</th><th class="num">Invoiced</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>
            {% for invoice in statement_invoices %}<tr><td>{{ invoice.number }}<br/>{{ invoice.date }}</td><td>{{ invoice.due_date|default:'—' }}</td><td class="num">{{ invoice.total }}</td><td class="num">{{ invoice.paid }}</td><td class="num">{{ invoice.balance }}</td></tr>{% endfor %}
          </tbody></table>
          {% endif %}
          {% if statement_aging %}<div class="label">Aging Summary</div><table class="line-items"><tr>{% for item in statement_aging %}<th>{{ item.label }}</th>{% endfor %}</tr><tr>{% for item in statement_aging %}<td>{{ item.amount }}</td>{% endfor %}</tr></table>{% endif %}
          {% if statement_payments %}<div class="label">Recent Payments</div><table class="line-items" repeat="1"><thead><tr><th>Date</th><th>Reference</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>{% for payment in statement_payments %}<tr><td>{{ payment.date }}</td><td>{{ payment.reference }}</td><td>{{ payment.method }}</td><td class="num">{{ payment.amount }}</td></tr>{% endfor %}</tbody></table>{% endif %}
        """ + layout[end:]
        layout = layout.replace('<tr><td>Tax</td><td class="num">{{ totals.tax_display }}</td></tr>', '<tr><td>Total Paid</td><td class="num">{{ totals.paid_display }}</td></tr>').replace('<tr><td>Discount</td><td class="num">{{ totals.discount_display }}</td></tr>', '')
    return layout
