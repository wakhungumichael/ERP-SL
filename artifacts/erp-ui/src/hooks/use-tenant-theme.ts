import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import type { DashboardTenantContextValue } from '@/components/dashboard/types';
import type { NavSection } from '@/lib/roles';
import { fetchPublicSiteConfig } from '@/lib/public-site';

function hexToHsl(hex: string) {
  let normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    normalized = normalized.split('').map((ch) => ch + ch).join('');
  }
  if (normalized.length !== 6) return { h: 15, s: 80, l: 50 };

  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function normalizeSections(payload: any): NavSection[] {
  const workspace = payload?.workspace ?? payload;
  const sections = Array.isArray(workspace?.sections)
    ? workspace.sections
    : Array.isArray(workspace)
      ? workspace
      : [];

  return sections.map((section: any) => ({
    key: section.key ?? section.slug ?? section.title,
    title: section.title ?? section.name ?? section.label,
    roles: [],
    items: (section.items ?? []).map((item: any) => ({
      key: item.key ?? item.slug ?? item.title,
      title: item.title ?? item.name ?? item.label,
      path: item.path ?? item.route_path ?? item.href,
      roles: [],
    })),
  })).filter((section: NavSection) => section.title && section.items.some((item) => item.path));
}

function ensureHeadLink(rel: string) {
  if (typeof document === 'undefined') return null;
  let link = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  return link;
}

export function useTenantTheme() {
  const { token, role, user } = useAuth();
  const organizationId = (((user as any)?.organization_id ?? (user as any)?.tenant_id) as number | null | undefined) ?? null;
  const userId = ((user as any)?.id as number | null | undefined) ?? null;
  const rememberedTenantCode = typeof window === 'undefined'
    ? ''
    : window.localStorage.getItem('sl-erp-tenant-code') || '';

  const tenantQuery = useQuery({
    queryKey: ['dashboard-tenant-self', organizationId, token],
    enabled: !!token && !!organizationId,
    staleTime: 300000,
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/self/?tenant_id=${encodeURIComponent(String(organizationId))}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['dashboard-tenant-settings', organizationId, token],
    enabled: !!token && !!organizationId,
    staleTime: 300000,
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/${organizationId}/settings/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    },
  });

  const workspaceQuery = useQuery({
    queryKey: ['dashboard-workspace-context', token, organizationId],
    enabled: !!token,
    staleTime: 300000,
    queryFn: async () => {
      const res = await fetch('/api/platform/workspace/navigation/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    },
  });

  const tenant = tenantQuery.data ?? {};
  const settings = settingsQuery.data ?? {};
  const workspace = workspaceQuery.data ?? {};
  const tenantCode = tenant.code || rememberedTenantCode;

  const publicSiteQuery = useQuery({
    queryKey: ['public-site-config', tenantCode],
    queryFn: () => fetchPublicSiteConfig(tenantCode),
    enabled: !!tenantCode,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const publicSite = publicSiteQuery.data;
  const publicBranding = publicSite?.branding ?? {};

  const tenantContext = useMemo<DashboardTenantContextValue>(() => {
    const primaryColor = settings.primary_color || publicBranding.primary_color || '#E85D26';
    const displayName = (user as any)?.first_name
      ? `${(user as any).first_name} ${(user as any)?.last_name ?? ''}`.trim()
      : ((user as any)?.username ?? 'ERP User');

    return {
      tenantId: organizationId,
      tenantName: tenant.name || publicSite?.tenant?.name || (user as any)?.organization_name || (user as any)?.tenant_name || 'Organization Workspace',
      tenantCode,
      role,
      userId,
      displayName,
      permissions: Array.isArray((user as any)?.permissions) ? ((user as any).permissions as string[]) : [],
      activeModuleSlugs: Array.isArray(workspace?.workspace?.active_module_slugs)
        ? workspace.workspace.active_module_slugs
        : Array.isArray(workspace?.active_module_slugs)
          ? workspace.active_module_slugs
          : [],
      sections: normalizeSections(workspace),
      branding: {
        logoUrl: settings.logo_url || publicBranding.logo_url || '',
        primaryColor,
        currency: tenant.default_currency || 'KES',
        locale: tenant.default_currency === 'USD' ? 'en-US' : 'en-KE',
        timezone: tenant.timezone || 'Africa/Nairobi',
        footerText: settings.footer_text || publicBranding.footer_text || '',
        supportEmail: settings.support_email || publicBranding.support_email || '',
      },
    };
  }, [organizationId, publicBranding, publicSite?.tenant?.name, role, settings, tenant, tenantCode, user, userId, workspace]);

  useEffect(() => {
    const root = document.documentElement;
    const primary = hexToHsl(tenantContext.branding.primaryColor);
    root.style.setProperty('--primary', `${primary.h} ${Math.max(45, primary.s)}% ${Math.max(40, Math.min(56, primary.l))}%`);
    root.style.setProperty('--ring', `${primary.h} ${Math.max(45, primary.s)}% ${Math.max(40, Math.min(56, primary.l))}%`);
    root.style.setProperty('--sidebar-primary', `${primary.h} ${Math.max(45, primary.s)}% ${Math.max(38, Math.min(52, primary.l))}%`);
  }, [tenantContext.branding.primaryColor]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const title = tenantContext.tenantName?.trim() || 'SL-ERP';
    document.title = title;
  }, [tenantContext.tenantName]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const faviconHref = tenantContext.branding.logoUrl || '/favicon.svg';
    const iconLink = ensureHeadLink('icon');
    const shortcutIconLink = ensureHeadLink('shortcut icon');
    if (iconLink) {
      iconLink.type = faviconHref.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      iconLink.href = faviconHref;
    }
    if (shortcutIconLink) {
      shortcutIconLink.type = faviconHref.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      shortcutIconLink.href = faviconHref;
    }
  }, [tenantContext.branding.logoUrl]);

  useEffect(() => {
    if (typeof window === 'undefined' || !tenantContext.tenantCode) return;
    window.localStorage.setItem('sl-erp-tenant-code', tenantContext.tenantCode);
  }, [tenantContext.tenantCode]);

  return {
    tenantContext,
    isLoading: tenantQuery.isLoading || settingsQuery.isLoading || workspaceQuery.isLoading,
  };
}
