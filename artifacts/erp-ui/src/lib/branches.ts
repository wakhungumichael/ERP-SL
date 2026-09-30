import type { QueryClient } from '@tanstack/react-query';

export type ErpBranch = {
  id: number;
  name: string;
  address?: string;
  email?: string;
  phone?: string;
};

// Shared ERP branch source. All modules should resolve tenant branches from here.
export const ERP_BRANCHES_ENDPOINT = '/api/commercial-weighbridge/branches/';
export const ERP_BRANCHES_QUERY_KEY = ['erp-branches'];

export function normalizeBranchList(payload: any): ErpBranch[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data?.branches)) return payload.data.branches;
  if (Array.isArray(payload?.branches)) return payload.branches;
  return [];
}

export async function fetchErpBranches(token: string, tenantId?: number): Promise<ErpBranch[]> {
  const params = new URLSearchParams({ page_size: '200' });
  if (tenantId) params.set('tenant_id', String(tenantId));
  const res = await fetch(`${ERP_BRANCHES_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const payload = await res.json();
  return normalizeBranchList(payload);
}

export function invalidateErpBranchQueries(queryClient: QueryClient) {
  const queryKeys = [
    ERP_BRANCHES_QUERY_KEY,
    ['/api/commercial-weighbridge/branches/'],
    ['wb-branches'],
    ['dlg-branches'],
    ['edit-tx-branches'],
  ];
  queryKeys.forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey });
  });
}
