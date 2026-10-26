/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import type { DashboardTenantContextValue } from '@/components/dashboard/types';
import type { NavSection } from '@/lib/roles';
import { themeVariables } from '@/lib/tenant-theme';
import { fetchPublicSiteConfig } from '@/lib/public-site';

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

export function useTenantTheme({ applyTheme = true }: { applyTheme?: boolean } = {}) {
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

  const tenantContext = useMemo<DashboardTenantContextValue>(() => {
    // Signed-in workspaces always use their own tenant profile. Public SaaS
    // branding must never become a fallback that masks a tenant's identity.
    const primaryColor = settings.primary_color || '#E85D26';
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
        logoUrl: settings.logo_url || '',
        primaryColor,
        workspaceName: settings.workspace_name || tenant.name || publicSite?.tenant?.name || '',
        currency: tenant.default_currency || 'KES',
        locale: tenant.default_currency === 'USD' ? 'en-US' : 'en-KE',
        timezone: tenant.timezone || 'Africa/Nairobi',
        footerText: settings.footer_text || '',
        supportEmail: settings.support_email || '',
      },
    };
  }, [organizationId, publicSite?.tenant?.name, role, settings, tenant, tenantCode, user, userId, workspace]);

  useEffect(() => {
    if (!applyTheme) return;
    const root = document.documentElement;
    const variables = themeVariables({
      primary_color: tenantContext.branding.primaryColor,
      secondary_color: settings.secondary_color,
      accent_color: settings.accent_color,
      sidebar_color: settings.sidebar_color,
    });
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(variables)) root.style.removeProperty(name);
    };
  }, [applyTheme, tenantContext.branding.primaryColor, settings.secondary_color, settings.accent_color, settings.sidebar_color]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const title = tenantContext.branding.workspaceName?.trim() || tenantContext.tenantName?.trim() || 'Business Workspace';
    document.title = title;
  }, [tenantContext.branding.workspaceName, tenantContext.tenantName]);

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
    if (!tenantContext.tenantCode || typeof document === 'undefined') return;
    const manifest = ensureHeadLink('manifest');
    if (manifest) manifest.href = `/api/platform/public/manifest/?tenant_code=${encodeURIComponent(tenantContext.tenantCode)}`;
  }, [tenantContext.tenantCode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !tenantContext.tenantCode) return;
    window.localStorage.setItem('sl-erp-tenant-code', tenantContext.tenantCode);
  }, [tenantContext.tenantCode]);

  return {
    tenantContext,
    isLoading: tenantQuery.isLoading || settingsQuery.isLoading || workspaceQuery.isLoading,
  };
}
