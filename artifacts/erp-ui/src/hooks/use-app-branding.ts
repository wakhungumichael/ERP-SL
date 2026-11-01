/* Copyright (c) 2026 Siakora Labs Limited. */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useRoute } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { applyAppBranding, organizationCodeForUser } from '@/lib/app-branding';
import { fetchPublicSiteConfig, getCachedPublicSiteConfig } from '@/lib/public-site';

const PLATFORM_PAGES = new Set(['/landing/apps', '/landing/pricing', '/landing/about', '/landing/support', '/landing/privacy']);

export function useAppBranding() {
  const { token, user } = useAuth();
  const [location] = useLocation();
  const [, login] = useRoute('/login/:tenantCode');
  const [, landing] = useRoute('/landing/:tenantCode');
  const [, landingPage] = useRoute('/landing/:tenantCode/:page');
  const routeCode = PLATFORM_PAGES.has(location) ? undefined
    : login?.tenantCode ?? landing?.tenantCode ?? landingPage?.tenantCode;
  const tenantCode = token
    ? organizationCodeForUser(user) || undefined
    : routeCode || window.localStorage.getItem('sl-erp-tenant-code') || undefined;
  const { data } = useQuery({
    queryKey: ['public-site-config', tenantCode ?? 'owner'],
    queryFn: () => fetchPublicSiteConfig(tenantCode),
    initialData: () => getCachedPublicSiteConfig(tenantCode),
    enabled: !token || Boolean(user),
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    if (data && (!token || user)) applyAppBranding(data, tenantCode);
  }, [data, tenantCode, token, user]);
}
