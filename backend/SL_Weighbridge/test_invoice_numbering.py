from datetime import datetime,timezone
from unittest.mock import patch
from django.test import TestCase
from SL_Weighbridge.models import Customer,Invoice

class InvoiceNumberingTests(TestCase):
 def setUp(self):
  self.customer=Customer.objects.create(name='Numbering test',phone_number='numbering-test')
  self.clock=patch('django.utils.timezone.now',return_value=datetime(2026,11,9,tzinfo=timezone.utc));self.clock.start();self.addCleanup(self.clock.stop)
 def test_continue_after_retained_numbers_when_test_invoices_are_deleted(self):
  for number in [1,84,92,121,154]:
   Invoice.objects.create(customer=self.customer,invoice_number=f'INV-2026-{number:04d}')
  invoice=Invoice.objects.create(customer=self.customer)
  self.assertEqual(invoice.invoice_number,'INV-2026-0155')
  self.assertEqual(Invoice.objects.create(customer=self.customer).invoice_number,'INV-2026-0156')
 def test_ignore_custom_suffixes_and_other_years(self):
  for number in ['INV-2026-legacy','INV-2026-0020','INV-2025-0999']:
   Invoice.objects.create(customer=self.customer,invoice_number=number)
  self.assertEqual(Invoice.objects.create(customer=self.customer).invoice_number,'INV-2026-0021')
 def test_start_with_one(self):
  self.assertEqual(Invoice.objects.create(customer=self.customer).invoice_number,'INV-2026-0001')
