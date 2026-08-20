from Platform_Core.models import DocumentTemplate


VARIANTS = [
    ("classic", "Classic"),
    ("modern", "Modern"),
    ("compact", "Compact"),
]

DOCUMENTS = [
    ("invoice", "Invoice"),
    ("quotation", "Estimate"),
    ("receipt", "Receipt"),
    ("purchase_order", "Purchase Order"),
    ("statement", "Statement"),
    ("report", "Report"),
]


def _stylesheet(variant: str):
    if variant == "modern":
        return """
          body{margin:0;background:#eef2ff;font-family:Arial,sans-serif;color:#0f172a}
          .doc{max-width:900px;margin:24px auto;background:white;padding:36px;border-radius:24px;box-shadow:0 20px 60px rgba(15,23,42,.12)}
          .hero{display:flex;justify-content:space-between;gap:24px;padding-bottom:20px;border-bottom:4px solid var(--brand-color,#2563eb)}
          .kicker{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--brand-color,#2563eb);font-weight:700}
          .title{font-size:34px;margin:6px 0}.pill{display:inline-block;padding:6px 12px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700}
          table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:12px 8px;border-bottom:1px solid #e2e8f0}th{text-transform:uppercase;font-size:11px;color:#64748b;text-align:left}
          .num{text-align:right}.summary{margin-left:auto;width:min(360px,100%);margin-top:24px;background:#f8fafc;border-radius:18px;padding:18px}
        """
    if variant == "compact":
        return """
          body{margin:0;background:#fff;font-family:'Courier New',monospace;color:#111827}
          .doc{max-width:760px;margin:12px auto;padding:18px;border:2px solid #111827}
          .hero{display:flex;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:2px dashed #111827}
          .kicker{font-size:10px;letter-spacing:.28em;text-transform:uppercase;font-weight:700}
          .title{font-size:26px;margin:4px 0}.pill{display:inline-block;padding:4px 10px;border:1px solid #111827;font-size:11px;font-weight:700}
          table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px 6px;border-bottom:1px dashed #9ca3af}th{text-transform:uppercase;font-size:10px;text-align:left}
          .num{text-align:right}.summary{margin-left:auto;width:min(320px,100%);margin-top:18px;border:1px solid #111827;padding:12px}
        """
    return """
      body{margin:0;background:#f8fafc;font-family:Georgia,serif;color:#0f172a}
      .doc{max-width:920px;margin:24px auto;background:#fff;padding:40px;border:1px solid #cbd5e1}
      .hero{display:flex;justify-content:space-between;gap:24px;padding-bottom:20px;border-bottom:3px solid var(--brand-color,#0f766e)}
      .kicker{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#475569;font-weight:700}
      .title{font-size:32px;margin:6px 0}.pill{display:inline-block;padding:5px 12px;border:1px solid #cbd5e1;background:#f8fafc;font-size:12px;font-weight:700}
      table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:12px 8px;border-bottom:1px solid #e2e8f0}th{text-transform:uppercase;font-size:11px;color:#64748b;text-align:left}
      .num{text-align:right}.summary{margin-left:auto;width:min(360px,100%);margin-top:24px;border:1px solid #e2e8f0;padding:18px}
    """


