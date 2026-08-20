# CRM to ERP Integration Blueprint

Date: 2026-08-05
Scope: Align `SL_CRM` with the existing ERP sales, billing, and customer domains in this repository.

## 1. Current-State Audit

The current codebase already contains the core building blocks needed for CRM to ERP integration:

- CRM company/account equivalent: `SL_CRM.Organisation`
- CRM contact equivalent: `SL_CRM.Contact`
- CRM opportunity equivalent: `SL_CRM.Lead`
- ERP customer/billing account: `SL_Weighbridge.Customer`
- ERP product and price master: `SL_Sales.Product`
- ERP quote: `SL_Sales.Estimate`
- ERP sales order: `SL_Sales.SalesOrder`
- ERP invoice and balance state: `SL_Weighbridge.Invoice` and `Platform_API.modules.payments.views.reconcile_invoice_payment_state`
- Tenant-level integration config: `Platform_Core.IntegrationEndpoint`

Relevant existing APIs:

- `GET|POST /api/sales/products/`
- `GET|POST /api/sales/estimates/`
- `POST /api/sales/estimates/<id>/convert-to-order/`
- `GET|POST /api/sales/sales-orders/`
- `GET /api/sales/customer-statements/<customer_id>/`
- `GET|POST /api/weighbridge/customers/`
- `GET|PATCH /api/weighbridge/customers/<id>/`
- `GET|POST /api/platform/integrations/`

## 2. Recommended Master Data Ownership

Based on the current model boundaries in this repo, the cleanest ownership split is:

| Domain | System of Record | Notes |
| --- | --- | --- |
| Leads / opportunities | CRM (`SL_CRM`) | `Lead.stage` already represents pipeline state. |
| Billing customer account | ERP (`SL_Weighbridge.Customer`) after win | Create or link ERP customer when opportunity becomes won. |
| Contacts | CRM primary, mirrored key fields to ERP metadata | ERP customer model is account-centric, not person-centric. |
| Products and prices | ERP (`SL_Sales.Product`) | Already modeled centrally for pricing and order lines. |
| Inventory / stock | ERP | No CRM ownership should exist here. |
| Sales quotes | ERP (`SL_Sales.Estimate`) | Credit checks and pricing are ERP-native. |
| Sales orders | ERP (`SL_Sales.SalesOrder`) | Generated from CRM win event or ERP estimate acceptance. |
| Invoice / receivables / credit exposure | ERP | Already derived from invoices and payments. |

## 3. Integration Design Assumptions

These assumptions are recommended because the current schema does not yet expose all required integration keys:

- Deduplication key should be a new canonical cross-system field such as `external_ref` or `crm_organisation_id`.
- Until that field exists, the best available fallback in the current ERP is `email`, then `phone_number`.
- `Lead.stage = "won"` is the current equivalent of `Closed-Won`.
- Formal quote creation should occur in ERP as `Estimate`.
- Credit check should read ERP invoice exposure before an estimate is created or moved to `sent`.

## 4. Data Mapping Matrix

### 4.1 CRM Account to ERP Customer

```json
{
  "entity": "crm_account_to_erp_customer",
  "source_model": "SL_CRM.Organisation",
  "target_model": "SL_Weighbridge.Customer",
  "match_rule": {
    "recommended_primary_key": "external_ref",
    "current_fallback_keys": ["email", "phone"]
  },
  "field_map": [
    {
      "crm_field": "id",
      "erp_field": "metadata.crm_organisation_id",
      "required": true,
      "transform": "string"
    },
    {
      "crm_field": "name",
      "erp_field": "name",
      "required": true,
      "transform": "trim"
    },
    {
      "crm_field": "email",
      "erp_field": "email",
      "required": false,
      "transform": "lowercase"
    },
    {
      "crm_field": "phone",
      "erp_field": "phone_number",
      "required": true,
      "transform": "normalize_e164_or_local_digits"
    },
    {
      "crm_field": "address",
      "erp_field": "address",
      "required": false,
      "transform": "trim"
    },
    {
      "crm_field": "type",
      "erp_field": "metadata.crm_account_type",
      "required": false,
      "transform": "passthrough"
    },
    {
      "crm_field": "industry",
      "erp_field": "metadata.industry",
      "required": false,
      "transform": "passthrough"
    },
    {
      "crm_field": "website",
      "erp_field": "metadata.website",
      "required": false,
      "transform": "passthrough"
    },
    {
      "crm_field": "notes",
      "erp_field": "metadata.crm_notes",
      "required": false,
      "transform": "truncate_2000"
    },
    {
      "crm_field": "tenant_id",
      "erp_field": "tenant_id",
      "required": true,
      "transform": "passthrough"
    }
  ]
}
```

