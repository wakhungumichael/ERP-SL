# Invoice billing details

Open **Organization Settings > Documents > Edit defaults** to enter the issuer's postal or physical
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

## Tax-inclusive invoice prices

For a manual invoice, choose **Combined tax — inclusive** and enter the tax rate. Enter each item's agreed price including
tax. At 16%, KES 1,160 is split into KES 1,000 before tax and KES 160 tax; the total
stays KES 1,160. The tax is extracted using total × rate ÷ (100 + rate).

The summary shows the entered subtotal including tax, deducts the included tax,
and shows the subtotal before tax. The total payable keeps the entered amount.
Choose **Combined tax — exclusive** to add tax on top instead. The saved invoice
and printable document use the same subtotal, tax and total. Additional charges are added separately; percentage charges use the subtotal
before tax. Draft edits retain the entered inclusive prices and tax treatment.
Existing invoices and new invoices default to prices excluding tax.

This option requires migration `SL_Weighbridge.0086_invoice_prices_include_tax`.

Saved invoice screens retain the entered unit prices and line amounts. Inclusive
lines are labelled **incl. tax**; the summary separately shows the included tax
deduction and the subtotal before tax. Editing and saved views use the same line
rounding so the displayed lines add up to the entered subtotal.

Combined tax is calculated once on the sum of all lines. For rate R:
inclusive tax = gross total × R ÷ (100 + R); exclusive tax = net subtotal × R ÷ 100.
This follows the net/gross relationship in [KRA's VAT example](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax).
The organization controls its tax name and rate; the calculation does not
hardcode Kenya's 16%. Use the applicable rate for the country and supply.
Existing invoice tax names, rates and currencies are retained when reopened.