def _body(document_label: str, variant: str):
    if document_label == "Report":
        return f"""
          <div class="doc">
            <div class="hero">
              <div>
                {{% if branding.logo_url %}}<div style="margin-bottom:12px"><img src="{{{{ branding.logo_url }}}}" alt="logo" style="max-width:88px;max-height:88px;object-fit:contain"/></div>{{% endif %}}
                <div class="kicker">{{{{ company.name|default:'SL-ERP' }}}}</div>
                <div class="title">{{{{ report.title|default:'Report' }}}}</div>
                <div style="font-size:14px;color:#64748b;">{{{{ report.category_label|default:'Operations Report' }}}}</div>
              </div>
              <div style="min-width:220px;text-align:right">
                <div class="pill">{{{{ document.status|default:'generated'|title }}}}</div>
                <div style="margin-top:16px;font-size:13px">
                  <div><strong>Report ID:</strong> {{{{ document.number|default:'REPORT' }}}}</div>
                  <div><strong>Date Range:</strong> {{{{ report.date_range|default:'Current selection' }}}}</div>
                  <div><strong>Prepared By:</strong> {{{{ company.prepared_by|default:'Tenant Admin' }}}}</div>
                </div>
              </div>
            </div>
            {{% if report.summary %}}
              <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:24px">
                {{% for item in report.summary %}}
                  <div style="border:1px solid #e2e8f0;padding:16px;border-radius:16px">
                    <div class="kicker">{{{{ item.label }}}}</div>
                    <div style="margin-top:10px;font-size:24px;font-weight:700">{{{{ item.value }}}}</div>
                  </div>
                {{% endfor %}}
              </div>
            {{% endif %}}
            {{% if report.filters %}}
              <div style="border:1px solid #e2e8f0;padding:16px;border-radius:16px;margin-top:24px">
                <div class="kicker">Applied Filters</div>
                <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:16px">
                  {{% for item in report.filters %}}
                    <div>
                      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#64748b">{{{{ item.label }}}}</div>
                      <div style="margin-top:6px;font-weight:600">{{{{ item.value }}}}</div>
                    </div>
                  {{% endfor %}}
                </div>
              </div>
            {{% endif %}}
            <table>
              <thead>
                <tr>
                  {{% for column in report.columns %}}
                    <th class="{{% if column.align == 'right' %}}num{{% endif %}}">{{{{ column.label }}}}</th>
                  {{% endfor %}}
                </tr>
              </thead>
              <tbody>
                {{% for row in report.display_rows %}}
                  <tr>
                    {{% for cell in row %}}
                      <td class="{{% if cell.align == 'right' %}}num{{% endif %}}">{{{{ cell.value|default:'—' }}}}</td>
                    {{% endfor %}}
                  </tr>
                {{% empty %}}
                  <tr><td colspan="{{{{ report.columns|length }}}}" style="text-align:center;color:#64748b">No rows matched the current filters.</td></tr>
                {{% endfor %}}
              </tbody>
            </table>
            <div style="margin-top:26px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">{{{{ branding.footer_text|default:'Generated by SL-ERP' }}}}</div>
          </div>
        """

    accent = "Outstanding" if document_label in {"Invoice", "Statement"} else "Total"
    return f"""
      <div class="doc">
        <div class="hero">
          <div>
            {{% if branding.logo_url %}}<div style="margin-bottom:12px"><img src="{{{{ branding.logo_url }}}}" alt="logo" style="max-width:88px;max-height:88px;object-fit:contain"/></div>{{% endif %}}
            <div class="kicker">{{{{ company.name|default:'SL-ERP' }}}}</div>
            <div class="title">{document_label}</div>
            <div style="font-size:14px;color:#64748b;">{{{{ document.number }}}}</div>
          </div>
          <div style="min-width:220px;text-align:right">
            <div class="pill">{{{{ document.status|default:'draft'|title }}}}</div>
            <div style="margin-top:16px;font-size:13px">
              <div><strong>Date:</strong> {{{{ document.issue_date|default:'-' }}}}</div>
              <div><strong>Due / Needed:</strong> {{{{ document.due_date|default:'-' }}}}</div>
              <div><strong>Currency:</strong> {{{{ document.currency|default:'KES' }}}}</div>
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:24px">
          <div style="border:1px solid #e2e8f0;padding:16px">
            <div class="kicker">Counterparty</div>
            <div style="font-weight:700;margin-top:10px">{{{{ customer.name|default:'Walk-in Customer' }}}}</div>
            {{% if customer.email %}}<div>{{{{ customer.email }}}}</div>{{% endif %}}
            {{% if customer.phone %}}<div>{{{{ customer.phone }}}}</div>{{% endif %}}
          </div>
          <div style="border:1px solid #e2e8f0;padding:16px">
            <div class="kicker">Prepared By</div>
            <div style="font-weight:700;margin-top:10px">{{{{ company.name|default:'SL-ERP' }}}}</div>
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
              <tr><td colspan="4" style="text-align:center;color:#64748b">No line items.</td></tr>
            {{% endfor %}}
          </tbody>
        </table>
        <div class="summary">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Subtotal</span><strong>{{{{ totals.subtotal_display }}}}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Tax</span><strong>{{{{ totals.tax_display }}}}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Discount</span><strong>{{{{ totals.discount_display }}}}</strong></div>
          <div style="display:flex;justify-content:space-between;border-top:2px solid #0f172a;padding-top:10px;font-size:18px"><span>{accent}</span><strong>{{{{ totals.total_display }}}}</strong></div>
        </div>
        {{% if document.notes %}}<div style="margin-top:24px"><div class="kicker">Notes</div><div style="margin-top:10px">{{{{ document.notes|linebreaksbr }}}}</div></div>{{% endif %}}
        {{% if document.terms %}}<div style="margin-top:20px"><div class="kicker">Terms</div><div style="margin-top:10px">{{{{ document.terms|linebreaksbr }}}}</div></div>{{% endif %}}
        <div style="margin-top:26px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">{{{{ branding.footer_text|default:'Generated by SL-ERP' }}}}</div>
      </div>
    """


def ensure_shared_document_template_library():
    created = 0
    for document_type, document_label in DOCUMENTS:
        for index, (variant_key, variant_label) in enumerate(VARIANTS):
            name = f"{document_label} {variant_label}"
            _, was_created = DocumentTemplate.objects.get_or_create(
                tenant=None,
                document_type=document_type,
                name=name,
                defaults={
                    "engine": "html",
                    "is_default": index == 0,
                    "is_active": True,
                    "subject_template": f"{document_label} {{{{ document.number }}}}",
                    "body_template": _body(document_label, variant_key),
                    "stylesheet": _stylesheet(variant_key),
                },
            )
            if was_created:
                created += 1
    return created
