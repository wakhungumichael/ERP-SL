from datetime import date
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from pypdf import PdfReader
from rest_framework.test import APIClient
from Platform_Core.models import OrganizationMembership, PlatformBrandingSettings, Tenant, TenantSettings
from Platform_Core.printing import append_document_qr, document_reference, print_qr_codes_enabled
from Platform_Core.documents import render_invoice_document
from Platform_Core.document_pdf import document_pdf_bytes
from SL_HR.models import PayPeriod, PayRecord
from SL_HR.payslips import payslip_pdf
from SL_Weighbridge.models import Customer, Invoice, InvoiceLine


class GlobalPrintQRTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Print Company", code="print-company")
        self.user = User.objects.create_user("print-owner")
        self.root = User.objects.create_user("print-superadmin", is_superuser=True)
        OrganizationMembership.objects.create(user=self.user, tenant=self.tenant, is_org_admin=True, is_default=True)
        self.profile, _ = PlatformBrandingSettings.objects.get_or_create(pk=1)
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.customer = Customer.objects.create(tenant=self.tenant, name="Print customer")
        self.invoice = Invoice.objects.create(tenant=self.tenant, customer=self.customer, invoice_number="INV-QR-001", total_amount=100, source_module="manual")
        InvoiceLine.objects.create(invoice=self.invoice, description="Test service", quantity=1, unit_price=100, total_amount=100)
        period = PayPeriod.objects.create(tenant=self.tenant, name="October 2026", period_start=date(2026,10,1), period_end=date(2026,10,31), status="Completed")
        self.pay = PayRecord.objects.create(period=period, employee=self.user, basic_pay=35000, allowances=2500, deductions=6000, net_pay=31500)

    def set_enabled(self, value):
        response = self.client.patch('/api/platform/settings/branding/', {'print_qr_codes_enabled': value}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['data']['print_qr_codes_enabled'], value)

    def test_global_policy_is_persisted_and_switches_generated_invoice_and_payslip_qr(self):
        for enabled in [True, False, True]:
            with self.subTest(enabled=enabled):
                self.set_enabled(enabled)
                self.assertEqual(print_qr_codes_enabled(), enabled)
                html = render_invoice_document(self.invoice).html
                self.assertEqual('class="print-document-qr"' in html, enabled)
                pdf = PdfReader(BytesIO(payslip_pdf(self.pay)))
                self.assertEqual(len(pdf.pages), 1)
                self.assertEqual(bool(list(pdf.pages[0].images)), enabled)
                invoice_pdf = PdfReader(BytesIO(document_pdf_bytes(html)))
                self.assertTrue(len(invoice_pdf.pages) >= 1)
                self.assertEqual(any(list(page.images) for page in invoice_pdf.pages), enabled)

    def test_tenant_admin_cannot_change_a_platform_wide_policy(self):
        self.client.force_authenticate(self.user)
        response = self.client.patch('/api/platform/settings/branding/', {'print_qr_codes_enabled': False}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_login_settings_updates_preserve_print_policy_and_existing_config(self):
        self.profile.login_page_config = {'headline': 'Keep me'}
        self.profile.save(update_fields=['login_page_config'])
        self.set_enabled(False)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.login_page_config['headline'], 'Keep me')
        response = self.client.patch('/api/platform/settings/branding/', {'login_page_config': {'headline': 'Updated'}}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(print_qr_codes_enabled())

    @override_settings(ERP_FRONTEND_URL='https://erp.example.test')
    def test_qr_references_use_signed_public_links_without_salary_data(self):
        reference = document_reference(tenant=self.tenant, kind='payslip', number='PAY-001', path=f'/hr/my-payslips?payslip={self.pay.pk}')
        self.assertTrue(reference.startswith('https://erp.example.test/documents/scan/'))
        from django.core import signing
        from Platform_Core.printing import PRINT_LINK_SALT
        payload = signing.loads(reference.rsplit('/',1)[-1], salt=PRINT_LINK_SALT)
        self.assertEqual(payload, {'k':'payslip','t':self.tenant.pk,'i':self.pay.pk})
        self.assertNotIn('31500', reference)
        self.assertNotIn('print-owner', reference)
        self.set_enabled(False)
        self.assertEqual(append_document_qr('<main>Original</main>', number='Doc'), '<main>Original</main>')

    def test_legacy_receipt_generation_skips_qr_work_when_disabled(self):
        self.set_enabled(False)
        from SL_Weighbridge.models import Transaction
        with patch('SL_Weighbridge.models.qrcode.make') as make:
            self.assertIsNone(Transaction().generate_qr_code())
        make.assert_not_called()


    def test_organization_admin_can_disable_qr_across_documents_and_enable_it_again(self):
        self.client.force_authenticate(self.user)
        url = f"/api/platform/tenants/{self.tenant.pk}/settings/"
        other = Tenant.objects.create(name="Other QR issuer", code="other-qr-issuer")
        for enabled in (False, True):
            response = self.client.patch(url, {"print_qr_codes_enabled": enabled}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(self.client.get(url).data["data"]["print_qr_codes_enabled"], enabled)
            self.assertEqual(print_qr_codes_enabled(self.tenant), enabled)
            self.assertTrue(print_qr_codes_enabled(other))
            html = render_invoice_document(self.invoice).html
            self.assertEqual('class="print-document-qr"' in html, enabled)
            invoice_pdf = PdfReader(BytesIO(document_pdf_bytes(html)))
            self.assertEqual(len(invoice_pdf.pages), 1)
            self.assertNotIn("Page 1 of 1", invoice_pdf.pages[0].extract_text())
            self.assertEqual(bool(list(invoice_pdf.pages[0].images)), enabled)
            payslip = PdfReader(BytesIO(payslip_pdf(self.pay)))
            self.assertEqual(bool(list(payslip.pages[0].images)), enabled)
            for kind in ("quotation", "receipt", "purchase_order", "statement", "report"):
                html = append_document_qr('<main>Content</main>', tenant=self.tenant, kind=kind)
                self.assertEqual('class="print-document-qr"' in html, enabled, kind)
            from reportlab.pdfgen.canvas import Canvas
            from Platform_Core.printing import draw_print_qr
            with patch.object(Canvas, "drawImage") as draw:
                draw_print_qr(Canvas(BytesIO()), "reference", x=0, y=0, tenant=self.tenant)
                self.assertEqual(draw.called, enabled)
            from SL_Weighbridge.models import Transaction
            if not enabled:
                with patch('SL_Weighbridge.models.qrcode.make') as make:
                    self.assertIsNone(Transaction(tenant=self.tenant).generate_qr_code())
                make.assert_not_called()

    def test_platform_disable_overrides_organization_enable(self):
        TenantSettings.objects.create(tenant=self.tenant, print_qr_codes_enabled=True)
        self.set_enabled(False)
        self.assertFalse(print_qr_codes_enabled(self.tenant))
        self.assertNotIn('class="print-document-qr"', render_invoice_document(self.invoice).html)

    def test_qr_settings_cannot_be_changed_by_members_or_other_organizations(self):
        settings = TenantSettings.objects.create(tenant=self.tenant)
        other = Tenant.objects.create(name="Protected QR issuer", code="protected-qr-issuer")
        other_settings = TenantSettings.objects.create(tenant=other)
        self.client.force_authenticate(self.user)
        response = self.client.patch(f"/api/platform/tenants/{other.pk}/settings/", {"print_qr_codes_enabled": False}, format="json")
        self.assertIn(response.status_code, (403, 404))
        OrganizationMembership.objects.filter(user=self.user).update(is_org_admin=False)
        self.user = User.objects.get(pk=self.user.pk)
        self.client.force_authenticate(self.user)
        response = self.client.patch(f"/api/platform/tenants/{self.tenant.pk}/settings/", {"print_qr_codes_enabled": False}, format="json")
        self.assertEqual(response.status_code, 403)
        settings.refresh_from_db()
        other_settings.refresh_from_db()
        self.assertTrue(settings.print_qr_codes_enabled)
        self.assertTrue(other_settings.print_qr_codes_enabled)


class PublicPrintLinkTests(GlobalPrintQRTests):
    def public_url(self, kind, path):
        link=document_reference(tenant=self.tenant,kind=kind,path=path)
        return '/api/platform/public/documents/'+link.rsplit('/',1)[-1]+'/'

    def test_invoice_scan_displays_details_without_sign_in_and_downloads_pdf(self):
        self.client.force_authenticate(user=None)
        url=self.public_url('invoice',f'/payments/invoices/{self.invoice.pk}')
        response=self.client.get(url)
        self.assertEqual(response.status_code,200)
        self.assertIn(b'INV-QR-001',response.content)
        self.assertIn(b'Print customer',response.content)
        self.assertEqual(response['X-Robots-Tag'],'noindex, nofollow, noarchive')
        response=self.client.get(url,{'download':'pdf'})
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.content.startswith(b'%PDF-'))

    def test_public_payslip_never_exposes_salary_or_employee_identity(self):
        self.client.force_authenticate(user=None)
        url=self.public_url('payslip',f'/hr/my-payslips?payslip={self.pay.pk}')
        for params in [{},{'download':'pdf'}]:
            response=self.client.get(url,params)
            self.assertEqual(response.status_code,200)
            text=PdfReader(BytesIO(response.content)).pages[0].extract_text() if params else response.content.decode()
            for allowed in ['Print Company','October 2026',f'PAY-{self.pay.pk:06d}']:
                self.assertIn(allowed,text)
            for private in ['31500','31,500','35000','35,000','print-owner','Basic pay','NET PAY']:
                self.assertNotIn(private,text)

    def test_tampered_and_wrong_tenant_links_do_not_expose_document(self):
        self.client.force_authenticate(user=None)
        url=self.public_url('invoice',f'/payments/invoices/{self.invoice.pk}')
        from django.core import signing
        from Platform_Core.printing import PRINT_LINK_SALT
        token=url.rstrip('/').rsplit('/',1)[-1]
        payload=signing.loads(token,salt=PRINT_LINK_SALT)
        payload['i']=999999
        altered=signing.dumps(payload,salt=PRINT_LINK_SALT)
        self.assertEqual(self.client.get('/api/platform/public/documents/'+altered+'/').status_code,404)
        payload['i']=self.invoice.pk;payload['t']=999999
        altered=signing.dumps(payload,salt=PRINT_LINK_SALT)
        self.assertEqual(self.client.get('/api/platform/public/documents/'+altered+'/').status_code,404)
        self.assertEqual(self.client.get(url.replace(token,token[:-1]+('a' if token[-1]!='a' else 'b'))).status_code,404)

    def test_unfinished_payslip_has_no_public_details(self):
        self.client.force_authenticate(user=None)
        self.pay.period.status='Draft';self.pay.period.save(update_fields=['status'])
        self.assertEqual(self.client.get(self.public_url('payslip',f'/hr/my-payslips?payslip={self.pay.pk}')).status_code,404)
