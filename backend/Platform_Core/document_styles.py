# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Distinct, table-based business layouts supported by HTML and PDF renderers."""
import re

STYLES = {
    "classic": ("Classic", "Traditional letterhead, serif headings and ruled tables."),
    "modern": ("Modern", "Bold banner, reversed header and a strong color accent."),
    "compact": ("Compact", "Smaller type and tight spacing for detailed documents."),
    "executive": ("Executive", "Large masthead, framed company details and formal totals."),
    "minimal": ("Minimal", "Centered letterhead, open spacing and light table rules."),
}


def template_style(template):
    if template.tenant_id is None:
        for key, (title, description) in STYLES.items():
            if template.name.endswith(" " + title):
                return key, description
    return "custom", "A layout created for your organization."


def apply_layout(layout, variant):
    layout = layout.replace('class="business-document"', f'class="business-document style-{variant}"', 1)
    match = re.search(r'<table class="heading"><tr>\s*<td class="identity">(.*?)</td>\s*<td class="document-reference">(.*?)</td>\s*</tr></table>', layout, re.S)
    if not match:
        return layout
    identity, reference = match.groups()
    if variant == "modern":
        header = '<table class="heading banner-heading"><tr><td class="document-reference">' + reference + '</td><td class="identity">' + identity + '</td></tr></table>'
    elif variant == "executive":
        title = re.search(r'<div class="document-title">(.*?)</div>', reference, re.S)
        masthead = '<div class="executive-masthead">' + (title.group(1) if title else '') + '</div>'
        reference = re.sub(r'<div class="document-title">.*?</div>', '', reference, count=1, flags=re.S)
        header = masthead + '<table class="heading executive-heading"><tr><td class="identity">' + identity + '</td><td class="document-reference">' + reference + '</td></tr></table>'
    elif variant == "minimal":
        header = '<table class="heading centered-heading"><tr><td class="identity">' + identity + '</td></tr><tr><td class="document-reference">' + reference + '</td></tr></table>'
    else:
        header = match.group(0)
    layout = layout[:match.start()] + header + layout[match.end():]
    totals = re.search(r'<table class="totals"><tr><td style="width:50%;"></td><td style="width:50%;">\s*<table>(.*?)</table>\s*</td></tr></table>', layout, re.S)
    if totals:
        rows = re.sub(r'(<tr[^>]*>)', r'\1<td class="totals-spacer" width="50%"></td>', totals.group(1))
        rows = rows.replace('<td>', '<td width="25%">').replace('<td class="num">', '<td class="num" width="25%">')
        layout = layout[:totals.start()] + '<table class="totals" width="100%">' + rows + '</table>' + layout[totals.end():]
    # The PDF renderer clears CSS cell padding when entering nested cells.
    # Its supported cellpadding attribute keeps dense tables legible in print.
    cell_padding = "4" if variant == "compact" else "6"
    layout = layout.replace('<table class="line-items"', f'<table cellpadding="{cell_padding}" class="line-items"')
    layout = layout.replace('<table>', '<table width="100%">')
    return layout


