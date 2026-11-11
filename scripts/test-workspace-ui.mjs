import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";
const source = fs.readFileSync(
  "artifacts/erp-ui/src/lib/workspace-tabs.ts",
  "utf8",
);
const model = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpile(source, {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      }),
    ).toString("base64")
);
let state = model.createWorkspace();
const reduce = (a) => (state = model.workspaceReducer(state, a));
reduce({ type: "open", path: "/sales/customers" });
const first = state.activeId;
reduce({ type: "navigate", id: first, path: "/sales/customers/1" });
reduce({ type: "travel", id: first, delta: -1 });
assert.equal(model.tabPath(state.tabs[1]), "/sales/customers");
reduce({ type: "open", path: "/projects/tasks" });
const second = state.activeId;
reduce({ type: "move", id: second, index: 0 });
assert.equal(state.tabs[0].id, "home");
assert.equal(state.tabs[1].id, second);
reduce({ type: "close", ids: state.tabs.map((t) => t.id) });
assert.equal(state.tabs.length, 1);
const restored = model.restoreWorkspace(
  JSON.stringify({
    tabs: [
      null,
      {
        root: "/sales/customers",
        history: ["https://evil.test", "/sales/customers/1"],
        cursor: 99,
      },
      { root: "/sales/customers", history: ["/wrong"] },
      { root: "//bad" },
    ],
  }),
  "/sales/customers/1",
);
assert.equal(restored.tabs.length, 2);
assert.equal(model.tabPath(restored.tabs[1]), "/sales/customers/1");
assert.equal(model.workspacePath("https://bad.test"), "/home");
assert.equal(model.workspacePath("/login/tenant"), "/home");
console.log("PASS workspace state, history, pinned Home, corrupt restore");
fs.mkdirSync("tmp/workspace-ui", { recursive: true });
const browserLibraries =
  process.cwd() + "/tmp/workspace-ui/linux-libs/usr/lib/x86_64-linux-gnu";
