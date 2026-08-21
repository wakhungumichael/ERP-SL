import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Search, Shield, Waypoints } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/use-auth';
import { ERPMetricCard, ERPPageHeader } from '@/components/erp/workspace/workspace-ui';

type AuditEvent = {
  id: number;
  tenant_name?: string | null;
  branch_name?: string | null;
  actor_name?: string | null;
  event_group?: string;
  event_type?: string;
  status?: string;
  model_label?: string;
  object_pk?: string;
  object_repr?: string;
  note?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

type AccessEvent = {
  id: number;
  tenant_name?: string | null;
  actor_name?: string | null;
  event_group?: string;
  event_type?: string;
  request_method?: string;
  request_path?: string;
  status_code?: number | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE');
}

function formatLabel(value?: string | null) {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function readMetaString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export default function AuditLogsPage() {
  const { token, role } = useAuth();
  const [search, setSearch] = useState('');

  const eventQuery = useQuery({
    queryKey: ['platform-audit-events'],
    queryFn: async () => {
      const response = await fetch('/api/platform/audit/events/?limit=150', {
        headers: token ? { Authorization: `Token ${token}` } : {},
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? 'Failed to load audit events.');
      }
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    enabled: Boolean(token),
    staleTime: 20_000,
  });

  const accessQuery = useQuery({
    queryKey: ['platform-access-events'],
    queryFn: async () => {
      const response = await fetch('/api/platform/audit/access/?limit=150', {
        headers: token ? { Authorization: `Token ${token}` } : {},
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? 'Failed to load access logs.');
      }
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    enabled: Boolean(token),
    staleTime: 20_000,
  });

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows: AuditEvent[] = eventQuery.data ?? [];
    if (!needle) return rows;
    return rows.filter(row =>
      [
        row.tenant_name,
        row.branch_name,
        row.actor_name,
        row.event_group,
        row.event_type,
        row.model_label,
        row.object_pk,
        row.object_repr,
        row.note,
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle))
    );
  }, [eventQuery.data, search]);

  const filteredAccess = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows: AccessEvent[] = accessQuery.data ?? [];
    if (!needle) return rows;
    return rows.filter(row =>
      [
        row.tenant_name,
        row.actor_name,
        row.event_group,
        row.event_type,
        row.request_method,
        row.request_path,
        row.status_code,
      ]
        .filter(value => value !== null && value !== undefined)
        .some(value => String(value).toLowerCase().includes(needle))
    );
  }, [accessQuery.data, search]);

  return (
    <div className="space-y-5">
      <ERPPageHeader
        title="Audit Logs"
        description={role === 'superadmin'
          ? 'Cross-tenant oversight for data changes, workflow actions, and user access.'
          : 'Tenant-scoped visibility into record changes and access activity.'}
        actions={
          <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search actor, tenant, model, path..."
            className="pl-9"
          />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ERPMetricCard label="Change Events" value={eventQuery.data?.length ?? 0} />
        <ERPMetricCard label="Access Events" value={accessQuery.data?.length ?? 0} />
        <ERPMetricCard label="Scope" value={role === 'superadmin' ? 'Global' : 'Organization'} detail={role === 'superadmin' ? 'Multi-tenant visibility' : 'Restricted to your organization'} />
      </div>

      <Tabs defaultValue="events" className="space-y-4">
        <TabsList>
          <TabsTrigger value="events" className="gap-1.5">
            <Waypoints className="h-3.5 w-3.5" /> Change Logs
          </TabsTrigger>
          <TabsTrigger value="access" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Access Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <Card>
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                <Activity className="h-4 w-4" /> Audit Event Stream
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6">
              {eventQuery.isLoading ? (
                <div className="text-sm text-muted-foreground animate-pulse">Loading audit events…</div>
              ) : eventQuery.error ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {(eventQuery.error as Error).message}
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  No matching audit events found.
                </div>
              ) : (
                filteredEvents.map(row => (
                  <div key={row.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                          {formatLabel(row.event_group)}
                        </span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-800">
                          {formatLabel(row.event_type)}
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {row.status ?? 'success'}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">{formatDate(row.created_at)}</div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                      <div><span className="text-muted-foreground">Actor:</span> {row.actor_name ?? 'System'}</div>
                      <div><span className="text-muted-foreground">Tenant:</span> {row.tenant_name ?? 'Global'}</div>
                      <div><span className="text-muted-foreground">Model:</span> {row.model_label ?? '—'}</div>
                      <div><span className="text-muted-foreground">Record:</span> {row.object_repr ?? row.object_pk ?? '—'}</div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div><span className="font-semibold">Host:</span> {readMetaString(row.metadata, 'host')}</div>
                      <div><span className="font-semibold">IP:</span> {readMetaString(row.metadata, 'client_ip')}</div>
                    </div>
                    {row.note ? <p className="mt-3 text-sm text-muted-foreground">{row.note}</p> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <Card>
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                <Shield className="h-4 w-4" /> Access Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6">
              {accessQuery.isLoading ? (
                <div className="text-sm text-muted-foreground animate-pulse">Loading access logs…</div>
              ) : accessQuery.error ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {(accessQuery.error as Error).message}
                </div>
              ) : filteredAccess.length === 0 ? (
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  No matching access logs found.
                </div>
              ) : (
                filteredAccess.map(row => (
                  <div key={row.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                          {formatLabel(row.event_group)}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-800">
                          {formatLabel(row.event_type)}
                        </span>
                        <span className="rounded-full bg-muted/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {row.request_method ?? 'GET'}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">{formatDate(row.created_at)}</div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                      <div><span className="text-muted-foreground">Actor:</span> {row.actor_name ?? 'Guest / Anonymous'}</div>
                      <div><span className="text-muted-foreground">Tenant:</span> {row.tenant_name ?? 'Global'}</div>
                      <div className="md:col-span-2"><span className="text-muted-foreground">Path:</span> {row.request_path ?? '—'}</div>
                      <div><span className="text-muted-foreground">Status:</span> {row.status_code ?? '—'}</div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div><span className="font-semibold">Host:</span> {readMetaString(row.metadata, 'host')}</div>
                      <div><span className="font-semibold">Client IP:</span> {readMetaString(row.metadata, 'client_ip')}</div>
                      <div><span className="font-semibold">Forwarded For:</span> {readMetaString(row.metadata, 'forwarded_for')}</div>
                      <div><span className="font-semibold">Real IP:</span> {readMetaString(row.metadata, 'real_ip')}</div>
                      <div><span className="font-semibold">Referer:</span> {readMetaString(row.metadata, 'referer')}</div>
                      <div><span className="font-semibold">Origin:</span> {readMetaString(row.metadata, 'origin')}</div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
