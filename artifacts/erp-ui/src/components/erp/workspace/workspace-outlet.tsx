/* Copyright (c) 2026 Siakora Labs Limited. */
import { useCallback, useState, type ReactNode } from "react";
import { Router } from "wouter";
import {
  useWorkspace,
  useWorkspaceTab,
  WorkspaceTabContext,
} from "@/context/workspace-context";
import { tabPath, type WorkspaceTab } from "@/lib/workspace-tabs";
import { WorkspacePageFlow } from "./page-flow";
import { ERPListingScope } from "@/components/erp/listing/listing-scope";
import { useAuth } from "@/context/use-auth";
import { useTenantTheme } from "@/hooks/use-tenant-theme";
import { evaluateWorkspaceRouteAccess } from "@/lib/workspace-access";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

function RouteAccess({ children }: { children: ReactNode }) {
  const { role, user } = useAuth();
  const { tenantContext, isLoading } = useTenantTheme({ applyTheme: false });
  const [path, navigate] = useLocation();
  const access = evaluateWorkspaceRouteAccess({
    path,
    role,
    activeModuleSlugs: tenantContext.activeModuleSlugs,
    permissions: Array.isArray(user?.permissions)
      ? (user.permissions as string[])
      : [],
    isPermissionDrivenRole: role !== "superadmin" && role !== "tenant_admin",
  });
  if (isLoading)
    return (
      <p className="p-6 text-sm text-muted-foreground">Loading workspace...</p>
    );
  if (!access.allowed)
    return (
      <div className="mx-auto my-10 max-w-xl rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold">
          {access.reason === "module"
            ? "This module is not active for your organization."
            : "Your current role does not have access to this page."}
        </h1>
        <Button className="mt-4" onClick={() => navigate("/home")}>
          Return Home
        </Button>
      </div>
    );
  return <>{children}</>;
}

function useTabLocation(): [
  string,
  (path: string, options?: { replace?: boolean }) => void,
] {
  const view = useWorkspaceTab()!;
  const workspace = useWorkspace()!;
  const navigate = useCallback(
    (path: string, options?: { replace?: boolean }) => {
      if (view.active) workspace.navigate(view.id, path, options?.replace);
    },
    [view.id, view.active, workspace.navigate],
  );
  return [view.path.split("?")[0], navigate];
}
function useTabSearch() {
  return useWorkspaceTab()!.path.split("?").slice(1).join("?");
}
function WindowView({
  tab,
  children,
  active,
}: {
  tab: WorkspaceTab;
  children: ReactNode;
  active: boolean;
}) {
  const path = tabPath(tab);
  const [visited, setVisited] = useState([path]);
  if (!visited.includes(path)) setVisited([...visited, path]);
  return (
    <section
      id={`workspace-panel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`workspace-tab-${tab.id}`}
      hidden={!active}
      className="h-full min-h-0"
      data-workspace-tab-panel={tab.id}
    >
      {visited.map((route) => (
        <WorkspaceTabContext.Provider
          key={route}
          value={{ id: tab.id, path: route, active: active && route === path }}
        >
          <div hidden={route !== path} className="h-full min-h-0">
            <Router hook={useTabLocation} searchHook={useTabSearch} base="">
              <WorkspacePageFlow>
                <RouteAccess>
                  <ERPListingScope>{children}</ERPListingScope>
                </RouteAccess>
              </WorkspacePageFlow>
            </Router>
          </div>
        </WorkspaceTabContext.Provider>
      ))}
    </section>
  );
}
export function WorkspaceOutlet({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()!;
  return (
    <div className="min-h-0 flex-1" data-workspace-outlet>
      {workspace.state.tabs.map((tab) => (
        <WindowView
          key={tab.id}
          tab={tab}
          active={tab.id === workspace.state.activeId}
        >
          {children}
        </WindowView>
      ))}
    </div>
  );
}