### 4.2 ERP Product to CRM Product Reference

```json
{
  "entity": "erp_product_to_crm_product_reference",
  "source_model": "SL_Sales.Product",
  "target_model": "CRM product cache/catalog",
  "sync_direction": "ERP_TO_CRM",
  "field_map": [
    { "erp_field": "id", "crm_field": "erp_product_id", "required": true },
    { "erp_field": "code", "crm_field": "sku", "required": false },
    { "erp_field": "name", "crm_field": "name", "required": true },
    { "erp_field": "description", "crm_field": "description", "required": false },
    { "erp_field": "product_type", "crm_field": "type", "required": true },
    { "erp_field": "unit", "crm_field": "unit_of_measure", "required": false },
    { "erp_field": "unit_price", "crm_field": "list_price", "required": true },
    { "erp_field": "tax_rate", "crm_field": "tax_rate", "required": true },
    { "erp_field": "is_active", "crm_field": "is_active", "required": true },
    { "erp_field": "updated_at", "crm_field": "erp_last_modified_at", "required": true }
  ]
}
```

### 4.3 CRM Opportunity / Quote to ERP Sales Order

```json
{
  "entity": "crm_opportunity_to_erp_sales_order",
  "source_model": "SL_CRM.Lead",
  "target_model": "SL_Sales.SalesOrder",
  "event": "lead.stage=won",
  "field_map": [
    { "crm_field": "id", "erp_field": "notes", "required": true, "transform": "append 'CRM Lead ID: <id>'" },
    { "crm_field": "organisation.id", "erp_field": "customer", "required": true, "transform": "resolve_or_create_customer" },
    { "crm_field": "organisation.name", "erp_field": "customer_name", "required": true, "transform": "trim" },
    { "crm_field": "expected_close_date", "erp_field": "order_date", "required": false, "transform": "fallback_today" },
    { "crm_field": "expected_close_date", "erp_field": "expected_delivery_date", "required": false, "transform": "business_rule_offset" },
    { "crm_field": "notes", "erp_field": "notes", "required": false, "transform": "merge_with_sync_metadata" },
    { "crm_field": "currency", "erp_field": "metadata.crm_currency", "required": true, "transform": "passthrough" },
    { "crm_field": "value", "erp_field": "metadata.crm_opportunity_value", "required": false, "transform": "decimal" },
    { "crm_field": "assigned_to_id", "erp_field": "metadata.crm_owner_id", "required": false, "transform": "integer" },
    { "crm_field": "line_items[]", "erp_field": "line_items[]", "required": true, "transform": "crm_quote_lines_to_sales_order_lines" }
  ]
}
```

### 4.4 Quote Line Mapping

```json
{
  "entity": "crm_quote_line_to_erp_sales_order_line",
  "field_map": [
    { "crm_field": "product_external_id", "erp_field": "product", "required": true, "transform": "resolve_product_by_external_or_code" },
    { "crm_field": "description", "erp_field": "description", "required": false, "transform": "fallback_product_name" },
    { "crm_field": "quantity", "erp_field": "quantity", "required": true, "transform": "decimal_gt_zero" },
    { "crm_field": "unit_price", "erp_field": "unit_price", "required": true, "transform": "decimal_gte_zero" },
    { "crm_field": "discount_amount", "erp_field": "discount_amount", "required": false, "transform": "default_zero" },
    { "crm_field": "tax_rate", "erp_field": "tax_rate", "required": false, "transform": "default_tenant_tax_rate" },
    { "crm_field": "line_sequence", "erp_field": "sort_order", "required": false, "transform": "default_index" }
  ]
}
```

## 5. Workflow Logic

### 5.1 Quote-to-Order Trigger

