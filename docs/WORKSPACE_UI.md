# SL-ERP workspace UI

Home is the pinned default workspace. It shows notifications, pending workflow activities, and assigned tasks using the current organization, branch, and role. The performance Dashboard remains a separate page.

## Tabs and pages

- Open modules from the left menu. Each module opens or focuses a workspace tab.
- Drag tabs to reorder them, or use the tab menu to move them left or right.
- The tab menu can close the current tab, other tabs, all tabs, or tabs to the right. Home stays open.
- Record forms and detail drawers open as pages inside the current tab. Previous returns to the underlying list. Route history also supports Previous and Next.
- Switching workspace tabs preserves mounted forms and list state. Closing a tab or leaving a record page warns about unsaved input. Cancel explicitly discards that form.
- Tab routes and order are stored in session storage, scoped to the user, membership, organization, branch, and role. Form values are never persisted by the workspace. Refreshing a page does not restore a draft.
- Confirmation dialogs, command palettes, and shell utility panels retain their existing presentation.

## Table controls

Shared tables use a compact toolbar with the organization's primary branding color. Search, filters, available module actions, refresh, permitted exports/printing, column visibility, and selected-record actions are grouped together. The page heading stays outside the toolbar.

On mobile, search and Filters stay visible. The tools menu contains secondary actions. Wide tables scroll within their own frame. Page controls and row counts stay below the records.

Existing server search, pagination, permissions, and action handlers are retained. Generic table search/filters and Export displayed rows operate on the currently loaded rows. Existing module-specific exports retain their original scope. Tables with existing pagination do not receive a second client paginator. Other tables paginate loaded rows locally.

## Validation

From the repository root, use Linux/WSL with Node and pnpm:

```bash
pnpm run typecheck
pnpm --filter @workspace/erp-ui run build
```

The interaction suite uses mocked API data and never modifies live ERP records. Install the Playwright Chromium test browser and its Linux dependencies if needed, then run a separate frontend server:

```bash
pnpm exec playwright install --with-deps chromium
pnpm --filter @workspace/erp-ui exec vite --host 127.0.0.1 --port 5193
```

In another terminal:

```bash
pnpm run test:workspace-ui
```

Set `UI_TEST_URL` to use another local test port. Screenshots and temporary test output are written under `tmp/workspace-ui/`.

The suite covers Home, workspace history and corrupt stored-state recovery, row selection/actions, server search, column filtering, pagination and row size, record pages, save handlers, unsaved-change protection, tab reorder/close/restore, displayed-row CSV/printing, mobile layouts, module smoke rendering, and route permission/module guards.
