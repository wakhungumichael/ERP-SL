import { createPortal } from "react-dom";
/* Copyright (c) 2026 Siakora Labs Limited. */
import {
  Children,
  isValidElement,
  useId,
  useLayoutEffect,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Search,
  SlidersHorizontal,
  RefreshCw,
  Download,
  Printer,
  Columns3,
  MoreHorizontal,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useListingScope, type TableController } from "./listing-scope";

function hasTool(value: ReactNode, pattern: RegExp): boolean {
  return Children.toArray(value).some((child) => {
    if (typeof child === "string") return pattern.test(child);
    if (!isValidElement<{ children?: ReactNode }>(child)) return false;
    const component = child.type as { name?: string; displayName?: string };
    return (
      pattern.test(component.displayName || component.name || "") ||
      hasTool(child.props.children, pattern)
    );
  });
}
export function ERPTableToolbar({
  searchSlot,
  filterSlot,
  filterControl,
  toolsSlot,
  controlsSlot,
  controller,
  external = false,
}: {
  searchSlot?: ReactNode;
  filterSlot?: ReactNode;
  filterControl?: ReactNode;
  toolsSlot?: ReactNode;
  controlsSlot?: ReactNode;
  controller?: TableController;
  external?: boolean;
}) {
  const id = useId();
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 640px)").matches,
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsPanel, setToolsPanel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const panel = toolsPanel;
    if (!panel) return;
    const dismiss = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest("button,a[href]");
      if (button && !button.hasAttribute("aria-haspopup"))
        setTimeout(() => setToolsOpen(false), 0);
    };
    panel.addEventListener("click", dismiss);
    return () => panel.removeEventListener("click", dismiss);
  }, [toolsPanel]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const scope = useListingScope();
  const client = useQueryClient();
  const { role, user } = useAuth();
  const [path] = useLocation();
  useLayoutEffect(() => {
    if (external) scope?.toolbar(id, true);
    return () => {
      if (external) scope?.toolbar(id, false);
    };
  }, [external, id, scope?.toolbar]);
  const table = controller ?? scope?.primary;
  const isPrimary = external
    ? scope?.externalToolbar === id
    : scope?.primary?.id === controller?.id && !scope?.externalToolbar;
  const app = (
    {
      weighbridge: "SL_Weighbridge",
      payments: "SL_Weighbridge",
      projects: "SL_Projects",
      sales: "SL_Sales",
      procurement: "SL_Procurement",
      purchases: "SL_Procurement",
      inventory: "SL_Inventory",
      hr: "SL_HR",
      crm: "SL_CRM",
      finance: "Platform_Core",
      accounting: "Platform_Core",
    } as Record<string, string>
  )[path.split("/")[1]];
  const canExport =
    role === "superadmin" ||
    role === "tenant_admin" ||
    Boolean(
      app &&
      (Array.isArray(user?.permissions)
        ? (user.permissions as string[])
        : []
      ).some(
        (permission) =>
          permission.startsWith(app + ".") &&
          /(?:can_export|export_)/.test(permission),
      ),
    );
  const providedRefresh = hasTool(toolsSlot, /Refresh/i);
  const providedExport = hasTool(toolsSlot, /Export|Download/i);
  const providedPrint = hasTool(toolsSlot, /Print/i);
  const providedColumns =
    hasTool(toolsSlot, /Column/i) || hasTool(filterSlot, /Column/i);
  const filters =
    filterSlot ??
    (table ? (
      <>
        <label className="grid gap-2 text-sm">
          Column
          <select
            aria-label="Filter column"
            className="h-9 rounded-md border bg-background px-2"
            value={table.filterColumn}
            onChange={(event) =>
              table.setFilterColumn(Number(event.target.value))
            }
          >
            {table.columns.map((label, index) => (
              <option key={index} value={index}>
                {label || `Column ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <Input
          aria-label="Filter value"
          placeholder="Contains..."
          value={table.filterValue}
          onChange={(event) => table.setFilterValue(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => table.setFilterValue("")}
        >
          Clear filter
        </Button>
        <p className="text-xs text-muted-foreground">
          Filters the records loaded in this table.
        </p>
      </>
    ) : null);
  const refresh = () =>
    table ? table.refresh() : client.invalidateQueries({ type: "active" });
  const actions = (
    <div className="erp-toolbar-actions">
      {isPrimary ? (
        <div ref={scope?.setTarget} className="erp-toolbar-page-actions" />
      ) : null}
      {toolsSlot}
      {table?.actions.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              title="Selected record actions"
              aria-label="Selected record actions"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="hidden xl:inline">Record actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Selected record</DropdownMenuLabel>
            {table.actions.map((action, index) => (
              <DropdownMenuItem
                key={index}
                disabled={action.disabled}
                onSelect={() => {
                  action.run();
                  setToolsOpen(false);
                }}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {!providedRefresh ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={refresh}
          aria-label="Refresh records"
          title="Refresh records"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      ) : null}
      {canExport && table ? (
        <>
          {!providedExport ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={table.exportRows}
              aria-label="Export displayed rows"
              title="Export displayed rows as CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
          ) : null}
          {!providedPrint ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={table.print}
              aria-label="Print displayed rows"
              title="Print displayed rows"
            >
              <Printer className="h-4 w-4" />
            </Button>
          ) : null}
        </>
      ) : null}
      {table?.columns.length && !providedColumns ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Choose displayed columns"
              title="Choose displayed columns"
            >
              <Columns3 className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Displayed columns</DropdownMenuLabel>
            {table.columns.map((label, index) => (
              <DropdownMenuCheckboxItem
                key={index}
                checked={!table.hiddenColumns.includes(index)}
                disabled={
                  !table.hiddenColumns.includes(index) &&
                  table.columns.length - table.hiddenColumns.length === 1
                }
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => table.toggleColumn(index)}
              >
                {label || `Column ${index + 1}`}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
  const bar = (
    <div
      role="toolbar"
      aria-label="Table controls"
      className="erp-table-toolbar"
      data-erp-table-toolbar
    >
      <div className="erp-toolbar-controls">
        {controlsSlot ??
          (searchSlot ? (
            <div className="erp-toolbar-search">{searchSlot}</div>
          ) : table ? (
            <div className="erp-toolbar-search relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search displayed records"
                placeholder="Search displayed records..."
                className="h-9 pl-9"
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
              />
            </div>
          ) : null)}
        {filterControl ??
          (filters ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 gap-2"
                  title="Search filters"
                  aria-label="Filters"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">Filters</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="erp-toolbar-filter-panel flex max-h-[70vh] w-80 flex-col gap-3 overflow-y-auto p-4"
              >
                {filters}
              </PopoverContent>
            </Popover>
          ) : null)}
      </div>
      {compact ? (
        <Popover open={toolsOpen} onOpenChange={setToolsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="More table tools"
              title="More table tools"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            ref={setToolsPanel}
            forceMount
            align="end"
            className="erp-toolbar-overflow-panel w-[min(22rem,calc(100vw-2rem))] p-3 data-[state=closed]:hidden"
          >
            {actions}
          </PopoverContent>
        </Popover>
      ) : (
        actions
      )}
    </div>
  );
  return isPrimary && scope?.toolbarDock
    ? createPortal(bar, scope.toolbarDock)
    : bar;
}