```text
Trigger: CRM Lead updated

1. Receive CRM lead webhook event.
2. Reject if event is not for stage change.
3. Load current Lead by id and tenant.
4. Exit if stage is not "won".
5. Check idempotency store using key:
   crm:lead:<lead_id>:stage:won
6. Resolve Organisation.
7. Resolve or create ERP Customer using canonical integration key.
8. Validate quote lines exist and each line resolves to an active ERP Product.
9. Create ERP Sales Order payload.
10. POST payload to ERP `/api/sales/sales-orders/`.
11. Persist sync log with ERP order id and payload hash.
12. Write timeline activity back to CRM:
    "ERP Sales Order SO-xxxx created successfully."
13. Mark idempotency key complete.
14. On failure, store retryable error and raise alert.
```

### 5.2 Credit Check Trigger

```text
Trigger: CRM user requests formal quote or moves quote to "sent"

1. Receive credit-check request with tenant, organisation id, and draft quote total.
2. Resolve ERP Customer using canonical integration key.
3. If no ERP Customer exists:
   - treat as new account
   - allow quote unless policy requires manual finance approval
4. Query ERP statement endpoint:
   GET /api/sales/customer-statements/<customer_id>/
5. Read:
   - outstanding
   - amount_overdue
   - total_paid
   - invoice_count
6. Read configured credit limit from:
   - customer extension field if implemented, else
   - tenant policy config
7. Calculate:
   projected_exposure = outstanding + draft_quote_total
   available_credit = credit_limit - outstanding
8. Decision:
   - if amount_overdue > 0: block or route for approval
   - if projected_exposure > credit_limit: block
   - else allow
9. Return structured response to CRM:
   decision, reason, outstanding, overdue, available_credit
10. Log decision for audit.
```

### 5.3 Fulfillment Update Push

```text
Trigger: ERP shipment or order fulfillment state changes

1. Detect sales order shipment event in ERP.
2. Build CRM timeline payload with:
   order number, shipment status, carrier, tracking number, timestamp
3. POST to CRM webhook endpoint.
4. Retry transient errors with exponential backoff.
5. Mark sync state delivered.
```

## 6. Reference Implementation Snippets

These snippets use Python because the active backend in this repo is Django-based.

### 6.1 Middleware Service for Quote-to-Order

```python
from dataclasses import dataclass
from decimal import Decimal
import logging
import requests

logger = logging.getLogger(__name__)


class IntegrationError(Exception):
    pass


@dataclass
class SyncResult:
    ok: bool
    status_code: int
    payload: dict
    message: str


def build_sales_order_payload(*, lead, erp_customer_id: int, branch_id: int | None = None) -> dict:
    lines = getattr(lead, "quote_lines", []) or []
    if not lines:
        raise IntegrationError("Won opportunity cannot sync without quote lines.")

    return {
        "branch": branch_id,
        "customer": erp_customer_id,
        "customer_name": lead.organisation.name if lead.organisation else "",
        "order_date": (lead.expected_close_date.isoformat() if lead.expected_close_date else None),
        "status": "confirmed",
        "notes": f"Generated from CRM Lead {lead.id}. {lead.notes or ''}".strip(),
        "line_items": [
            {
                "product": line["erp_product_id"],
                "description": line.get("description") or "",
                "quantity": str(Decimal(str(line["quantity"]))),
                "unit_price": str(Decimal(str(line["unit_price"]))),
                "discount_amount": str(Decimal(str(line.get('discount_amount', 0)))),
                "tax_rate": str(Decimal(str(line.get('tax_rate', 0))))
            }
            for line in lines
        ],
    }


def post_sales_order(*, base_url: str, token: str, payload: dict, timeout: int = 15) -> SyncResult:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Idempotency-Key": payload.get("external_ref", "crm-sales-order-sync"),
    }
    try:
        response = requests.post(
            f"{base_url.rstrip('/')}/api/sales/sales-orders/",
            json=payload,
            headers=headers,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        logger.exception("ERP sync transport failure")
        raise IntegrationError(f"Transport failure while creating sales order: {exc}") from exc

    body = {}
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text}

    if response.status_code not in (200, 201):
        logger.error("ERP sync rejected payload", extra={"status_code": response.status_code, "body": body})
        raise IntegrationError(f"ERP rejected sales order payload: {body}")

    return SyncResult(
        ok=True,
        status_code=response.status_code,
        payload=body,
        message="Sales order synced successfully.",
    )
```

