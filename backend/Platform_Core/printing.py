"""Platform-wide QR policy for generated printouts. Never encode private amounts."""
import base64
from io import BytesIO
from html import escape

import qrcode
from django.conf import settings
from reportlab.lib.utils import ImageReader
from Platform_Core.models import PlatformBrandingSettings


def print_qr_codes_enabled():
    profile = PlatformBrandingSettings.objects.filter(pk=1).only("login_page_config").first()
    return profile.print_qr_codes_enabled if profile else True


PRINT_LINK_SALT = "sl-erp.printed-document.v1"


def document_reference(*, tenant=None, kind="document", number="", path=None, request=None):
    import re
    from django.core import signing
    from django.utils import timezone
    routes = [
        (r"^/payments/invoices/(\d+)$", "invoice"),
        (r"^/sales/estimates/(\d+)$", "quotation"),
        (r"^/weighbridge/transactions/(\d+)$", "receipt"),
        (r"^/hr/my-payslips\?payslip=(\d+)$", "payslip"),
        (r"^/procurement/purchase-orders/(\d+)$", "purchase_order"),
    ]
    payload = {"k": kind, "t": getattr(tenant, "pk", None)}
    for pattern, record_kind in routes:
        match = re.fullmatch(pattern, path or "")
        if match:
            payload.update(k=record_kind, i=int(match[1]))
            break
    if "i" not in payload:
        payload.update(n=str(number)[:100], d=timezone.localdate().isoformat())
        if not payload["t"]:
            payload["c"] = (getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL ERP")[:100]
    token = signing.dumps(payload, salt=PRINT_LINK_SALT, compress=True)
    scan_path = f"/documents/scan/{token}"
    base = str(getattr(settings, "ERP_FRONTEND_URL", "") or "").rstrip("/")
    return base + scan_path if base else request.build_absolute_uri(scan_path) if request is not None else scan_path


def qr_png(reference):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=5, border=4)
    qr.add_data(reference)
    qr.make(fit=True)
    output = BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(output, format="PNG")
    return output.getvalue()


def qr_html(reference, number=""):
    if not print_qr_codes_enabled():
        return ""
    data = base64.b64encode(qr_png(reference)).decode("ascii")
    return f'<table class="print-document-qr" style="width:100%;margin-top:8px;page-break-inside:avoid;"><tr><td style="width:88px;border:0;padding:0;"><img alt="Document QR code" src="data:image/png;base64,{data}" width="84" height="84" style="width:22mm;height:22mm;" /></td><td style="border:0;font-size:8pt;color:#64748b;">Document reference<br />{escape(str(number))}<br />Scan to view document details.</td></tr></table>'


def append_document_qr(body, *, tenant=None, kind="document", number="", path=None, request=None):
    if not print_qr_codes_enabled():
        return body
    block = qr_html(document_reference(tenant=tenant, kind=kind, number=number, path=path, request=request), number)
    index = body.rfind('<div class="document-footer">')
    if index >= 0:
        return body[:index] + block + body[index:]
    index = body.rfind("</main>")
    if index >= 0:
        return body[:index] + block + body[index:]
    index = body.rfind("</body>")
    return body[:index] + block + body[index:] if index >= 0 else body + block


def draw_print_qr(canvas, reference, *, x, y, size=48):
    if print_qr_codes_enabled():
        canvas.drawImage(ImageReader(BytesIO(qr_png(reference))), x, y, width=size, height=size)
