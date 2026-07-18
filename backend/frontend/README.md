# Commercial Weighbridge Vite UI

This frontend is the start of the new platform console UI for the module-based API.

## Start

```bash
cd frontend
npm install
npm run dev
```

Use Node.js 18+ for this frontend. The current local shell runtime on July 16, 2026 is `Node v10.19.0`, which is too old for the installed TypeScript and Vite toolchain.

## Environment

Create `.env` from `.env.example` if you want to point the UI at a non-default backend.

## Current scope

- Implementation checklist visibility
- Platform overview
- Accounting dashboard
- Integration health
- Indicator registry
- Weighbridge operations dashboard
- Live weight snapshot
- Vehicle workflow context
- Payment provider capabilities
- Role-aware workspace sidebar fed by `/api/platform/workspace/navigation/`
- Platform user and role visibility
- Workspace menu section visibility for configurable navigation
- Reporting overview
- Accounting and weighbridge API summaries
- API token-based auth checks for protected endpoints
- Recent transaction, invoice, and payment browsers
- Selected record detail hydration
- Transaction creation with tenant-scoped lookup loading
- Workflow-aware second-weight prefills
- Transaction actions:
  - capture weight
  - approve
  - recall
  - generate invoice
  - mark transaction paid
- Invoice and payment actions:
  - issue invoice
  - receive payment
  - initiate gateway payment
  - simulate gateway callback
  - confirm payment

## Testing checklist

- Confirm the backend is running at `http://localhost:8000` or set `VITE_API_BASE_URL`.
- Load the UI and verify platform, accounting, payments, and weighbridge cards return JSON.
- Set `tenantCode` to a real tenant and confirm the counts change.
- Set `branchId` and confirm the live-weight panel resolves branch-specific readings.
- Set `vehicleId` and confirm workflow context returns first-weight pairing data.
- Create a first-weight transaction from the UI.
- Use workflow shortcuts to prepare a second-weight transaction from a selected vehicle or transaction.
- Test transaction actions:
  - capture weight
  - approve / recall
  - generate invoice
  - mark transaction paid
- Test invoice payment flows:
  - receive payment
  - initiate gateway payment
  - simulate gateway callback
  - confirm payment
- Open the payload viewer and confirm there are no public `/api/v1/` links in the returned API structures.
