"""Personal payslip documents from finalized payroll records."""
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def payslip_pdf(record, employee_profile=None, request=None):
    tenant = record.period.tenant
    currency = tenant.default_currency or "KES"
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
        topMargin=20*mm, bottomMargin=22*mm, title=f"Payslip - {record.period.name}", author=tenant.name)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="PayslipCompany", fontName="Helvetica-Bold", fontSize=18, leading=23, spaceAfter=8))
    styles.add(ParagraphStyle(name="PayslipLabel", fontName="Helvetica", fontSize=9, leading=13, textColor=colors.HexColor("#64748b")))
    styles.add(ParagraphStyle(name="PayslipValue", fontName="Helvetica", fontSize=11, leading=16))
    styles.add(ParagraphStyle(name="PayslipAmount", parent=styles["PayslipValue"], alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name="PayslipNet", fontName="Helvetica-Bold", fontSize=14, leading=20, alignment=TA_RIGHT, textColor=colors.HexColor("#0f172a")))
    def text(value, style="PayslipValue"):
        return Paragraph(escape(str(value or "")), styles[style])
    def money(value, style="PayslipAmount"):
        return text(f"{currency} {value:,.2f}", style)
    name = (employee_profile.full_name if employee_profile else "") or record.employee.get_full_name() or record.employee.username
    employee_number = employee_profile.employee_number if employee_profile else record.employee.username
    period = record.period
    story = [text(tenant.legal_name or tenant.name, "PayslipCompany")]
    contact = " | ".join(value for value in [tenant.contact_email, tenant.contact_phone] if value)
    if contact:
        story.append(text(contact, "PayslipLabel"))
    from Platform_Core.documents import _get_settings, organization_document_details
    issuer = organization_document_details(_get_settings(tenant))
    for line in issuer["address"].splitlines():
        if line.strip():
            story.append(text(line, "PayslipLabel"))
    if issuer["website"]:
        story.append(text(issuer["website"], "PayslipLabel"))
    if issuer["tax_number"]:
        story.append(text(f'Tax ID / PIN: {issuer["tax_number"]}', "PayslipLabel"))
    story.extend([Spacer(1, 12*mm), text("PAYSLIP", "Heading1"), text(period.name, "Heading2"), Spacer(1, 6*mm)])
    details = Table([
        [text("EMPLOYEE", "PayslipLabel"), text("PAY PERIOD", "PayslipLabel")],
        [text(name), text(f"{period.period_start:%d %b %Y} - {period.period_end:%d %b %Y}")],
        [text("EMPLOYEE NUMBER", "PayslipLabel"), text("PAYSLIP REFERENCE", "PayslipLabel")],
        [text(employee_number), text(f"PAY-{record.pk:06d}")],
    ], colWidths=[document.width/2]*2)
    details.setStyle(TableStyle([("VALIGN", (0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),9)]))
    story.extend([details, Spacer(1,8*mm)])
    gross = record.basic_pay + record.allowances
    rows = [[text("PAY DETAILS", "PayslipLabel"), text("AMOUNT", "PayslipLabel")],
        [text("Basic pay"), money(record.basic_pay)],
        [text("Allowances"), money(record.allowances)],
        [text("Gross pay"), money(gross)],
        [text("Deductions"), money(record.deductions)],
        [text("NET PAY", "Heading3"), money(record.net_pay, "PayslipNet")]]
    amounts = Table(rows, colWidths=[document.width*.52,document.width*.48], repeatRows=1)
    amounts.setStyle(TableStyle([
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),12),("BOTTOMPADDING",(0,0),(-1,-1),12),
        ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#f1f5f9")),
        ("LINEBELOW",(0,0),(-1,-2),.5,colors.HexColor("#e2e8f0")),
        ("BACKGROUND",(0,-1),(-1,-1),colors.HexColor("#f1f5f9")),
        ("LINEABOVE",(0,-1),(-1,-1),1,colors.HexColor("#0f172a")),
    ]))
    story.extend([amounts, Spacer(1,8*mm),text("This payslip reflects the recorded amounts for the completed payroll period.", "PayslipLabel")])
    from Platform_Core.printing import print_qr_codes_enabled, document_reference, qr_png
    if print_qr_codes_enabled(tenant):
        reference = document_reference(tenant=tenant, kind="payslip", number=f"PAY-{record.pk:06d}", path=f"/hr/my-payslips?payslip={record.pk}", request=request)
        qr = Image(BytesIO(qr_png(reference)), width=22*mm, height=22*mm)
        qr.hAlign = "LEFT"
        qr_row = Table([[qr, text("Scan to view the payslip reference and pay period.", "PayslipLabel")]], colWidths=[28*mm, document.width-28*mm])
        qr_row.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),0)]))
        story.extend([Spacer(1,4*mm),qr_row])
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica",8)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(20*mm,13*mm,"Confidential - personal payslip")
        canvas.drawRightString(A4[0]-20*mm,13*mm,f"Page {doc.page}")
        canvas.restoreState()
    document.build(story,onFirstPage=footer,onLaterPages=footer)
    return output.getvalue()