### 6.2 Credit Check Service

```python
from decimal import Decimal
import requests


def evaluate_credit(*, base_url: str, token: str, customer_id: int, draft_total: Decimal, credit_limit: Decimal) -> dict:
    response = requests.get(
        f"{base_url.rstrip('/')}/api/sales/customer-statements/{customer_id}/",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()

    summary = data.get("summary", {})
    outstanding = Decimal(str(summary.get("outstanding", 0)))
    overdue = Decimal(str(summary.get("amount_overdue", 0)))
    projected_exposure = outstanding + Decimal(str(draft_total))
    available_credit = credit_limit - outstanding

    if overdue > 0:
        return {
            "approved": False,
            "reason": "Account has overdue balance.",
            "outstanding": str(outstanding),
            "overdue": str(overdue),
            "available_credit": str(available_credit),
        }

    if projected_exposure > credit_limit:
        return {
            "approved": False,
            "reason": "Projected exposure exceeds credit limit.",
            "outstanding": str(outstanding),
            "overdue": str(overdue),
            "available_credit": str(available_credit),
        }

    return {
        "approved": True,
        "reason": "Credit check passed.",
        "outstanding": str(outstanding),
        "overdue": str(overdue),
        "available_credit": str(available_credit),
    }
```

## 7. Validation and Duplicate-Control Rules

Recommended minimum validation rules:

- Reject account sync when `name` is blank.
- Reject account sync when both `email` and `phone` are missing.
- Reject quote/order sync when no line items exist.
- Reject any line with `quantity <= 0`.
- Reject any line with `unit_price < 0`.
- Reject sync when product cannot be resolved to an active ERP product.
- Reject duplicate won-event processing when idempotency key already exists.
- Reject customer creation when canonical integration key maps to multiple records.

Example validation helpers:

```python
import re


def validate_account_payload(payload: dict) -> list[str]:
    errors = []
    if not (payload.get("name") or "").strip():
        errors.append("Account name is required.")

    email = (payload.get("email") or "").strip().lower()
    phone = re.sub(r"\\D+", "", payload.get("phone") or "")
    if not email and not phone:
        errors.append("Either email or phone is required.")

    return errors


def validate_order_payload(payload: dict) -> list[str]:
    errors = []
    lines = payload.get("line_items") or []
    if not lines:
        errors.append("At least one line item is required.")

    for index, line in enumerate(lines, start=1):
        try:
            quantity = float(line.get("quantity", 0))
            unit_price = float(line.get("unit_price", 0))
        except (TypeError, ValueError):
            errors.append(f"Line {index}: quantity and unit_price must be numeric.")
            continue

        if quantity <= 0:
            errors.append(f"Line {index}: quantity must be greater than zero.")
        if unit_price < 0:
            errors.append(f"Line {index}: unit_price cannot be negative.")
        if not line.get("product"):
            errors.append(f"Line {index}: product reference is required.")

    return errors
```

## 8. Gaps to Close Before Full Implementation

These are the main architectural gaps visible in the current repo:

1. No canonical cross-system customer key exists on either `Organisation` or `Customer`.
2. `CustomerStatementView` returns `credit_limit` and `available_credit` as `None`, so true credit policy is not implemented yet.
3. CRM opportunity line items are not modeled in `SL_CRM`, so quote-to-order needs either:
   - a new CRM quote/quote-line model, or
   - CRM to ERP quote creation first, then ERP estimate to sales order conversion.
4. Fulfillment shipment entities and webhook emitters are not yet modeled in the current sales domain.

## 9. Recommended Next Implementation Phase

1. Add integration key fields to `SL_CRM.Organisation` and `SL_Weighbridge.Customer`.
2. Add customer credit policy fields to ERP.
3. Add CRM quote and quote-line models or use ERP `Estimate` as the formal quote object.
4. Build authenticated CRM webhook endpoints under `Platform_API/modules/crm/`.
5. Add idempotent sync logging and retry handling.
6. Add timeline callback/webhook for ERP order and fulfillment updates.

