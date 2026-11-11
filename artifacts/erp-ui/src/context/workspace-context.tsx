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
import { useLocation, useSearch } from "wouter";
import {
  createWorkspace,
  restoreWorkspace,
  tabPath,
  workspacePath,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/workspace-tabs";
import { useAuth } from "@/context/use-auth";

type WorkspaceContextValue = {
  state: WorkspaceState;
  open: (path: string) => void;
  select: (id: string) => void;
  navigate: (id: string, path: string, replace?: boolean) => void;
  travel: (id: string, delta: number) => void;
  close: (ids: string[]) => void;
  move: (id: string, index: number) => void;
  markDirty: (id: string, source: string, value: boolean) => void;
  title: (path: string) => string;
  setLabels: (labels: Record<string, string>) => void;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export const WorkspaceTabContext = createContext<{
  id: string;
  path: string;
  active: boolean;
} | null>(null);
export const useWorkspace = () => useContext(WorkspaceContext);
export const useWorkspaceTab = () => useContext(WorkspaceTabContext);

function ScopedWorkspace({
  children,
  scope,
}: {
  children: ReactNode;
  scope: string;
}) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const browserPath = workspacePath(location + (search ? `?${search}` : ""));
  const storageKey = `sl-erp-windows-v1:${scope}`;
  const [state, setState] = useState(() => {
    try {
      return restoreWorkspace(sessionStorage.getItem(storageKey), browserPath);
    } catch {
      return createWorkspace(browserPath);
    }
  });
  const current = useRef(state);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const dirtySources = useRef(new Map<string, Set<string>>());
  const commit = useCallback(
    (action: WorkspaceAction, external = false) => {
      const next = workspaceReducer(current.current, action);
      current.current = next;
      setState(next);
      const active = next.tabs.find((tab) => tab.id === next.activeId)!;
      if (
        !external &&
        window.location.pathname + window.location.search !== tabPath(active)
      )
        setLocation(tabPath(active));
    },
    [setLocation],
  );
  useEffect(() => {
    const active = current.current.tabs.find(
      (tab) => tab.id === current.current.activeId,
    )!;
    if (tabPath(active) === browserPath) return;
    const match = current.current.tabs.find(
      (tab) => tabPath(tab) === browserPath,
    );
    if (match) commit({ type: "select", id: match.id }, true);
    else {
      const index = active.history.lastIndexOf(browserPath);
      commit(
        index >= 0
          ? { type: "travel", id: active.id, delta: index - active.cursor }
          : { type: "navigate", id: active.id, path: browserPath },
        true,
      );
    }
  }, [browserPath, commit]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          ...state,
          tabs: state.tabs.map((tab) => ({ ...tab, dirty: false })),
        }),
      );
    } catch {
      /* Storage can be disabled. */
    }
  }, [state, storageKey]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current.tabs.some((tab) => tab.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  const markDirty = useCallback(
    (id: string, source: string, value: boolean) => {
      const sources = dirtySources.current.get(id) ?? new Set<string>();
      if (value) sources.add(source);
      else sources.delete(source);
      if (!sources.size) dirtySources.current.delete(id);
      else dirtySources.current.set(id, sources);
      const dirty = sources.size > 0;
      const existing = current.current.tabs.find((tab) => tab.id === id);
      if (existing && existing.dirty !== dirty)
        commit({ type: "dirty", id, value: dirty });
    },
    [commit],
  );
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      open: (path) => commit({ type: "open", path }),
      select: (id) => commit({ type: "select", id }),
      navigate: (id, path, replace) =>
        commit({ type: "navigate", id, path, replace }),
      travel: (id, delta) => commit({ type: "travel", id, delta }),
      close: (ids) => {
        const closing = current.current.tabs.filter(
          (tab) => tab.id !== "home" && ids.includes(tab.id),
        );
        if (
          closing.some((tab) => tab.dirty) &&
          !window.confirm("Close these tabs and discard unsaved changes?")
        )
          return;
        closing.forEach((tab) => dirtySources.current.delete(tab.id));
        commit({ type: "close", ids });
      },
      move: (id, index) => commit({ type: "move", id, index }),
      markDirty,
      title: (path) => {
        if (path === "/home") return "Home";
        const plain = path.split("?")[0];
        const root = Object.keys(labels)
          .filter((key) => plain === key || plain.startsWith(`${key}/`))
          .sort((a, b) => b.length - a.length)[0];
        return (
          root
            ? labels[root]
            : plain
                .split("/")
                .filter(Boolean)
                .slice(-1)[0]
                ?.replaceAll("-", " ") || "Workspace"
        ).replace(/^./, (letter) => letter.toUpperCase());
      },
      setLabels,
    }),
    [state, labels, commit, markDirty],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const scope = JSON.stringify([
    user?.id ?? "loading",
    user?.organization_id ?? user?.tenant_id,
    user?.branch_id,
    user?.active_membership_id,
    user?.active_role_group_id,
    user?.active_role_group_name,
    user?.active_role,
    role,
  ]);
  return (
    <ScopedWorkspace key={scope} scope={scope}>
      {children}
    </ScopedWorkspace>
  );
}
