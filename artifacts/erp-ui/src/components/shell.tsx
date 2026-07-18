import { Link, useLocation } from 'wouter';
import { useAuthLogout } from '@workspace/api-client-react';
import { LogOut, Scale, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { STATIC_NAV, ROLE_LABELS, ROLE_COLORS, type NavSection } from '@/lib/roles';

/** Fetch workspace navigation from the backend and transform into NavSection[]. */
function useWorkspaceNav(token: string | null): NavSection[] {
  const { data } = useQuery({
    queryKey: ['workspace-nav'],
    queryFn: async () => {
      const res = await fetch('/api/platform/workspace/navigation/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    },
    enabled: !!token,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!data) return STATIC_NAV;

  try {
    const sections = Array.isArray(data) ? data : Object.values(data);
    if (!sections.length) return STATIC_NAV;

    return sections.map((s: any) => ({
      key: s.key ?? s.slug ?? s.title?.toLowerCase().replace(/\s+/g, '-'),
      title: s.title ?? s.name ?? s.label,
      roles: s.roles ?? [],
      items: (s.items ?? s.children ?? []).map((item: any) => ({
        key: item.key ?? item.slug ?? item.title?.toLowerCase().replace(/\s+/g, '-'),
        title: item.title ?? item.name ?? item.label,
        path: item.path ?? item.url ?? item.href,
        roles: item.roles ?? s.roles ?? [],
      })),
    })).filter((s: NavSection) => s.title && s.items.length > 0);
  } catch {
    return STATIC_NAV;
  }
}

// ── Collapsed-sections persistence ────────────────────────────────────────────
const STORAGE_KEY = 'sl-erp-nav-collapsed';

function loadCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}

// ── NavSection component ───────────────────────────────────────────────────────
interface NavSectionProps {
  section: NavSection;
  location: string;
  sidebarCollapsed: boolean;
  open: boolean;
  onToggle: () => void;
}

function NavSectionItem({ section, location, sidebarCollapsed, open, onToggle }: NavSectionProps) {
  const hasActive = section.items.some(
    item =>
      location === item.path ||
      (item.path !== '/' && location.startsWith(item.path + '/')) ||
      (item.path === '/dashboard' && location === '/'),
  );

  return (
    <div className="mb-1">
      {/* Section header / toggle */}
      {!sidebarCollapsed ? (
        <button
          onClick={onToggle}
          className={`w-full flex items-center justify-between px-4 py-1.5 group transition-colors rounded-sm mx-0 hover:bg-sidebar-accent/40 ${
            hasActive && !open ? 'text-sidebar-foreground/80' : ''
          }`}
        >
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
            hasActive ? 'text-primary/80' : 'text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60'
          }`}>
            {section.title}
          </span>
          <ChevronDown
            className={`h-3 w-3 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/50 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
        </button>
      ) : (
        /* Collapsed sidebar — show a faint divider dot instead of the label */
        <div className="flex justify-center py-2">
          <div className="h-px w-6 bg-sidebar-foreground/10" />
        </div>
      )}

      {/* Items — hidden when section is collapsed (and sidebar is not icon-mode) */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          sidebarCollapsed || open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-0.5 px-2 pb-1">
          {section.items.map(item => {
            const active =
              location === item.path ||
              (item.path !== '/' && location.startsWith(item.path + '/')) ||
              (item.path === '/dashboard' && location === '/');

            return (
              <Link
                key={item.key}
                href={item.path}
                title={sidebarCollapsed ? item.title : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    active ? 'bg-primary-foreground' : 'bg-sidebar-foreground/30'
                  }`}
                />
                {!sidebarCollapsed && <span className="truncate">{item.title}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────────
export function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { token, user, role, clearToken } = useAuth();
  const logout = useAuthLogout();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(loadCollapsedSections);
  const apiNav = useWorkspaceNav(token);

  useEffect(() => {
    if (!token && location !== '/login') setLocation('/login');
  }, [token, location, setLocation]);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsedSections(next);
      return next;
    });
  }, []);

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        clearToken();
        setLocation('/login');
      },
    });
  };

  if (!token) return null;

  const visibleSections = apiNav
    .filter(s => !s.roles.length || s.roles.includes(role))
    .map(s => ({
      ...s,
      items: s.items.filter(item => !item.roles.length || item.roles.includes(role)),
    }))
    .filter(s => s.items.length > 0);

  const displayName =
    (user as any)?.first_name
      ? `${(user as any).first_name} ${(user as any).last_name ?? ''}`.trim()
      : (user as any)?.username ?? 'User';

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`${sidebarCollapsed ? 'w-16' : 'w-60'} transition-all duration-200 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col hidden md:flex shrink-0`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0 gap-3">
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Scale className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm tracking-tight text-sidebar-foreground leading-none">SL-ERP</div>
              <div className="text-[9px] font-medium text-sidebar-foreground/40 uppercase tracking-widest mt-0.5">Operations Platform</div>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="ml-auto text-sidebar-foreground/30 hover:text-sidebar-foreground transition-colors p-1 rounded"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${sidebarCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3 scrollbar-thin scrollbar-thumb-sidebar-border scrollbar-track-transparent">
          {visibleSections.map(section => (
            <NavSectionItem
              key={section.key}
              section={section}
              location={location}
              sidebarCollapsed={sidebarCollapsed}
              open={!collapsedSections.has(section.key)}
              onToggle={() => toggleSection(section.key)}
            />
          ))}
        </div>

        {/* User + logout */}
        <div className="border-t border-sidebar-border p-3 shrink-0">
          {sidebarCollapsed ? (
            <Button
              variant="ghost" size="icon"
              onClick={handleLogout}
              title="Sign out"
              className="w-full text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-sidebar-foreground truncate">{displayName}</div>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${ROLE_COLORS[role]}`}>
                  {ROLE_LABELS[role]}
                </span>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={handleLogout}
                title="Sign out"
                className="shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 bg-card border-b border-border flex items-center justify-between px-6 shrink-0">
          <div className="text-sm font-semibold text-muted-foreground tracking-wide">
            {visibleSections
              .flatMap(s => s.items)
              .find(
                item =>
                  location === item.path ||
                  (item.path !== '/' && location.startsWith(item.path + '/')) ||
                  (item.path === '/dashboard' && location === '/'),
              )?.title ?? 'Operations Center'}
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden sm:inline-block px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-widest ${ROLE_COLORS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
            <div className="text-sm font-medium text-foreground">{displayName}</div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6 lg:p-8 bg-muted/20">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
