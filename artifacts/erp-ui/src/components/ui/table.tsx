/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useListingScope,
  type TableController,
} from "@/components/erp/listing/listing-scope";
import { ERPTableToolbar } from "@/components/erp/listing/table-toolbar";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { downloadTable, printTable } from "@/lib/table-tools";

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  paginate?: boolean;
  toolbar?: boolean;
};
type RowAction = TableController["actions"][number] & { element: HTMLElement };
const Table = React.forwardRef<HTMLTableElement, TableProps>(
  (
    { className, children, paginate = true, toolbar = true, ...props },
    forwardedRef,
  ) => {
    const scope = useListingScope();
    const client = useQueryClient();
    const [path] = useLocation();
    const id = "erp-table-" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
    const ref = React.useRef<HTMLTableElement | null>(null);
    const selected = React.useRef<HTMLTableRowElement | null>(null);
    const [columns, setColumns] = React.useState<string[]>([]);
    const [hidden, setHidden] = React.useState<number[]>([]);
    const [search, setSearch] = React.useState("");
    const [filterColumn, setFilterColumn] = React.useState(0);
    const [filterValue, setFilterValue] = React.useState("");
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(25);
    const [count, setCount] = React.useState(0);
    const [actions, setActions] = React.useState<RowAction[]>([]);
    const primary = scope?.primary?.id === id;
    const paging = Boolean(scope && paginate && !(primary && scope.pagination));
    const visibleToolbar = Boolean(
      scope && toolbar && !(primary && scope.externalToolbar),
    );
    const scan = React.useCallback(() => {
      const table = ref.current;
      if (!table) return;
      const labels = Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) =>
        (cell.textContent ?? "").trim(),
      );
      setColumns((previous) =>
        previous.join("|") === labels.join("|") ? previous : labels,
      );
      const rows = Array.from(table.tBodies).flatMap((body) =>
        Array.from(body.rows),
      );
      const dataRows = rows.filter((row) => {
        const placeholder = row.cells.length === 1 && row.cells[0].colSpan > 1;
        row.dataset.tablePlaceholder = String(placeholder);
        if (placeholder) {
          row.dataset.tableSearchHidden = "false";
          row.dataset.tablePageHidden = "false";
        }
        return !placeholder;
      });
      const found = dataRows.filter((row) => {
        const text =
          (row.textContent ?? "") +
          Array.from(
            row.querySelectorAll<HTMLInputElement>("input,select,textarea"),
          )
            .map((input) => input.value)
            .join(" ");
        const columnText = row.cells[filterColumn]?.textContent ?? "";
        const match =
          text.toLowerCase().includes(search.trim().toLowerCase()) &&
          columnText.toLowerCase().includes(filterValue.trim().toLowerCase());
        row.dataset.tableSearchHidden = String(!match);
        return match;
      });
      setCount(found.length);
      const safePage = Math.max(
        1,
        Math.min(page, Math.ceil(found.length / pageSize)),
      );
      found.forEach((row, index) => {
        row.dataset.tablePageHidden = String(
          paging &&
            (index < (safePage - 1) * pageSize || index >= safePage * pageSize),
        );
      });
      if (safePage !== page) setPage(safePage);
      if (
        selected.current &&
        (!table.contains(selected.current) ||
          selected.current.dataset.tableSearchHidden === "true" ||
          selected.current.dataset.tablePageHidden === "true")
      )
        selected.current = null;
      rows.forEach((row) => {
        row.dataset.toolbarSelected = String(row === selected.current);
      });
      const row = selected.current;
      const candidates = row
        ? Array.from(
            (
              row.cells[row.cells.length - 1] ?? row
            ).querySelectorAll<HTMLElement>("button,a[href]"),
          )
        : [];
      const next = candidates
        .filter(
          (element) =>
            element.getAttribute("aria-hidden") !== "true" && !element.hidden,
        )
        .map((element) => {
          const icon =
            element.querySelector("svg")?.getAttribute("class") ?? "";
          const inferred = /pencil|square-pen|edit/.test(icon)
            ? "Edit"
            : /trash/.test(icon)
              ? "Delete"
              : /download/.test(icon)
                ? "Download"
                : /printer/.test(icon)
                  ? "Print"
                  : /eye/.test(icon)
                    ? "View"
                    : /check/.test(icon)
                      ? "Approve"
                      : /ban|archive/.test(icon)
                        ? "Deactivate"
                        : /more|ellipsis/.test(icon)
                          ? "More actions"
                          : "Open record";
          return {
            element,
            label:
              element.getAttribute("aria-label") ||
              element.getAttribute("title") ||
              element.textContent?.trim() ||
              inferred,
            disabled:
              element.hasAttribute("disabled") ||
              element.getAttribute("aria-disabled") === "true",
            run: () => element.click(),
          };
        });
      setActions((previous) =>
        previous.length === next.length &&
        previous.every(
          (entry, index) =>
            entry.element === next[index].element &&
            entry.label === next[index].label &&
            entry.disabled === next[index].disabled,
        )
          ? previous
          : next,
      );
    }, [search, filterColumn, filterValue, page, pageSize, paging]);
    React.useLayoutEffect(() => {
      scan();
      const observer = new MutationObserver(scan);
      if (ref.current)
        observer.observe(ref.current, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      return () => observer.disconnect();
    }, [scan]);
    const refresh = React.useCallback(() => {
      const words = path
        .split("/")
        .filter(Boolean)
        .filter((value) => !/^\d+$/.test(value));
      const matches = client
        .getQueryCache()
        .findAll({
          type: "active",
          predicate: (query) =>
            words.some((word) =>
              JSON.stringify(query.queryKey)
                .toLowerCase()
                .includes(word.toLowerCase()),
            ),
        });
      return client.invalidateQueries(
        matches.length
          ? { predicate: (query) => matches.includes(query) }
          : { type: "active" },
      );
    }, [client, path]);
    const toggleColumn = React.useCallback(
      (index: number) =>
        setHidden((previous) =>
          previous.includes(index)
            ? previous.filter((value) => value !== index)
            : [...previous, index],
        ),
      [],
    );
    const searchRows = React.useCallback((value: string) => {
      setSearch(value);
      setPage(1);
    }, []);
    const exportRows = React.useCallback(() => {
      if (ref.current) downloadTable(ref.current, hidden);
    }, [hidden]);
    const print = React.useCallback(() => {
      if (ref.current) printTable(ref.current, hidden);
    }, [hidden]);
    const controller = React.useMemo<TableController>(
      () => ({
        id,
        columns,
        filterColumn,
        setFilterColumn,
        filterValue,
        setFilterValue,
        hiddenColumns: hidden,
        toggleColumn,
        search,
        setSearch: searchRows,
        refresh,
        exportRows,
        print,
        actions,
      }),
      [
        id,
        columns,
        filterColumn,
        filterValue,
        hidden,
        toggleColumn,
        search,
        searchRows,
        refresh,
        exportRows,
        print,
        actions,
      ],
    );
    React.useLayoutEffect(() => {
      if (toolbar) scope?.register(controller);
    }, [toolbar, scope?.register, controller]);
    React.useEffect(() => () => scope?.unregister(id), [scope?.unregister, id]);
    return (
      <div id={id} className="erp-table-frame min-w-0" data-erp-table-frame>
        {visibleToolbar ? <ERPTableToolbar controller={controller} /> : null}
        {hidden.length ? (
          <style>
            {hidden
              .map(
                (index) =>
                  `#${id} table tr>:nth-child(${index + 1}){display:none}`,
              )
              .join("")}
          </style>
        ) : null}
        <div className="relative w-full overflow-auto">
          <table
            {...props}
            ref={(node) => {
              ref.current = node;
              if (typeof forwardedRef === "function") forwardedRef(node);
              else if (forwardedRef) forwardedRef.current = node;
            }}
            className={cn("w-full caption-bottom text-sm", className)}
            onClick={(event) => {
              props.onClick?.(event);
              if (
                !(event.target as HTMLElement).closest(
                  "button,a,input,select,textarea,[role=checkbox]",
                )
              )
                selected.current = (event.target as HTMLElement).closest(
                  "tbody tr",
                );
              scan();
            }}
          >
            {children}
          </table>
        </div>
        {paging ? (
          <ListingPagination
            internal
            page={page}
            pageSize={pageSize}
            totalCount={count}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        ) : null}
      </div>
    );
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
