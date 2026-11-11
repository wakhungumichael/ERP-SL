# Organization document settings

Open **Organization Settings > Documents**. Previous Invoicing and Templates links open this section.

- **Edit defaults** opens a responsive popup for issuer details, invoice numbering, payment terms, payment instructions, shared tax defaults and the footer. The form scrolls while Cancel and Save document defaults remain visible. Cancel discards the draft.
- **QR codes on documents** has a visible switch and its own **Save QR settings** button. Saving invoice defaults does not overwrite this preference.
- **Document layouts** lists the selected layout for invoices, estimates, receipts, statements, purchase orders and reports. Choose layout opens the gallery for that document type; selecting a layout saves immediately across the organization.
- **New custom layout** opens the template editor.

QR preferences apply to newly generated previews, downloads and printouts. Previously downloaded PDFs retain their original content. A platform-wide QR disable takes precedence over organization preferences. Existing organization settings permissions apply.

Metrix requires migration `Platform_Core.0078_tenant_document_qr_policy`. This enabled-by-default preference preserves existing accounts, branding, template assignments, invoices and transactions.
