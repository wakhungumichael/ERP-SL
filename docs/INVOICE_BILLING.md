# Invoice billing details

Open **Organization Settings → Invoicing** to enter the issuer's postal or physical
address, tax ID / PIN, website, and payment instructions. The organization name,
email, phone and logo come from its existing profile and branding settings.

Create or edit an invoice and open **Billing details**:

- Client postal / physical address
- Contact person / attention
- Billing email and phone
- Client tax ID / PIN
- Purchase order / contract reference

The client address, email and phone start from the selected customer. Changes apply
to the invoice, preserving the customer master record. Selecting another customer
resets these details. New invoices retain their billing contacts when the customer
master record changes. Older invoices fall back to the current customer details.

New invoices record their preparer automatically. Older records without a known
preparer do not display an invented name. Invoice issuance uses the billing email,
falling back to the customer's email when no billing email was recorded.

Users need the existing invoice edit privilege to change billing details. Financial
items remain editable only on draft manual invoices. Saving contact details alone
does not replace line items or recalculate amounts.

The shared Classic, Modern and Compact invoice layouts include a clear Bill to
section, billing contact, item numbers, tax and separate charges, payment details,
and page numbers. Untouched shared invoice templates upgrade automatically;
tenant-owned templates and customized shared templates retain their content and
styles. Custom templates may use the new context fields:
`customer.address`, `customer.contact_name`, `customer.tax_number`,
`company.address`, `company.tax_number`, `company.website`, `company.prepared_by`,
`company.prepared_by_email`, `document.customer_reference`, and
`document.payment_instructions`.

Local schema changes are in `Platform_Core.0076_invoice_billing_details` and
`SL_Weighbridge.0085_invoice_billing_details`. Run migrations before starting an
updated backend. These changes do not seed, replace, or delete existing invoices.
