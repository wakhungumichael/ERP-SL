/* Copyright (c) 2026 Siakora Labs Limited. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace, useWorkspaceTab } from "@/context/workspace-context";

type RecordPage = {
  id: string;
  node: HTMLElement;
  title: string;
  close: () => void;
};
type PageFlow = {
  add: (page: RecordPage) => void;
  remove: (id: string) => void;
  change: (id: string) => void;
  close: (id: string) => void;
};
const PageFlowContext = createContext<PageFlow | null>(null);
export const usePageFlow = () => useContext(PageFlowContext);
function PageHost({
  page,
  active,
  onChange,
}: {
  page: RecordPage;
  active: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    host.appendChild(page.node);
    return () => {
      if (host.contains(page.node)) host.removeChild(page.node);
    };
  }, [page.node]);
  return (
    <div
      ref={ref}
      hidden={!active}
      data-workspace-page-host
      onChangeCapture={onChange}
      onInputCapture={onChange}
    />
  );
}
export function WorkspacePageFlow({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()!;
  const view = useWorkspaceTab()!;
  const tab = workspace.state.tabs.find((entry) => entry.id === view.id)!;
  const [pages, setPages] = useState<RecordPage[]>([]);
  const currentPages = useRef(pages);
  currentPages.current = pages;
  const dirty = useRef(new Set<string>());
  const add = useCallback(
    (page: RecordPage) =>
      setPages((previous) => {
        const existing = previous.find((entry) => entry.id === page.id);
        return existing
          ? previous.map((entry) => (entry.id === page.id ? page : entry))
          : [...previous, page];
      }),
    [],
  );
  const remove = useCallback(
    (id: string) => {
      dirty.current.delete(id);
      workspace.markDirty(view.id, id, false);
      setPages((previous) =>
        previous.some((page) => page.id === id)
          ? previous.filter((page) => page.id !== id)
          : previous,
      );
    },
    [workspace.markDirty, view.id],
  );
  const change = useCallback(
    (id: string) => {
      dirty.current.add(id);
      workspace.markDirty(view.id, id, true);
    },
    [workspace.markDirty, view.id],
  );
  const close = useCallback((id: string) => {
    if (
      dirty.current.has(id) &&
      !window.confirm("Leave this form and discard unsaved changes?")
    )
      return;
    currentPages.current.find((page) => page.id === id)?.close();
  }, []);
  useEffect(
    () => () => {
      dirty.current.forEach((id) => workspace.markDirty(view.id, id, false));
    },
    [workspace.markDirty, view.id],
  );
  const context = useMemo(
    () => ({ add, remove, change, close }),
    [add, remove, change, close],
  );
  const active = pages[pages.length - 1];
  return (
    <PageFlowContext.Provider value={context}>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex min-h-10 shrink-0 items-center gap-2 border-b bg-card px-3 text-xs text-muted-foreground"
          data-workspace-page-navigation
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Previous page"
            title="Previous page"
            disabled={!active && tab.cursor === 0}
            onClick={() =>
              active ? close(active.id) : workspace.travel(tab.id, -1)
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Next page"
            title="Next page"
            disabled={!!active || tab.cursor >= tab.history.length - 1}
            onClick={() => workspace.travel(tab.id, 1)}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <span className="truncate">{workspace.title(tab.root)}</span>
          {active ? (
            <>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span className="truncate font-medium text-foreground">
                {active.title}
              </span>
            </>
          ) : null}
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto p-3 md:p-4"
          data-workspace-scroll
        >
          <div hidden={!!active} className="erp-workspace w-full">
            {children}
          </div>
          {pages.map((page) => (
            <PageHost
              key={page.id}
              page={page}
              active={page.id === active?.id}
              onChange={() => change(page.id)}
            />
          ))}
        </div>
      </div>
    </PageFlowContext.Provider>
  );
}
