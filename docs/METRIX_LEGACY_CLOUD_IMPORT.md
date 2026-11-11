# Metrix Legacy Cloud Import

This imports the legacy Metrix weighbridge records into one existing SL-ERP tenant. It includes companies, branches, currencies, customers, vehicle types and charges, vehicles, items, customer discounts, and transactions.

The importer does not import legacy user accounts, passwords, sessions, camera credentials, or raw vehicle-presence captures. Existing SL-ERP users and tenant access controls remain intact.

## Before Importing

1. Deploy the branch containing the importer to the Metrix server.
2. Copy the JSON package from the development machine to `/srv/sl-erp/backups/migrations/` on the cloud server, then copy it into the running backend container:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cat > /tmp/metrix_legacy.json' \
  < backups/migrations/metrix_legacy_20261009_093659.json
```
3. Confirm the cloud tenant code from the Organizations screen or with the command below.
4. The `--replace` command deletes only weighbridge business records assigned to that tenant: transactions, discounts, vehicles, customers, items, vehicle types, branches, currencies, and companies. It does not remove tenant users, roles, subscriptions, or platform settings.
5. Before importing, the command checks for customer phone/email and vehicle plate conflicts owned by other tenants. It stops without changing data if any are found.

```bash
cd /srv/sl-erp
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cd /app/backend && python manage.py shell -c "from Platform_Core.models import Tenant; print(list(Tenant.objects.values_list(\"code\", flat=True)))"'
```

## Cloud Backup

```bash
cd /srv/sl-erp
mkdir -p backups/migrations
docker compose --env-file .env.production -f docker-compose.production.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "backups/migrations/metrix_cloud_before_legacy_import_$(date +%Y%m%d_%H%M%S).dump"
```

## Dry Run

Replace `metrix-weighbridge-solutions` with the actual cloud tenant code.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cd /app/backend && python manage.py import_legacy_metrix /tmp/metrix_legacy.json --tenant-code metrix-weighbridge-solutions'
```

## Import

Run this only after the dry run reports the expected 698 customers, 1,547 vehicles, 188 items, and 6,714 transactions. The legacy export contains 102 discount rows; 49 reference deleted legacy customers and are skipped, while 53 valid discounts are imported.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cd /app/backend && python manage.py import_legacy_metrix /tmp/metrix_legacy.json --tenant-code metrix-weighbridge-solutions --replace --apply'
```

## Metrix production refresh and cutover (completed 9 November 2026)

Use the scoped cutover package for a refresh of an already configured Docker organization. Do not use the broad `import_legacy_metrix --replace` path for this operation: it deletes customer and branch records and can remove related configuration.

The prepared package is on Metrix at `/srv/sl-erp/backups/metrix-cutover-20261109/`. A restored, isolated copy of Docker passed rollback, application, repeat-application and authenticated API checks. The data copy completed successfully. Per the subsequent operating decision, the old service is active on the main address (HTTP port 80 redirects to its HTTPS port 443), while Docker remains separately available on HTTPS port 8088 for verification.

Rehearsal results from the live legacy Django source at `/opt/metrix_ws/sl-erp`:

- 8,028 source transactions; historical amounts, dates, weights and pairings checked per row.
- 767 customers reconciled by unique phone/email; existing account and customer identifiers retained.
- 44 effective customer/vehicle tariffs. Lowest legacy discount ID wins, matching legacy pricing. 49 orphan rows excluded; one general customer discount retained.
- 257 Docker test transactions and their 169 test invoices removed; five historical invoices retained.
- 319 Metrix notifications cleared. Audit history, accounts, passwords, permissions, branding, organization settings and other tenants preserved.

Activation takes a fresh export after writes are paused; the final counts may therefore increase. It backs up both databases again, updates only the approved records, checks protected-data digests, routes both HTTPS addresses to Docker, and stops and disables `sl-erp.service`. The legacy database and application files remain available for rollback.

Historical one-time cutover command (do not run for the current parallel-verification setup):

```powershell
ssh -t metrix@ws.metrixws.co.ke "sudo python3 /srv/sl-erp/backups/metrix-cutover-20261109/activate.py"
```

Enter the Metrix Linux password only in the terminal's sudo prompt. Keep the terminal open until `METRIX CUTOVER COMPLETE` appears. Both `https://ws.metrixws.co.ke` and `https://ws.metrixws.co.ke:8088` then serve Docker. Existing `/live_weight` and `/stable_weight` bridge routes are preserved.

Read-only readiness check before initial activation (the original-state assertions intentionally fail after a successful cutover):

```powershell
ssh metrix@ws.metrixws.co.ke "python3 /srv/sl-erp/backups/metrix-cutover-20261109/activate.py --check"
```

Final backups and row mapping are kept in a private `run-<UTC timestamp>/` subdirectory. `live.json` records successful activation. Before reopening, a failure restores the final Docker backup and original routing. After public routing opens, the script retains the new database to protect any new live writes and reports failures for investigation.

This operation does not push code or deploy unrelated local edits.

