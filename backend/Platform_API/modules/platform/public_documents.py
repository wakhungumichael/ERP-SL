"""Read-only documents shared by signed QR links; no account is required."""
from html import escape
from django.core import signing
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework.exceptions import NotFound
from Platform_Core.printing import PRINT_LINK_SALT
from Platform_Core.document_pdf import document_pdf_response
from Platform_Core.documents import RenderedDocument, render_invoice_document, render_estimate_document, render_transaction_receipt, render_purchase_order_document


def reference_document(*, title, issuer, reference, fields):
    details = ''.join(f'<tr><th>{escape(label)}</th><td>{escape(str(value))}</td></tr>' for label,value in fields)
    html = f'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><style>@page {{size:A4;margin:20mm;}} body{{font-family:Arial,sans-serif;color:#172033;margin:0;padding:24px;background:#fff;}} main{{max-width:850px;margin:auto;}} h1{{font-size:26px;}} table{{width:100%;border-collapse:collapse;}} th,td{{padding:14px 8px;text-align:left;border-bottom:1px solid #e2e8f0;}} th{{width:40%;}} p{{line-height:1.6;color:#64748b;}}</style></head><body><main><h2>{escape(issuer)}</h2><h1>{escape(title)}</h1><p>{escape(reference)}</p><table>{details}</table><p>Shared document reference.</p></main></body></html>'
    return RenderedDocument(html=html, template=None, settings=None)


class PublicPrintedDocumentAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        if len(token)>4096:
            raise NotFound('This document link is unavailable.')
        try:
            data = signing.loads(token, salt=PRINT_LINK_SALT)
            if not isinstance(data, dict) or not isinstance(data.get('k'), str):
                raise ValueError
        except (signing.BadSignature, ValueError, TypeError):
            raise NotFound('This document link is unavailable.')
        kind, pk, tenant_id = data['k'], data.get('i'), data.get('t')
        rendered = None
        number = data.get('n') or 'Document'
        if pk is not None:
            if type(pk) is not int or (tenant_id is not None and type(tenant_id) is not int):
                raise NotFound('This document link is unavailable.')
            if kind == 'invoice':
                from SL_Weighbridge.models import Invoice
                obj = get_object_or_404(Invoice.objects.select_related('tenant','customer'), pk=pk, tenant_id=tenant_id)
                number = obj.invoice_number or f'INV-{obj.pk}'
                rendered = render_invoice_document(obj, request=request)
            elif kind == 'quotation':
                from SL_Sales.models import Estimate
                obj = get_object_or_404(Estimate.objects.select_related('tenant','customer'), pk=pk, tenant_id=tenant_id)
                number = obj.estimate_number
                rendered = render_estimate_document(obj, request=request)
            elif kind == 'receipt':
                from SL_Weighbridge.models import Transaction
                obj = get_object_or_404(Transaction.objects.select_related('tenant','customer','vehicle'), pk=pk, tenant_id=tenant_id)
                number = f'TX-{obj.pk:05d}'
                rendered = render_transaction_receipt(obj, request=request, pdf_optimized=request.query_params.get('download')=='pdf')
            elif kind == 'purchase_order':
                from SL_Procurement.models import PurchaseOrder
                obj = get_object_or_404(PurchaseOrder.objects.select_related('tenant'), pk=pk, tenant_id=tenant_id)
                number = obj.reference
                rendered = render_purchase_order_document(obj, request=request, tenant=obj.tenant)
            elif kind == 'payslip':
                from SL_HR.models import PayRecord
                obj = get_object_or_404(PayRecord.objects.select_related('period__tenant'), pk=pk, period__tenant_id=tenant_id, period__status='Completed')
                number = f'PAY-{obj.pk:06d}'
                rendered = reference_document(title='Payslip reference', issuer=obj.period.tenant.legal_name or obj.period.tenant.name, reference=number, fields=[('Pay period',obj.period.name),('From',obj.period.period_start),('To',obj.period.period_end)])
            else:
                raise NotFound('This document link is unavailable.')
        else:
            from Platform_Core.models import Tenant
            tenant = Tenant.objects.filter(pk=tenant_id).first() if type(tenant_id) is int else None
            issuer = (tenant.legal_name or tenant.name) if tenant else str(data.get('c') or 'SL ERP')
            rendered = reference_document(title=kind.replace('_',' ').title(), issuer=issuer, reference=str(number), fields=[('Document reference',number),('Document type',kind.replace('_',' ').title()),('Print date',data.get('d') or '')])
        if request.query_params.get('download') == 'pdf':
            response = document_pdf_response(rendered, f'{number}.pdf')
        else:
            response = HttpResponse(rendered.html, content_type='text/html; charset=utf-8')
        response['Cache-Control'] = 'private, no-store'
        response['X-Robots-Tag'] = 'noindex, nofollow, noarchive'
        response['Referrer-Policy'] = 'no-referrer'
        response['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data: https: http:"
        return response