def stylesheet(variant):
    common = """
      .business-document { margin: 0; padding: 0; max-width: 900px; }
      td, th { padding: 6px; line-height: 12pt; }
      .totals .totals-spacer { border: 0; background-color: #ffffff; }
      .heading { margin-bottom: 12px; }
      .party { margin-bottom: 12px; }
      .line-items { margin-top: 10px; margin-bottom: 10px; }
      .line-items td, .line-items th { padding: 6pt 4pt; line-height: 12pt; }
      .notes { margin-top: 12px; padding-top: 8px; }
      .footer { margin-top: 12px; padding-top: 8px; }
      .report-summary td { padding: 10pt; background-color: #f4f6f8; border-bottom: 2px solid {{ branding.primary_color }}; }
      .report-metric { font-size: 16pt; font-weight: bold; padding-top: 5pt; }
      .report-filters { margin: 12pt 0; font-size: 9pt; }
      .report-filters td { padding: 4pt; }
    """
    variants = {
        "classic": """
          body { font-family: Times-Roman, Georgia, serif; }
          .company-name { font-family: Times-Roman, Georgia, serif; font-size: 19pt; }
          .heading { border-top: 1px solid #17202a; border-bottom: 3px double #17202a; }
          .heading td { padding-top: 12pt; padding-bottom: 12pt; }
          .document-title { font-family: Times-Roman, Georgia, serif; color: #17202a; }
          .line-items th { background-color: #ffffff; border-bottom: 2px solid #17202a; border-top: 1px solid #17202a; }
        """,
        "modern": """
          .banner-heading { background-color: #172c43; border: 0; border-top: 7pt solid {{ branding.primary_color }}; }
          .banner-heading td { padding: 16pt 12pt; color: #ffffff; }
          .banner-heading .identity { width: 54%; text-align: right; }
          .banner-heading .document-reference { width: 46%; text-align: left; }
          .banner-heading .company-name { font-size: 17pt; color: #ffffff; }
          .banner-heading .document-title { color: #ffffff; font-size: 27pt; }
          .banner-heading .muted, .banner-heading .invoice-status { color: #e3eaf2; }
          .line-items th { background-color: #edf1f6; color: #172c43; border: 0; }
          .total-row td, .invoice-totals .total-row td { background-color: #edf1f6; color: #172c43; }
        """,
        "compact": """
          body { font-family: Helvetica, Arial, sans-serif; font-size: 8pt; line-height: 10pt; }
          .heading { margin-bottom: 8pt; border-bottom: 1px solid #17202a; }
          .heading td { padding: 0 0 6pt; }
          .company-name { font-size: 12pt; line-height: 14pt; margin: 2pt 0; }
          .heading img { max-width: 55px; max-height: 32px; width: 55px; }
          .document-title { font-size: 19pt; line-height: 22pt; }
          .party { margin-bottom: 6pt; }
          .party td, .invoice-meta td { padding: 4pt; }
          .party .party-name { font-size: 9pt; }
          .line-items { margin-top: 4pt; margin-bottom: 6pt; }
          .line-items td, .line-items th { padding: 4pt 3pt; font-size: 8pt; line-height: 10pt; }
          .notes, .invoice-notes, .footer, .document-footer { margin-top: 6pt; padding-top: 5pt; }
        """,
        "executive": """
          .executive-masthead { font-size: 27pt; line-height: 32pt; font-weight: bold; color: {{ branding.primary_color }}; padding: 0 0 6pt; }
          .executive-heading { border: 1px solid #cbd3dc; border-left: 6pt solid {{ branding.primary_color }}; background-color: #f4f6f8; margin-bottom: 18pt; }
          .executive-heading td { padding: 8pt; }
          .executive-heading .identity { width: 60%; }
          .executive-heading .document-reference { width: 40%; }
          .line-items th { background-color: #ffffff; color: {{ branding.primary_color }}; border-bottom: 2px solid {{ branding.primary_color }}; }
          .total-row td, .invoice-totals .total-row td { border-top: 3px solid {{ branding.primary_color }}; background-color: #f4f6f8; }
        """,
        "minimal": """
          .centered-heading { border: 0; border-bottom: 1px solid #dce1e7; margin-bottom: 20pt; }
          .centered-heading .identity, .centered-heading .document-reference { width: 100%; text-align: center; padding: 5pt 0 10pt; }
          .centered-heading .company-name { font-size: 15pt; }
          .centered-heading .document-title { font-size: 22pt; color: #17202a; }
          .party, .invoice-meta { background-color: #ffffff; }
          .line-items th { background-color: #ffffff; border-top: 0; border-bottom: 1px solid #17202a; }
          .line-items td { border-bottom: 0; padding-top: 7pt; padding-bottom: 7pt; }
          .total-row td, .invoice-totals .total-row td { background-color: #ffffff; border-top: 1px solid #17202a; }
        """,
    }
    return common + variants[variant] + """
      @media screen and (max-width: 600px) {
        .business-document { padding: 12px; }
        .banner-heading .identity, .banner-heading .document-reference { width: 100%; text-align: left; }
        .executive-heading .identity, .executive-heading .document-reference { width: 100%; }
      }
    """


def report_body():
    return """
    <div class="business-document">
      <table class="heading"><tr><td class="identity">
        {% if branding.logo_url %}<div><img src="{{ branding.logo_url }}" alt="Company logo" width="90" style="max-width:90px;max-height:55px;object-fit:contain;" /></div>{% endif %}
        <div class="company-name">{{ company.name }}</div>
        <div class="muted">{{ report.category_label|default:'Operations Report' }}</div>
      </td><td class="document-reference">
        <div class="document-title">{{ report.title|default:'Report' }}</div>
        <div><strong>{{ document.number|default:'REPORT' }}</strong></div>
        <div>{{ report.date_range|default:'Current selection' }}</div>
        {% if company.prepared_by %}<div>Prepared by: {{ company.prepared_by }}</div>{% endif %}
      </td></tr></table>
      {% if report.summary %}<table class="report-summary"><tr>{% for item in report.summary %}<td><div class="label">{{ item.label }}</div><div class="report-metric">{{ item.value }}</div></td>{% endfor %}</tr></table>{% endif %}
      {% if report.filters %}<table class="report-filters">{% for item in report.filters %}<tr><td>{{ item.label }}</td><td>{{ item.value }}</td></tr>{% endfor %}</table>{% endif %}
      <table class="line-items" repeat="1"><thead><tr>{% for column in report.columns %}<th class="{% if column.align == 'right' %}num{% endif %}">{{ column.label }}</th>{% endfor %}</tr></thead><tbody>
      {% for row in report.display_rows %}<tr>{% for cell in row %}<td class="{% if cell.align == 'right' %}num{% endif %}">{{ cell.value|default_if_none:'-' }}</td>{% endfor %}</tr>{% empty %}<tr><td colspan="{{ report.columns|length }}">No rows matched the current filters.</td></tr>{% endfor %}
      </tbody></table>
      <div class="footer">{{ branding.footer_text|default:'Generated by SL-ERP' }}</div>
    </div>
    """