Final outcome: **8,029 transactions**, **767 customers**, **44 effective customer/vehicle rates**, **five retained historical invoices**, and **zero notifications**. Historical charges total **KES 3,275,800.00**, matching the final source export. The final copy includes one transaction entered after the initial rehearsal.

Copied records were aligned from the inactive `Athi River Branch` operational record to the existing active `Athi River` branch. No user memberships, branch access, indicator settings or branding were changed. Pending first weights therefore remain available under the staff's active branch.

The approved test cleanup removed 257 transactions, 169 invoices, and one related accounting posting with two journal lines. Other journal history, balances and account definitions were retained. Existing audit history was checked as an immutable prefix while permitting new access events and the surveillance heartbeat.

A focused invoice-numbering fix was applied to Metrix without a Git push: numbers continue after the highest retained numeric reference, rather than counting remaining rows. Three regression tests passed both locally and in the production runtime. The next reference at verification was `INV-2026-0155`. The fixed image is `sl-erp-backend:metrix-numbering-20261109`; default backend/worker image aliases and host source also retain it. Unrelated local document/PDF edits remain undeployed.

Final frozen-source backups: `/srv/sl-erp/backups/metrix-cutover-20261109/run-20261109T050157Z/`. The private parent directory contains `live.json`, targeted ledger and branch rollback records, rollback image references and verification reports. The old application's source files and database remain intact for recovery. No code was pushed to GitHub.

### Current operating mode: parallel verification

The old Django service has been restored and enabled at boot. `http://ws.metrixws.co.ke:80` retains its existing redirect to `https://ws.metrixws.co.ke`, and both lead to the old application. Docker remains at `https://ws.metrixws.co.ke:8088` with its imported data, reconciled customers, rates, invoice cleanup and numbering fix intact. Both applications were verified publicly. This routing restoration did not restore, delete or re-import either database.

The two databases are independent. New activity in the old system is not automatically copied to Docker. A final coordinated copy will be needed before a later, explicitly requested permanent switch. No code has been pushed.

Current routing record: `/srv/sl-erp/backups/metrix-cutover-20261109/parallel-verification.json`.

### Commodity picker and receipt time correction (9 November 2026)

Applied scoped release `metrix-items-time-20261109` to Docker on HTTPS port 8088. The legacy service and main-address routing remain unchanged. No code was pushed.

- Cashiers already had add-item permission. Transaction pickers now request the complete authorized branch catalogue (`picker=1`), rather than only the first page. New items remain selectable after a refetch or reopening the form; the settings listing stays paginated.
- Aligned 169 imported commodities from inactive operational branch 5 (Athi River Branch) to active operational branch 6 (Athi River). Only item branch references changed. Names, prices, transactions, accounts, permissions, and organization/device settings were checked and preserved.
- Print/PDF/email receipt dates use the organization's configured timezone. The preview receives `receipt_timezone` from the transaction API. Original UTC capture timestamps remain unchanged; Africa/Nairobi converts 08:35 UTC to 11:35 AM.
- All 654 production-runtime tests passed, including nine new picker/permission/time regressions. All four active cashier accounts passed create-and-select checks in rolled-back test transactions. No test commodities were retained.

Backup and item rollback references: `/srv/sl-erp/backups/releases/metrix-items-time-20261109/` and `/srv/sl-erp/releases/metrix-items-time-20261109/item-branches-before.json`. The release directory includes exact patch hashes, the verification report, previous image IDs, and the deployment result. The previous invoice-numbering correction is retained.

### Editable second-weight details (9 November 2026)

Applied `metrix-second-weight-20261109` to Docker on HTTPS port 8088. No branch reset, Git push, schema migration, or historical data rewrite was performed. The legacy service and its main-address routing remain active.

The routed `WeighmentEntryPage` now prefills the commodity and driver from the pending first-weight ticket and lets the cashier edit both. Existing `EMPTY` commodities represent empty returns. Edited item, driver name, and driver phone are kept consistent on both paired records, including manual approval. Older clients that omit these fields inherit the pending ticket's details. Original capture timestamps and the existing pricing workflow are retained.

The complete branch-scoped item query and quick-add cache/selection logic were compared with the prior release and are unchanged. Search entries now include their record IDs in command values so duplicate catalogue labels remain distinct. Receipt-time and invoice-numbering source files were checked against their previous deployed hashes.

All 663 production-runtime tests passed, including nine second-weight regressions and the camera-recognition tests. All four active cashier accounts passed authenticated catalogue/workflow-context checks. Public frontend assets, API health, worker responsiveness, and legacy/Docker separation were verified.

Release and verification records: `/srv/sl-erp/releases/metrix-second-weight-20261109/`. Database and source rollback backups: `/srv/sl-erp/backups/releases/metrix-second-weight-20261109/`. Previous images are retained under the `before-second-weight-20261109` tags.

### Application shell cache correction (2026-11-09)

