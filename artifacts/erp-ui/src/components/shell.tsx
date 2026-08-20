import { Link, useLocation } from 'wouter';
import { useAuthLogout } from '@workspace/api-client-react';
import { LogOut, Scale, ChevronRight, ChevronDown, Search, UserCircle2, Settings, PanelTop, X, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { STATIC_NAV, ROLE_LABELS, ROLE_COLORS, type NavSection } from '@/lib/roles';
import type { AppRole } from '@/lib/roles';
import { useTenantTheme } from '@/hooks/use-tenant-theme';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const HOME_SECTION: NavSection = {
  key: 'dashboard',
  title: 'Dashboard',
  roles: [],
  items: [
    { key: 'dashboard', title: 'Dashboard', path: '/dashboard', roles: [] },
  ],
};

const STATIC_SECTION_MODULES: Record<string, string[]> = {
  weighbridge: ['weighbridge', 'commercial-weighbridge'],
  sales: ['sales', 'invoicing', 'billing'],
  inventory: ['inventory', 'stock-control', 'warehouse-management'],
  finance: ['finance', 'accounting', 'accounts-receivable', 'accounts-payable', 'cash-management', 'budgeting'],
  crm: ['crm'],
  ticketing: ['ticketing'],
  reports: ['reporting'],
  hr: ['hr', 'hr-payroll', 'hcm'],
  procurement: ['procurement'],
  manufacturing: ['manufacturing', 'manufacturing-pack'],
  retail: ['retail', 'retail-pack', 'commerce'],
  services: ['services', 'services-pack', 'projects'],
};

/** Fetch workspace navigation from the backend and transform into NavSection[]. */
function normalizeNavRoles(value: unknown): AppRole[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => String(entry).toLowerCase().replace(/[^a-z0-9]/g, '_'))
    .map((entry) => {
      if (entry.includes('super') && entry.includes('admin')) return 'superadmin';
      if (entry.includes('tenant') && entry.includes('admin')) return 'tenant_admin';
      if (entry.includes('finance') || entry.includes('account')) return 'finance';
      if (entry.includes('operator') || entry === 'ops') return 'operator';
      return null;
    });

  return Array.from(
    new Set(
      normalized.filter(
        (entry): entry is Exclude<AppRole, 'guest'> => entry !== null,
      ),
    ),
  );
}

