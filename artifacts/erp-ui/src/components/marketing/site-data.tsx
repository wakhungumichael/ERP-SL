/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_PUBLIC_SITE, fetchPublicSiteConfig } from '@/lib/public-site';

export function useMarketingSite(tenantCode?: string) {
  const { data } = useQuery({
    queryKey: ['public-site-config', tenantCode ?? 'owner'],
    queryFn: () => fetchPublicSiteConfig(tenantCode),
    retry: false,
    staleTime: 5 * 60_000,
  });

  return data ?? DEFAULT_PUBLIC_SITE;
}
