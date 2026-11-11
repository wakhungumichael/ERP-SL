/* Copyright (c) 2026 Siakora Labs Limited. */
export const HOME_PATH = "/home";
export type WorkspaceTab = {
  id: string;
  root: string;
  history: string[];
  cursor: number;
  dirty: boolean;
};
export type WorkspaceState = {
  tabs: WorkspaceTab[];
  activeId: string;
  serial: number;
};
export type WorkspaceAction =
  | { type: "open"; path: string }
  | { type: "select"; id: string }
  | { type: "navigate"; id: string; path: string; replace?: boolean }
  | { type: "travel"; id: string; delta: number }
  | { type: "close"; ids: string[] }
  | { type: "move"; id: string; index: number }
  | { type: "dirty"; id: string; value: boolean };

export function workspacePath(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\r\n\\]/.test(value)
  )
    return HOME_PATH;
  if (/^\/(?:login|landing|privacy|documents\/scan)(?:\/|$)/.test(value))
    return HOME_PATH;
  const path = value.split("#")[0];
  return path === "/" ? HOME_PATH : path;
}
export const tabPath = (tab: WorkspaceTab) =>
  tab.history[tab.cursor] ?? tab.root;
export function createWorkspace(path = HOME_PATH): WorkspaceState {
  const home: WorkspaceTab = {
    id: "home",
    root: HOME_PATH,
    history: [HOME_PATH],
    cursor: 0,
    dirty: false,
  };
  const initial = { tabs: [home], activeId: home.id, serial: 0 };
  return workspacePath(path) === HOME_PATH
    ? initial
    : workspaceReducer(initial, { type: "open", path });
}
export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "open") {
    const path = workspacePath(action.path);
    const existing = state.tabs.find(
      (tab) => tab.root === path || tabPath(tab) === path,
    );
    if (existing) return { ...state, activeId: existing.id };
    const id = `window-${state.serial + 1}`;
    return {
      tabs: [
        ...state.tabs,
        { id, root: path, history: [path], cursor: 0, dirty: false },
      ],
      activeId: id,
      serial: state.serial + 1,
    };
  }
  if (action.type === "select")
    return state.tabs.some((tab) => tab.id === action.id)
      ? { ...state, activeId: action.id }
      : state;
  if (action.type === "navigate") {
    const path = workspacePath(action.path);
    if (path === HOME_PATH) return { ...state, activeId: "home" };
    if (action.id === "home")
      return workspaceReducer(state, { type: "open", path });
    return {
      ...state,
      tabs: state.tabs.map((tab) => {
        if (tab.id !== action.id || tabPath(tab) === path) return tab;
        const history = action.replace
          ? tab.history.map((entry, index) =>
              index === tab.cursor ? path : entry,
            )
          : [...tab.history.slice(0, tab.cursor + 1), path];
        return {
          ...tab,
          history,
          cursor: action.replace ? tab.cursor : history.length - 1,
        };
      }),
    };
  }
  if (action.type === "travel")
    return {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === action.id
          ? {
              ...tab,
              cursor: Math.max(
                0,
                Math.min(tab.history.length - 1, tab.cursor + action.delta),
              ),
            }
          : tab,
      ),
    };
  if (action.type === "dirty")
    return {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === action.id ? { ...tab, dirty: action.value } : tab,
      ),
    };
  if (action.type === "close") {
    const tabs = state.tabs.filter(
      (tab) => tab.id === "home" || !action.ids.includes(tab.id),
    );
    const oldIndex = state.tabs.findIndex((tab) => tab.id === state.activeId);
    return {
      ...state,
      tabs,
      activeId: tabs.some((tab) => tab.id === state.activeId)
        ? state.activeId
        : tabs[Math.max(0, Math.min(oldIndex - 1, tabs.length - 1))].id,
    };
  }
  if (action.id === "home") return state;
  const moving = state.tabs.find((tab) => tab.id === action.id);
  if (!moving) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== action.id);
  tabs.splice(Math.max(1, Math.min(tabs.length, action.index)), 0, moving);
  return { ...state, tabs };
}
export function restoreWorkspace(
  raw: string | null,
  path: string,
): WorkspaceState {
  try {
    const candidate = JSON.parse(raw ?? "null") as WorkspaceState;
    if (
      !candidate ||
      !Array.isArray(candidate.tabs) ||
      candidate.tabs.length > 40
    )
      return createWorkspace(path);
    let state = createWorkspace();
    for (const tab of candidate.tabs) {
      if (
        !tab ||
        typeof tab.root !== "string" ||
        tab.root === HOME_PATH ||
        workspacePath(tab.root) !== tab.root ||
        state.tabs.some((entry) => entry.root === tab.root)
      )
        continue;
      const next = workspaceReducer(state, { type: "open", path: tab.root });
      const added = next.tabs.find((entry) => entry.id === next.activeId)!;
      const history = Array.isArray(tab.history)
        ? tab.history
            .filter(
              (value: unknown): value is string =>
                typeof value === "string" &&
                workspacePath(value) === value &&
                value !== HOME_PATH,
            )
            .slice(-50)
        : [];
      const cursor = Number.isInteger(tab.cursor)
        ? Math.max(0, Math.min(history.length - 1, tab.cursor))
        : 0;
      state = {
        ...next,
        tabs: next.tabs.map((entry) =>
          entry.id === added.id && history.length
            ? { ...entry, history, cursor }
            : entry,
        ),
      };
    }
    const match = state.tabs.find(
      (tab) => tabPath(tab) === workspacePath(path),
    );
    return match
      ? { ...state, activeId: match.id }
      : workspaceReducer(state, { type: "open", path });
  } catch {
    return createWorkspace(path);
  }
}