function useWorkspaceNav(token: string | null): NavSection[] {
  const { data } = useQuery({
    queryKey: ['workspace-nav', token ?? 'anonymous'],
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
    const payload: any = data;
    const sections = Array.isArray(data)
      ? data
      : Array.isArray(payload.sections)
        ? payload.sections
        : Object.values(data);
    if (!sections.length) return STATIC_NAV;

    const activeModuleSlugs = new Set<string>(
      Array.isArray(payload.active_module_slugs)
        ? payload.active_module_slugs.map((entry: unknown) => String(entry))
        : [],
    );
    const isSectionEnabledBySubscription = (sectionKey: string) => {
      const requiredModules = STATIC_SECTION_MODULES[sectionKey];
      if (!requiredModules || activeModuleSlugs.size === 0) return true;
      return requiredModules.some((slug) => activeModuleSlugs.has(slug));
    };

    const transformed = sections.map((s: any) => ({
      key: s.key ?? s.slug ?? s.title?.toLowerCase().replace(/\s+/g, '-'),
      title: s.title ?? s.name ?? s.label,
      roles: normalizeNavRoles(s.roles),
      items: (s.items ?? s.children ?? []).map((item: any) => ({
        key: item.key ?? item.slug ?? item.title?.toLowerCase().replace(/\s+/g, '-'),
        title: item.title ?? item.name ?? item.label,
        path: item.path ?? item.route_path ?? item.url ?? item.href,
        roles: normalizeNavRoles(item.roles ?? s.roles),
      })),
    })).filter((s: NavSection) => s.title && s.items.length > 0 && s.items.some(item => item.path));

    if (!transformed.length) return STATIC_NAV;

    const merged = transformed.map((section: NavSection) => {
      const staticSection = STATIC_NAV.find((candidate) => candidate.key === section.key);
      if (!staticSection) return section;

      const seenPaths = new Set(section.items.map(item => item.path));
      const missingStaticItems = isSectionEnabledBySubscription(section.key)
        ? staticSection.items.filter((item) => !seenPaths.has(item.path))
        : [];
      return {
        ...section,
        roles: section.roles?.length ? section.roles : staticSection.roles,
        items: [...section.items, ...missingStaticItems],
      };
    });

    const existingSectionKeys = new Set(merged.map((section: NavSection) => section.key));
    const missingStaticSections = STATIC_NAV.filter(
      (section) => !existingSectionKeys.has(section.key) && isSectionEnabledBySubscription(section.key),
    );
    return [...merged, ...missingStaticSections];
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

function matchesSearch(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
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
  const singleItem = section.items.length === 1 ? section.items[0] : null;
  const renderAsDirectLink = !!singleItem && singleItem.title.toLowerCase() === section.title.toLowerCase();

  return (
    <div className="mb-1">
      {renderAsDirectLink && singleItem ? (
        <div className="px-2 pb-1">
          <Link
            href={singleItem.path}
            title={sidebarCollapsed ? singleItem.title : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              hasActive
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                hasActive ? 'bg-primary-foreground' : 'bg-sidebar-foreground/30'
              }`}
            />
            {!sidebarCollapsed && <span className="truncate">{singleItem.title}</span>}
          </Link>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────────
export function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { token, user, role, isLoading, authErrorStatus, clearToken, refreshUser } = useAuth();
  const { tenantContext } = useTenantTheme();
  const logout = useAuthLogout();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(loadCollapsedSections);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const apiNav = useWorkspaceNav(token);
  const memberships = Array.isArray((user as any)?.memberships) ? (user as any).memberships : [];
  const activeMembershipId = (user as any)?.active_membership_id ? String((user as any).active_membership_id) : '';
  const activeOrganizationName = tenantContext.tenantName
    || (user as any)?.organization_name
    || (user as any)?.tenant_name
    || memberships.find((entry: any) => String(entry.id) === activeMembershipId)?.organization_name
    || memberships.find((entry: any) => String(entry.id) === activeMembershipId)?.tenant_name
    || '';
  const appLogoUrl = tenantContext.branding.logoUrl || '';
  const appPrimaryColor = tenantContext.branding.primaryColor || '#E85D26';
  const appTitle = activeOrganizationName || 'SL-ERP';
  const appSubtitle = ((user as any)?.role === 'superadmin'
    ? 'SaaS Control Center'
    : 'Operations Platform');

  useEffect(() => {
    if (!token && location !== '/login') setLocation('/login');
  }, [token, location, setLocation]);

  useEffect(() => {
    if (!token || isLoading || user) return;
    if (authErrorStatus === 401 || authErrorStatus === 403) {
      setLocation('/login');
    }
  }, [authErrorStatus, isLoading, setLocation, token, user]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

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

  const switchOrganizationMutation = useMutation({
    mutationFn: async (membershipId: string) => {
      const res = await fetch('/api/platform/auth/switch-organization/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ membership_id: Number(membershipId) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message || payload?.detail || 'Failed to switch organization.');
      return payload;
    },
    onSuccess: async () => {
      await refreshUser();
    },
  });

  if (!token) return null;

  const effectiveRole = isLoading && role === 'guest' ? 'tenant_admin' : role;

  const visibleSections = apiNav
    .filter(s => !s.roles.length || s.roles.includes(effectiveRole))
    .map(s => ({
      ...s,
      items: s.items.filter(item => !item.roles.length || item.roles.includes(effectiveRole)),
    }))
    .filter(s => s.items.length > 0);

  const staticVisibleSections = STATIC_NAV
    .filter(s => !s.roles.length || s.roles.includes(effectiveRole))
    .map(s => ({
      ...s,
      items: s.items.filter(item => !item.roles.length || item.roles.includes(effectiveRole)),
    }))
    .filter(s => s.items.length > 0);

  const resolvedSections = visibleSections.length > 0 ? visibleSections : staticVisibleSections;
  const navSections = resolvedSections.some(section => section.items.some(item => item.path === '/dashboard'))
    ? resolvedSections
    : [HOME_SECTION, ...resolvedSections];

  const searchIndex = useMemo(
    () =>
      navSections.flatMap(section =>
        section.items.map(item => ({
          key: `${section.key}-${item.key}`,
          title: item.title,
          path: item.path,
          sectionTitle: section.title,
        })),
      ),
    [navSections],
  );

  const filteredSidebarSections = useMemo(() => {
    if (!sidebarSearch.trim()) return navSections;

    return navSections
      .map(section => {
        const sectionMatch = matchesSearch(section.title, sidebarSearch);
        const items = section.items.filter(
          item =>
            sectionMatch ||
            matchesSearch(item.title, sidebarSearch) ||
            matchesSearch(item.path, sidebarSearch),
        );

        return { ...section, items };
      })
      .filter(section => section.items.length > 0);
  }, [navSections, sidebarSearch]);

  const globalMatches = useMemo(() => {
    if (!globalSearch.trim()) return [];
    return searchIndex
      .filter(
        entry =>
          matchesSearch(entry.title, globalSearch) ||
          matchesSearch(entry.sectionTitle, globalSearch) ||
          matchesSearch(entry.path, globalSearch),
      )
      .slice(0, 8);
  }, [searchIndex, globalSearch]);

  const displayName =
    (user as any)?.first_name
      ? `${(user as any).first_name} ${(user as any).last_name ?? ''}`.trim()
      : (user as any)?.username ?? 'User';
  const email = (user as any)?.email ?? 'No email available';
  const openRoute = (path: string) => {
    setLocation(path);
    setGlobalSearch('');
  };
  const renderNavSections = (collapsed: boolean) => (
    <>
      {!collapsed && (
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/35" />
            <Input
              value={sidebarSearch}
              onChange={event => setSidebarSearch(event.target.value)}
              placeholder="Search menu"
              className="h-10 border-sidebar-border bg-sidebar-accent/60 pl-9 pr-9 text-sidebar-foreground placeholder:text-sidebar-foreground/45 focus-visible:ring-sidebar-ring"
            />
            {sidebarSearch && (
              <button
                type="button"
                onClick={() => setSidebarSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-sidebar-foreground/35 transition-colors hover:text-sidebar-foreground"
                aria-label="Clear sidebar search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {filteredSidebarSections.length ? filteredSidebarSections.map(section => (
        <NavSectionItem
          key={section.key}
          section={section}
          location={location}
          sidebarCollapsed={collapsed}
          open={collapsed || !collapsedSections.has(section.key)}
          onToggle={() => toggleSection(section.key)}
        />
      )) : (
        <div className="px-4 py-6 text-sm text-sidebar-foreground/55">
          No menu items match "{sidebarSearch}".
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`${sidebarCollapsed ? 'w-16' : 'w-60'} h-screen overflow-hidden transition-all duration-200 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col hidden md:flex shrink-0`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0 gap-3">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 shadow-sm"
              style={{ backgroundColor: appLogoUrl ? 'rgba(255,255,255,0.08)' : appPrimaryColor }}
            >
              {appLogoUrl ? (
                <img src={appLogoUrl} alt={`${appTitle} logo`} className="h-full w-full object-contain" />
              ) : (
                <Scale className="h-5 w-5 text-primary-foreground" />
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold text-[15px] tracking-tight text-sidebar-foreground leading-none">{appTitle}</div>
                <div className="truncate text-[9px] font-medium text-sidebar-foreground/40 uppercase tracking-widest mt-0.5">{appSubtitle}</div>
              </div>
            )}
          </Link>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="ml-auto text-sidebar-foreground/30 hover:text-sidebar-foreground transition-colors p-1 rounded"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${sidebarCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {/* Nav */}
        <div className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden py-3">
          {renderNavSections(sidebarCollapsed)}
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
                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${ROLE_COLORS[effectiveRole]}`}>
                  {isLoading ? 'Loading' : ROLE_LABELS[effectiveRole]}
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
        <header className="h-14 bg-card border-b border-border flex items-center justify-between gap-4 px-4 md:px-6 shrink-0">
          <div className="min-w-0 flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="hidden lg:block text-sm font-semibold text-muted-foreground tracking-wide">
              {navSections
                .flatMap(s => s.items)
                .find(
                  item =>
                    location === item.path ||
                    (item.path !== '/' && location.startsWith(item.path + '/')) ||
                    (item.path === '/dashboard' && location === '/'),
                )?.title ?? 'Operations Center'}
            </div>

            <div className="relative w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalSearch}
                onChange={event => setGlobalSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && globalMatches[0]) {
                    event.preventDefault();
                    openRoute(globalMatches[0].path);
                  }
                  if (event.key === 'Escape') setGlobalSearch('');
                }}
                placeholder="Search pages, modules, and settings"
                className="h-10 bg-background pl-9 pr-9"
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Clear global search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              {globalSearch.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-xl border bg-popover shadow-lg">
                  {globalMatches.length ? (
                    <div className="py-1">
                      {globalMatches.map(entry => (
                        <button
                          key={entry.key}
                          type="button"
                          onClick={() => openRoute(entry.path)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-popover-foreground">{entry.title}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {entry.sectionTitle} • {entry.path}
                            </div>
                          </div>
                          <PanelTop className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      No pages found for "{globalSearch}".
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`hidden sm:inline-block px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-widest ${ROLE_COLORS[effectiveRole]}`}>
              {isLoading ? 'Loading' : ROLE_LABELS[effectiveRole]}
            </span>
            <div className="hidden md:block text-sm font-medium text-foreground truncate max-w-[12rem]">{displayName}</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="hidden md:inline-flex text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
                  <UserCircle2 className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="space-y-1">
                  <div className="text-sm font-semibold">{displayName}</div>
                  <div className="text-xs font-normal text-muted-foreground">{email}</div>
                  {activeOrganizationName && (
                    <div className="text-[11px] font-normal text-muted-foreground">Org: {activeOrganizationName}</div>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                  <UserCircle2 className="h-4 w-4" />
                  View Profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLocation('/platform/organization-settings')}>
                  <Settings className="h-4 w-4" />
                  Organization Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto bg-muted/20 p-4 md:p-6 lg:p-8">
          <div className="w-full">
            {children}
          </div>
        </div>
      </main>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[20rem] max-w-[85vw] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-[20rem]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation menu</SheetTitle>
            <SheetDescription>Browse modules and pages on mobile.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <div className="flex h-14 items-center gap-3 border-b border-sidebar-border px-4">
              <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-3" onClick={() => setMobileNavOpen(false)}>
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 shadow-sm"
                  style={{ backgroundColor: appLogoUrl ? 'rgba(255,255,255,0.08)' : appPrimaryColor }}
                >
                  {appLogoUrl ? (
                    <img src={appLogoUrl} alt={`${appTitle} logo`} className="h-full w-full object-contain" />
                  ) : (
                    <Scale className="h-5 w-5 text-primary-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-[15px] leading-none tracking-tight text-sidebar-foreground">{appTitle}</div>
                  <div className="mt-0.5 truncate text-[9px] font-medium uppercase tracking-widest text-sidebar-foreground/40">{appSubtitle}</div>
                </div>
              </Link>
            </div>
            <div className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden py-3">
              {renderNavSections(false)}
            </div>
            <div className="border-t border-sidebar-border p-3 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-sidebar-foreground">{displayName}</div>
                  <span className={`mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${ROLE_COLORS[effectiveRole]}`}>
                    {isLoading ? 'Loading' : ROLE_LABELS[effectiveRole]}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  title="Sign out"
                  className="shrink-0 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>
              Quick account details for the current signed-in user.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">User</div>
              <div className="mt-2 text-lg font-semibold">{displayName}</div>
              <div className="mt-1 text-sm text-muted-foreground">{email}</div>
            </div>

            {memberships.length > 0 && (
              <div className="rounded-xl border p-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Active Organization</div>
                <div className="mt-3 space-y-2">
                  <Select
                    value={activeMembershipId}
                    onValueChange={(value) => {
                      if (!value || value === activeMembershipId || switchOrganizationMutation.isPending) return;
                      switchOrganizationMutation.mutate(value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {memberships.map((membership: any) => (
                        <SelectItem key={membership.id} value={String(membership.id)}>
                          {membership.organization_name ?? membership.tenant_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    {switchOrganizationMutation.isPending
                      ? 'Switching organization...'
                      : 'ERP data and access will follow the selected organization context.'}
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Role</div>
                <div className="mt-2 text-sm font-semibold">{ROLE_LABELS[effectiveRole]}</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Username</div>
                <div className="mt-2 text-sm font-semibold">{(user as any)?.username ?? 'Not available'}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { setProfileOpen(false); setLocation('/platform/organization-settings'); }}>
                <Settings className="h-4 w-4" />
                Open Settings
              </Button>
              <Button variant="ghost" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