Release: metrix-shell-cache-20261109. Metrix Docker serves the second-weight commodity selector in its current bundle. Added no-store headers to the application HTML and no-cache to sw.js so refreshes request the current shell. Verified all public page routes and exact frontend assets. Only the frontend container was recreated; backend, workers, database and old system retained their existing containers/routing. No GitHub push. Backup: /srv/sl-erp/backups/releases/metrix-shell-cache-20261109.


### Documents settings and QR policy (2026-11-09)

Release: metrix-documents-20261109. Organization Settings now uses one Documents tab with responsive popup editors, a layout list for all six supported document types, and visible QR controls with a separate Save QR settings button. The defaults popup keeps its save footer visible. Both save requests were verified with rollback-only API checks. All 669 production-runtime tests, frontend checks/build and public asset/health checks passed. Migration Platform_Core.0078_tenant_document_qr_policy was rehearsed with all business records and all schemas; historical audit payloads were excluded only from the temporary test copy due to limited disk space. The live migration preserved all existing data, including audit history. Temporary test databases, volumes and runtime environment files were removed. Previous Metrix weighbridge fixes, accounts, branding, template assignments and legacy main-address routing remain. Backup: /srv/sl-erp/backups/releases/metrix-documents-20261109. No GitHub push.


### Invoice preparer display removal (2026-11-09)

Release: metrix-invoice-preparer-20261109. Removed the printed Prepared by row from all five built-in invoice layouts, including direct template previews. Existing untouched shared layouts upgrade in place; custom templates and internal creator metadata remain intact. Verified five preview PDFs and an actual invoice, 39 affected production-runtime tests, 12 local billing tests, public health/frontend integrity and worker ping. No schema change or GitHub push. Backup: /srv/sl-erp/backups/releases/metrix-invoice-preparer-20261109.


### Shared Docker release (2026-11-09)

Release: shared-docker-20261109T145922Z. Current reviewed source was deployed to both SL-ERP and Metrix Docker applications. Each production runtime passed all 679 tests; the local suite, frontend typecheck/build, rollback-only organization APIs, document/QR/PDF checks and Metrix cashier/receipt checks passed. Both running configurations retained signing keys and database settings. Database backups and before/after record hashes verified that business records, accounts, organization settings and custom layouts were preserved. Only reviewed shared built-in layout bodies/styles upgraded. Docker Compose files, service ports and database/Redis images were retained. Public document-link origins now use the actual HTTPS addresses. Temporary runtime environment files were removed; database backups and rollback images remain. Metrix main-address legacy service remains active and enabled, with Docker on HTTPS :8088. No GitHub push.


### 2026-11-10: Workflow approval notification fix

Deployed `metrix-workflow-20261110` to the Metrix Docker app on HTTPS port 8088.
The legacy main-address system remains active and enabled. SL-ERP was not redeployed by this scoped fix.

Approval and rejection previously reused the assignment notification's unique source event.
When the submitter was also in the approval role, creating the outcome notification raised
`uniq_notification_per_source_event` and rolled the decision back. Completion and rejection
now have separate, idempotent notification events; existing notification history is retained.
The frontend API error parser now presents readable errors instead of `[object Object]`.

Validation: all 681 tests passed in the Metrix production runtime; the 10 local workflow tests,
frontend error regression checks, workspace type checking and frontend production build passed.
The reported request was rehearsed with its actual supervisor: approve and reject both returned
HTTP 200, and all business decisions were rolled back. Public HTTPS checks matched all 11 new
assets, the workflow route, JavaScript/PDF-worker MIME types and health endpoint; Celery replied pong.

The first deployment automatically rolled back because its strict snapshot check noticed normal
surveillance startup activity. Backup-to-live comparison confirmed existing alert business fields
were unchanged: only discrepancy-sweep flags/timestamps and newly appended monitoring records
were involved. The successful retry kept strict business/auth/config hashes, checked original
monitor rows by their existing IDs, and allowed only those verified background changes.
No schema migrations, account/permission changes, environment changes or GitHub push were made.

Release and verification records: `/srv/sl-erp/releases/metrix-workflow-20261110/`.
First-attempt backup retained at `/srv/sl-erp/backups/releases/metrix-workflow-20261110/`;
successful retry backup at its `attempt-2/` subdirectory. The PostgreSQL dump checksum was verified.


### 2026-11-10: Matching SL-ERP workflow fix

Deployed the identical workflow notification and readable API-error patch to
`https://erp.siakoralabs.co.ke` as `erp-workflow-20261110`. The SL-ERP runtime's 10
workflow regression tests passed; the same application patch had already passed
all 681 tests on Metrix. Approval and rejection of temporary validation requests
both returned HTTP 200 and were rolled back, retaining existing notification history.

Verified the public workflow page, all 11 frontend asset hashes, PDF-worker MIME,
health endpoint, running images/source hashes, Celery pong and database dump checksum.
Existing business records, accounts, permissions and runtime configuration were preserved.
No migrations or GitHub push were needed. Release records are under
`/srv/sl-erp/releases/erp-workflow-20261110/`; the backup is under
`/srv/sl-erp/backups/releases/erp-workflow-20261110/` on the SL-ERP server.
