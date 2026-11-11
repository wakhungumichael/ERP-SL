/* Copyright (c) 2026 Siakora Labs Limited. */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useId,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
export type TableController = {
  id: string;
  columns: string[];
  hiddenColumns: number[];
  toggleColumn: (index: number) => void;
  filterColumn: number;
  filterValue: string;
  setFilterColumn: (value: number) => void;
  setFilterValue: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  refresh: () => void;
  exportRows: () => void;
  print: () => void;
  actions: Array<{ label: string; disabled: boolean; run: () => void }>;
};
type ListingScope = {
  primary: TableController | undefined;
  externalToolbar: string | undefined;
  pagination: boolean;
  register: (table: TableController) => void;
  unregister: (id: string) => void;
  toolbar: (id: string, present: boolean) => void;
  pageControls: (id: string, present: boolean) => void;
  toolbarDock: HTMLElement | null;
  setToolbarDock: (element: HTMLElement | null) => void;
  paginationTarget: HTMLElement | null;
  setPaginationTarget: (element: HTMLElement | null) => void;
  target: HTMLElement | null;
  setTarget: (element: HTMLElement | null) => void;
};
const Context = createContext<ListingScope | null>(null);
export const useListingScope = () => useContext(Context);
export function ERPListingScope({ children }: { children: ReactNode }) {
  const [tables, setTables] = useState<TableController[]>([]);
  const [bars, setBars] = useState<string[]>([]);
  const [pages, setPages] = useState<string[]>([]);
  const [toolbarDock, setToolbarDock] = useState<HTMLElement | null>(null);
  const [paginationTarget, setPaginationTarget] = useState<HTMLElement | null>(
    null,
  );
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const register = useCallback(
    (table: TableController) =>
      setTables((previous) =>
        previous.some((entry) => entry.id === table.id)
          ? previous.map((entry) => (entry.id === table.id ? table : entry))
          : [...previous, table],
      ),
    [],
  );
  const unregister = useCallback(
    (id: string) =>
      setTables((previous) => previous.filter((table) => table.id !== id)),
    [],
  );
  const toolbar = useCallback(
    (id: string, present: boolean) =>
      setBars((previous) =>
        present
          ? previous.includes(id)
            ? previous
            : [...previous, id]
          : previous.filter((entry) => entry !== id),
      ),
    [],
  );
  const pageControls = useCallback(
    (id: string, present: boolean) =>
      setPages((previous) =>
        present
          ? previous.includes(id)
            ? previous
            : [...previous, id]
          : previous.filter((entry) => entry !== id),
      ),
    [],
  );
  const value = useMemo(
    () => ({
      primary: tables[0],
      externalToolbar: bars[0],
      pagination: pages.length > 0,
      register,
      unregister,
      toolbar,
      pageControls,
      target,
      setTarget,
      paginationTarget,
      setPaginationTarget,
      toolbarDock,
      setToolbarDock,
    }),
    [
      tables,
      bars,
      pages,
      register,
      unregister,
      toolbar,
      pageControls,
      target,
      paginationTarget,
      toolbarDock,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** Page-level actions move into the table toolbar without changing handlers or permissions. */
export function ERPListingActions({ children }: { children: ReactNode }) {
  const scope = useListingScope();
  if (scope?.target) return createPortal(children, scope.target);
  return <>{children}</>;
}

/** Existing server pagination keeps its callbacks, with row size controls below. */
export function ERPExistingPagination({ children }: { children: ReactNode }) {
  const id = useId();
  const scope = useListingScope();
  useLayoutEffect(() => {
    scope?.pageControls(id, true);
    return () => scope?.pageControls(id, false);
  }, [id, scope?.pageControls]);
  return (
    <div
      data-erp-pagination
      className="flex min-w-0 flex-wrap items-center gap-3 border-t bg-card p-3"
    >
      <div
        ref={scope?.setPaginationTarget}
        className="flex shrink-0 items-center gap-2"
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
export function ERPPageSizeControl({ children }: { children: ReactNode }) {
  const scope = useListingScope();
  if (scope?.paginationTarget)
    return createPortal(children, scope.paginationTarget);
  return scope ? null : <>{children}</>;
}

/** Keep the primary toolbar directly below the page heading, above summaries. */
export function ERPToolbarDock() {
  const scope = useListingScope();
  return scope ? (
    <div ref={scope.setToolbarDock} className="erp-toolbar-dock empty:hidden" />
  ) : null;
}
