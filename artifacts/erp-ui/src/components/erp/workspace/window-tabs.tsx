/* Copyright (c) 2026 Siakora Labs Limited. */
import { useState } from "react";
import { Home, MoreHorizontal, X, ArrowLeft, ArrowRight } from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceWindowTabs() {
  const workspace = useWorkspace();
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  if (!workspace) return null;
  const { state } = workspace;
  const target = menuTarget ?? state.activeId;
  const index = state.tabs.findIndex((tab) => tab.id === target);
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-1 border-b bg-card px-3 pt-2"
      data-workspace-window-tabs
    >
      <div
        role="tablist"
        aria-label="Open workspace tabs"
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
      >
        {state.tabs.map((tab, tabIndex) => (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center rounded-t-lg border border-b-0 ${state.activeId === tab.id ? "border-primary/35 bg-primary text-primary-foreground" : "border-border bg-muted/45 text-muted-foreground"}`}
            draggable={tab.id !== "home"}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/x-erp-tab", tab.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (tab.id !== "home") event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/x-erp-tab");
              if (id) workspace.move(id, tabIndex);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuTarget(tab.id);
            }}
          >
            <button
              type="button"
              role="tab"
              id={`workspace-tab-${tab.id}`}
              aria-selected={state.activeId === tab.id}
              aria-controls={`workspace-panel-${tab.id}`}
              tabIndex={state.activeId === tab.id ? 0 : -1}
              onClick={() => workspace.select(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(
                      state.tabs.length - 1,
                      tabIndex + (event.key === "ArrowLeft" ? -1 : 1),
                    ),
                  );
                  workspace.select(state.tabs[next].id);
                  document
                    .getElementById(`workspace-tab-${state.tabs[next].id}`)
                    ?.focus();
                }
                if (event.key === "Delete" && tab.id !== "home")
                  workspace.close([tab.id]);
              }}
              className="inline-flex h-10 max-w-56 items-center gap-2 px-3 text-sm font-medium"
              title={workspace.title(tab.root)}
            >
              {tab.id === "home" ? <Home className="h-4 w-4" /> : null}
              <span className="truncate">{workspace.title(tab.root)}</span>
              {tab.dirty ? (
                <span
                  aria-label="Unsaved changes"
                  className="h-1.5 w-1.5 rounded-full bg-current"
                />
              ) : null}
            </button>
            {tab.id !== "home" ? (
              <button
                type="button"
                onClick={() => workspace.close([tab.id])}
                aria-label={`Close ${workspace.title(tab.root)}`}
                className="mr-1 rounded p-1 hover:bg-foreground/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <DropdownMenu
        open={menuTarget !== null}
        onOpenChange={(open) =>
          setMenuTarget(open ? (menuTarget ?? state.activeId) : null)
        }
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="mb-1 h-8 w-8 shrink-0"
            aria-label="Manage workspace tabs"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={target === "home"}
            onSelect={() => workspace.close([target])}
          >
            Close current tab
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              !state.tabs.some((tab) => tab.id !== "home" && tab.id !== target)
            }
            onSelect={() =>
              workspace.close(
                state.tabs
                  .filter((tab) => tab.id !== target)
                  .map((tab) => tab.id),
              )
            }
          >
            Close other tabs
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={state.tabs.length < 2}
            onSelect={() => {
              workspace.close(state.tabs.map((tab) => tab.id));
            }}
          >
            Close all tabs
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index >= state.tabs.length - 1}
            onSelect={() =>
              workspace.close(state.tabs.slice(index + 1).map((tab) => tab.id))
            }
          >
            Close tabs to the right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={target === "home" || index <= 1}
            onSelect={() => workspace.move(target, index - 1)}
          >
            <ArrowLeft className="h-4 w-4" />
            Move left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={target === "home" || index === state.tabs.length - 1}
            onSelect={() => workspace.move(target, index + 1)}
          >
            <ArrowRight className="h-4 w-4" />
            Move right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