if (fs.existsSync(browserLibraries))
  process.env.LD_LIBRARY_PATH = [browserLibraries, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const user = {
  id: 42,
  username: "ui.admin",
  first_name: "UI",
  last_name: "Tester",
  organization_id: 1,
  tenant_id: 1,
  organization_name: "Demo Organization",
  organization_code: "demo",
  branch_id: 1,
  is_tenant_admin: true,
  active_role: "tenant_admin",
  permissions: [],
  memberships: [],
};
let customers = Array.from({ length: 27 }, (_, i) => ({
  id: i + 1,
  name:
    i === 0 ? "=Formula test" : "Customer " + String(i + 1).padStart(2, "0"),
  email: "client" + i + "@example.test",
  phone_number: "070000" + i,
  address: "Nairobi",
  transaction_count: 2,
  invoice_count: 1,
}));
const requests = [],
  errors = [],
  consoleErrors = [];
await context.addInitScript((user) => {
  localStorage.setItem("sl-erp-token", "ui-test-token");
  localStorage.setItem("sl-erp-user", JSON.stringify(user));
  localStorage.setItem("sl-erp-last-activity", String(Date.now()));
}, user);
await context.route("**/api/**", async (route) => {
  const req = route.request(),
    url = new URL(req.url());
  requests.push([req.method(), url.pathname]);
  let data = {
    data: {},
    results: [],
    count: 0,
    branches: [],
    customers: [],
    projects: [],
    tasks: [],
    invoices: [],
    suppliers: [],
    items: [],
    transactions: [],
    requisitions: [],
    orders: [],
    staff: [],
    employees: [],
    warehouses: [],
    stock: [],
    products: [],
    summary: {},
    settings: {},
    pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 1 },
  };
  if (url.pathname.endsWith("/auth/me/")) data = user;
  else if (url.pathname.includes("/tenants/self/"))
    data = {
      id: 1,
      name: "Demo Organization",
      code: "demo",
      timezone: "Africa/Nairobi",
    };
  else if (/\/tenants\/1\/settings\//.test(url.pathname))
    data = { primary_color: "#2563eb", workspace_name: "Demo ERP" };
  else if (url.pathname.includes("/workspace/navigation/"))
    data = {
      active_module_slugs: [
        "sales",
        "projects-tasks",
        "invoicing",
        "procurement",
        "inventory",
        "crm",
        "hr",
        "finance",
        "ticketing",
        "reporting",
        "weighbridge",
      ],
      sections: [
        {
          key: "home",
          title: "Workspace",
          items: [
            { title: "Customers", path: "/sales/customers" },
            { title: "All Tasks", path: "/projects/tasks" },
            { title: "Invoices", path: "/payments/invoices" },
            { title: "Suppliers", path: "/crm/suppliers" },
          ],
        },
      ],
    };
  else if (url.pathname.includes("/public/site/"))
    data = {
      tenant: { id: 1, name: "Demo Organization", code: "demo" },
      branding: { primary_color: "#2563eb" },
      settings: {},
    };
  else if (url.pathname.includes("/sales/customers/")) {
    if (req.method() === "POST") {
      const item = {
        ...req.postDataJSON(),
        id: 99,
        transaction_count: 0,
        invoice_count: 0,
      };
      customers.push(item);
      data = item;
    } else {
      const search = url.searchParams.get("search")?.toLowerCase() || "";
      data = {
        customers: customers.filter((c) =>
          c.name.toLowerCase().includes(search),
        ),
      };
    }
  } else if (url.pathname.includes("/notifications/"))
    data = {
      count: 2,
      unread_count: 2,
      results: [{ id: 1, title: "Ready to review", message: "Demo notice" }],
    };
  else if (url.pathname.includes("/workflows/inbox/"))
    data = {
      count: 1,
      results: [{ id: 2, title: "Review requisition", status: "pending" }],
    };
  else if (["/api/accounting/chart-of-accounts/", "/api/accounting/transactions/"].includes(url.pathname)) data = [];
  else if (url.pathname === "/api/accounting/journals/") data = {journals:[]};
  else if (url.pathname === "/api/ticketing/tickets/") data = [];
  else if (url.pathname === "/api/ticketing/tickets/options/")
    data = {
      can_create: true,
      can_change: true,
      channels: [],
      project_names: [],
    };
  else if (url.pathname === "/api/projects/settings/")
    data = {
      task_types: [
        {
          value: "general",
          label: "General",
          category: "General",
          is_active: true,
        },
      ],
      allow_custom_task_types: true,
      default_task_type: "general",
      default_priority: "medium",
      default_task_status: "draft",
      enabled_task_statuses: ["draft", "todo", "in_progress", "completed"],
      default_due_days: null,
      default_follow_up_days: 1,
      default_page_size: 10,
      can_manage: true,
      updated_at: null,
    };
  else if (/\/projects\/tasks\/(?:\d+\/)?assignees\//.test(url.pathname))
    data = [];
  else if (url.pathname === "/api/projects/task-types/") data = [];
  else if (url.pathname.includes("/projects/tasks/"))
    data = {
      count: 1,
      results: [
        {
          id: 3,
          title: "Prepare invoice",
          number: "TSK-0003",
          status: "in_progress",
        },
      ],
    };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.setDefaultTimeout(15000);
const base = process.env.UI_TEST_URL || "http://127.0.0.1:5193";
const active = () => page.locator("[data-workspace-tab-panel]:visible");
try {
  await page.goto(base + "/home", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByRole("heading", { name: "Welcome, UI" }).waitFor();
  await page.screenshot({ path: "tmp/workspace-ui/home-desktop.png" });
  await page.locator('aside a[href="/sales/customers"]').first().click();
  await active()
    .getByRole("heading", { name: "Customers", exact: true })
    .waitFor();
  await active().getByText("Customer 02", { exact: true }).waitFor();
  await page.screenshot({ path: "tmp/workspace-ui/customers-desktop.png" });
  assert.equal(await active().locator("[data-erp-table-toolbar]").count(), 1);
  const toolbar = () =>
    active().getByRole("toolbar", { name: "Table controls" });
  assert.equal(
    await toolbar().evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(37, 99, 235)",
  );
  const geometry = await toolbar().evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollWidth,
    width: el.clientWidth,
  }));
  assert.ok(geometry.height < 70);
  assert.ok(
    geometry.scroll <= geometry.width + 1,
    "Desktop toolbar fits one line",
  );
  const footer = () => active().locator("[data-erp-pagination]");
  assert.match(await footer().innerText(), /Rows:\s*10/);
  await footer().getByRole("button", { name: "Next", exact: true }).click();
  await expect(footer()).toContainText("Page 2 of 3");
  await footer().getByRole("button", { name: "Previous", exact: true }).click();
  await footer().getByRole("combobox").click();
  await page.getByRole("option", { name: "25", exact: true }).click();
  await expect(footer()).toContainText("Showing 1-25 of 27");
  await toolbar().getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Filter value", exact: true })
    .fill("Customer 02");
  await page.keyboard.press("Escape");
  assert.equal(await active().locator("tbody tr:visible").count(), 1);
  await toolbar().getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await page.keyboard.press("Escape");
  await active().getByText("Customer 02", { exact: true }).click();
  await toolbar()
    .getByRole("button", { name: "Selected record actions" })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await active()
    .getByRole("region", { name: "Edit Customer", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.screenshot({ path: "tmp/workspace-ui/customer-edit-desktop.png" });
  await active()
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(
    active().getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();
  const search = () => toolbar().getByPlaceholder(/Search by name/);
  await search().fill("Customer 02");
  await expect(active().locator("tbody tr:visible")).toHaveCount(1);
  await expect(
    toolbar().getByRole("button", { name: "Selected record actions" }),
  ).toHaveCount(0);
  await toolbar()
    .getByRole("button", { name: "New Customer", exact: true })
    .click();
  const record = () =>
    active().getByRole("region", { name: "New Customer", exact: true });
  await record().locator("input").first().fill("Draft Customer");
  await page.locator('aside a[href="/payments/invoices"]').first().click();
  await expect(
    page.getByRole("tab", { name: "Invoices", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Customers/ }).click();
  await expect(record().locator("input").first()).toHaveValue("Draft Customer");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Close Customers", exact: true })
    .click();
  await expect(record()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await active()
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(search()).toHaveValue("Customer 02");
  await search().fill("");
  await expect(active().locator("tbody tr:visible")).toHaveCount(25);
  await toolbar()
    .getByRole("button", { name: "New Customer", exact: true })
    .click();
  await record().locator("input").nth(0).fill("Saved Customer");
  await record().locator("input").nth(1).fill("0700999999");
  await record()
    .getByRole("button", { name: "Create Customer", exact: true })
    .click();
  await expect(record()).toHaveCount(0);
  assert.ok(
    requests.some(
      ([method, path]) => method === "POST" && path === "/api/sales/customers/",
    ),
  );
  await toolbar()
    .getByRole("button", { name: "Choose displayed columns" })
    .click();
  await page
    .getByRole("menuitemcheckbox", { name: "Email", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    active().getByRole("columnheader", { name: "Email", exact: true }),
  ).toBeHidden();
  const csv = await active()
    .locator("table")
    .evaluate(async (el) => {
      const { tableTextRows, toCsv } = await import("/src/lib/table-tools.ts");
      return toCsv(tableTextRows(el, [2]));
    });
  assert.ok(csv.includes("'=Formula test"));
  assert.ok(!csv.includes("@example.test"));
  const downloadPromise = page.waitForEvent("download");
  await toolbar()
    .getByRole("button", { name: "Export displayed rows", exact: true })
    .click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "displayed-records.csv");
  await toolbar()
    .getByRole("button", { name: "Print displayed rows", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="Print displayed records"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Manage workspace tabs" }).click();
  await page.getByRole("menuitem", { name: "Move right", exact: true }).click();
  assert.deepEqual(
    await page
      .locator("[data-workspace-window-tabs] [role=tab]")
      .allTextContents(),
    ["Home", "Invoices", "Customers"],
  );
  await page
    .getByRole("tab", { name: /^Customers/ })
    .locator("..")
    .dragTo(
      page.getByRole("tab", { name: "Invoices", exact: true }).locator(".."),
    );
  assert.deepEqual(
    await page
      .locator("[data-workspace-window-tabs] [role=tab]")
      .allTextContents(),
    ["Home", "Customers", "Invoices"],
  );
  await page.getByRole("button", { name: "Manage workspace tabs" }).click();
  await page
    .getByRole("menuitem", { name: "Close other tabs", exact: true })
    .click();
  assert.deepEqual(
    await page
      .locator("[data-workspace-window-tabs] [role=tab]")
      .allTextContents(),
    ["Home", "Customers"],
  );
  await page.reload();
  await expect(
    active().getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.getByRole("tab", { name: "Home", exact: true }).count(),
    1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    toolbar().getByRole("button", { name: "Filters", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "tmp/workspace-ui/customers-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No whole-page horizontal overflow",
  );
  const mobileBar = await toolbar().evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollWidth,
    width: el.clientWidth,
  }));
  assert.ok(
    mobileBar.height < 75,
    "Mobile toolbar stays one line with horizontal scroll",
  );
  await toolbar().getByRole("button", { name: "More table tools" }).click();
  await page.getByRole("button", { name: "New Customer", exact: true }).click();
  await expect(page.locator(".erp-toolbar-overflow-panel")).toBeHidden();
  await page.screenshot({ path: "tmp/workspace-ui/customer-new-mobile.png" });
  assert.ok(
    await record().evaluate(
      (el) => el.getBoundingClientRect().width <= innerWidth,
    ),
    "Form fits mobile",
  );
  await record().getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Manage workspace tabs" }).click();
  await page
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome, UI" }),
  ).toBeVisible();
  assert.equal(
    await page.locator("[data-workspace-window-tabs] [role=tab]").count(),
    1,
  );
  await page.screenshot({ path: "tmp/workspace-ui/home-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const routes = [
    "/projects/tasks",
    "/ticketing/queue",
    "/procurement/requisitions",
    "/inventory/stock",
    "/hr/staff",
    "/crm/companies",
    "/accounting/transactions",
    "/payments/invoices",
    "/sales/estimates",
    "/purchases/bills",
    "/weighbridge/transactions",
    "/platform/users",
    "/platform/roles",
    "/projects/settings",
    "/weighbridge/vehicles",
  ];
  for (const route of routes) {
    await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("sl-erp-windows-v1:"))
        .forEach((key) => sessionStorage.removeItem(key)),
    );
    await page.goto(base + route, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await expect(active()).toBeVisible();
    await expect(
      active().getByText("Loading workspace...", { exact: true }),
    ).toHaveCount(0, { timeout: 20000 });
    await page.waitForTimeout(350);
    assert.equal(errors.length, 0, "Render " + route);
    assert.equal(
      await page
        .getByText("This workspace needs to reload", { exact: true })
        .count(),
      0,
      "Boundary " + route,
    );
    if (route === "/projects/tasks") {
      const filters = active().getByRole("button", { name: /^Filters/ });
      await expect(filters).toHaveCount(1);
      await filters.click();
      await expect(
        active().getByRole("heading", { name: "Filters and sorting" }),
      ).toBeVisible();
      await filters.click();
      await page.screenshot({ path: "tmp/workspace-ui/tasks-desktop.png" });
    }
    if (route === "/payments/invoices") {
      await expect(
        active()
          .getByRole("toolbar")
          .getByRole("button", { name: "New Invoice", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: "tmp/workspace-ui/invoices-desktop.png" });
    }
    if (route === "/weighbridge/transactions") {
      await expect(active().locator("[data-erp-pagination]")).toHaveCount(1);
      await expect(
        active()
          .getByRole("toolbar")
          .getByRole("button", { name: "Bulk actions (0)", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: "tmp/workspace-ui/transactions-desktop.png",
      });
    }
    console.log("PASS module", route);
  }
  const access = await page.evaluate(async () => {
    const { evaluateWorkspaceRouteAccess } =
      await import("/src/lib/workspace-access.ts");
    return {
      home: evaluateWorkspaceRouteAccess({
        path: "/home",
        role: "operator",
        activeModuleSlugs: [],
        permissions: [],
        isPermissionDrivenRole: true,
      }),
      customers: evaluateWorkspaceRouteAccess({
        path: "/sales/customers",
        role: "operator",
        activeModuleSlugs: ["sales"],
        permissions: [],
        isPermissionDrivenRole: true,
      }),
      module: evaluateWorkspaceRouteAccess({
        path: "/sales/customers",
        role: "tenant_admin",
        activeModuleSlugs: [],
        permissions: [],
      }),
    };
  });
  assert.equal(access.home.allowed, true);
  assert.equal(access.customers.allowed, false);
  assert.equal(access.module.allowed, false);
  assert.deepEqual(errors, [], "No browser exceptions");
  assert.deepEqual(consoleErrors, [], "No React or browser console errors");

  console.log(
    "PASS toolbar branding/layout, search/filter, bottom pagination, page forms, draft preservation, save, tab close/reorder/restore, CSV/print/columns, desktop/mobile",
  );
} catch (error) {
  await page.screenshot({ path: "tmp/workspace-ui/failure.png" });
  fs.writeFileSync(
    "tmp/workspace-ui/failure.txt",
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  fs.writeFileSync(
    "tmp/workspace-ui/test-requests.json",
    JSON.stringify(requests, null, 2),
  );
  await browser.close();
}
