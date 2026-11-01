/* Copyright (c) 2026 Siakora Labs Limited. */
import type { PublicSiteConfig } from '@/lib/public-site';

export const APP_MANIFEST_URL = '/api/platform/public/manifest/';
const APP_TENANT_COOKIE = 'sl-erp-app-tenant';

export function organizationCodeForUser(user?: Record<string, unknown> | null): string {
  const memberships = Array.isArray(user?.memberships) ? user.memberships as Array<Record<string, unknown>> : [];
  const activeId = String(user?.active_membership_id ?? '');
  const organizationId = String(user?.organization_id ?? user?.tenant_id ?? '');
  const membership = memberships.find((entry) => String(entry.id) === activeId)
    ?? memberships.find((entry) => organizationId && String(entry.tenant ?? entry.tenant_id) === organizationId);
  return String(membership?.tenant_code ?? membership?.organization_code ?? '').trim();
}

export function rememberAppOrganization(code?: string) {
  const value = code?.trim() || '';
  if (value) window.localStorage.setItem('sl-erp-tenant-code', value);
  else window.localStorage.removeItem('sl-erp-tenant-code');
  // This is only a public branding preference, never an authentication cookie.
  document.cookie = `${APP_TENANT_COOKIE}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${value ? 31536000 : 0}${window.location.protocol === 'https:' ? '; Secure' : ''}`;
}

function headLink(rel: string) {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  return link;
}

function headMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function iconAtSize(source: string, size: number) {
  const url = new URL(source, window.location.origin);
  if (url.origin === window.location.origin && url.pathname === '/api/platform/public/app-icon/') {
    url.searchParams.set('size', String(size));
    return url.pathname + url.search;
  }
  return source;
}

export function applyAppBranding(site: PublicSiteConfig, tenantCode?: string) {
  rememberAppOrganization(tenantCode);
  const name = site.branding.app_name || site.tenant?.name || site.login_page.title || 'Business Workspace';
  const icon = site.branding.app_icon_url || site.branding.logo_url || '/favicon.svg';
  const color = site.branding.primary_color || '#e85d26';
  document.title = name;
  headMeta('application-name', name);
  headMeta('apple-mobile-web-app-title', name);
  headMeta('theme-color', color);
  for (const rel of ['icon', 'shortcut icon', 'apple-touch-icon']) {
    const link = headLink(rel);
    link.href = iconAtSize(icon, rel === 'apple-touch-icon' ? 180 : 64);
    const path = new URL(link.href).pathname.toLowerCase();
    link.type = path.endsWith('.svg') ? 'image/svg+xml'
      : /\.jpe?g$/.test(path) ? 'image/jpeg' : path.endsWith('.webp') ? 'image/webp' : 'image/png';
    link.sizes.value = path.endsWith('.svg') ? 'any' : rel === 'apple-touch-icon' ? '180x180' : '64x64';
  }
  const manifest = headLink('manifest');
  const brandKey = JSON.stringify([tenantCode || '', name, icon, color]);
  if (manifest.dataset.appBrand !== brandKey) {
    const updated = manifest.cloneNode(false) as HTMLLinkElement;
    updated.href = APP_MANIFEST_URL;
    updated.crossOrigin = 'use-credentials';
    updated.dataset.appBrand = brandKey;
    // Reprocess the same manifest URL after its branding preference changes.
    manifest.replaceWith(updated);
  }
}
