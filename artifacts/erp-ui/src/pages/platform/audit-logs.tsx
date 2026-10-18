import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronRight, Clock3, Download, FileText, Search, Server, Shield, UserRound, Waypoints } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/use-auth';
import { ERPMetricCard, ERPPageHeader } from '@/components/erp/workspace/workspace-ui';

type FieldChange = { before?: unknown; after?: unknown; related_ids?: unknown[]; action?: string; changed_at?: string };
type AuditEvent = { id: number; tenant_name?: string | null; branch_name?: string | null; actor_name?: string | null; event_group?: string; event_type?: string; status?: string; model_label?: string; object_pk?: string; object_repr?: string; note?: string; changes?: Record<string, unknown>; metadata?: Record<string, unknown>; created_at?: string };
type AccessEvent = { id: number; tenant_name?: string | null; actor_name?: string | null; event_group?: string; event_type?: string; request_method?: string; request_path?: string; status_code?: number | null; metadata?: Record<string, unknown>; created_at?: string };

const PAGE_SIZE = 12;
const HIDDEN_FIELDS = new Set(['id', 'tenant', 'tenant_id', 'branch', 'branch_id', 'created_by', 'created_by_id', 'last_modified_by', 'last_modified_by_id']);
const formatLabel = (value?: string | null) => value ? value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : '—';
const fieldLabel = (value: string) => formatLabel(value.replace(/_id$/, ''));
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
const readMeta = (metadata: Record<string, unknown> | undefined, key: string) => formatValue(metadata?.[key]);
const actorLabel = (row: Pick<AuditEvent | AccessEvent, 'actor_name' | 'metadata'>) => row.actor_name || String(row.metadata?.actor_name || row.metadata?.actor_username || 'System process');
const changesFor = (row: AuditEvent) => Object.entries(row.changes ?? {}).filter(([field]) => !HIDDEN_FIELDS.has(field) && !field.endsWith('_at')).map(([field, value]) => ({ field, value: (value ?? {}) as FieldChange }));

function EventBadges({ group, type, status }: { group?: string; type?: string; status?: string }) {
  return <div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">{formatLabel(group)}</span><span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800">{formatLabel(type)}</span>{status ? <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{status}</span> : null}</div>;
}
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (value: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages === 1) return null;
  return <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground"><span>Page {page} of {pages}</span><div className="flex gap-2"><button type="button" onClick={() => onChange(page - 1)} disabled={page === 1} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Previous</button><button type="button" onClick={() => onChange(page + 1)} disabled={page === pages} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

export default function AuditLogsPage() {
  const { token, role, user } = useAuth();
  const [search, setSearch] = useState('');
  const [eventGroup, setEventGroup] = useState('');
  const [eventStatus, setEventStatus] = useState('');
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const [expandedAccess, setExpandedAccess] = useState<Set<number>>(new Set());
  const [eventPage, setEventPage] = useState(1);
  const [accessPage, setAccessPage] = useState(1);
  const [exporting, setExporting] = useState<string | null>(null);
  const auditPermissions = new Set(Array.isArray((user as any)?.permissions) ? (user as any).permissions.map(String) : []);
  const canExportAudit = Boolean((user as any)?.is_superuser) || auditPermissions.has('Platform_Core.export_audit_logs');
  const toggle = (id: number, kind: 'event' | 'access') => (kind === 'event' ? setExpandedEvents : setExpandedAccess)(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const resetPages = () => { setEventPage(1); setAccessPage(1); };
  const eventQuery = useQuery({ queryKey: ['platform-audit-events', eventGroup, eventStatus, search], queryFn: async () => {
    const params = new URLSearchParams({ limit: '150' }); if (eventGroup) params.set('event_group', eventGroup); if (eventStatus) params.set('status', eventStatus); if (search.trim()) params.set('search', search.trim());
    const response = await fetch(`/api/platform/audit/events/?${params}`, { headers: token ? { Authorization: `Token ${token}` } : {} }); const payload = await response.json(); if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? 'Failed to load audit events.'); return Array.isArray(payload?.data) ? payload.data as AuditEvent[] : [];
  }, enabled: Boolean(token), staleTime: 20_000 });
  const accessQuery = useQuery({ queryKey: ['platform-access-events', search], queryFn: async () => {
    const params = new URLSearchParams({ limit: '150' }); if (search.trim()) params.set('search', search.trim());
    const response = await fetch(`/api/platform/audit/access/?${params}`, { headers: token ? { Authorization: `Token ${token}` } : {} }); const payload = await response.json(); if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? 'Failed to load access logs.'); return Array.isArray(payload?.data) ? payload.data as AccessEvent[] : [];
  }, enabled: Boolean(token), staleTime: 20_000 });
  const events = useMemo(() => eventQuery.data ?? [], [eventQuery.data]);
  const access = useMemo(() => accessQuery.data ?? [], [accessQuery.data]);
  const eventRows = events.slice((eventPage - 1) * PAGE_SIZE, eventPage * PAGE_SIZE);
  const accessRows = access.slice((accessPage - 1) * PAGE_SIZE, accessPage * PAGE_SIZE);
  const exportAudit = async (dataset: 'events' | 'access', format: 'csv' | 'pdf') => {
    if (!token) return;
    const exportKey = `${dataset}-${format}`;
    setExporting(exportKey);
    try {
      const params = new URLSearchParams({ dataset, format });
      if (search.trim()) params.set('search', search.trim());
      if (dataset === 'events') {
        if (eventGroup) params.set('event_group', eventGroup);
        if (eventStatus) params.set('status', eventStatus);
      }
      const response = await fetch(`/api/platform/audit/export/?${params}`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? payload?.error ?? 'Audit export could not be generated.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-${dataset}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Audit export could not be generated.');
    } finally {
      setExporting(null);
    }
  };
  const filters = <div className="flex w-full flex-wrap gap-2 sm:w-auto"><div className="relative w-full sm:w-80"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => { setSearch(event.target.value); resetPages(); }} placeholder="Search actor, record, model, path..." className="pl-9" /></div><select value={eventGroup} onChange={event => { setEventGroup(event.target.value); resetPages(); }} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">All categories</option><option value="data_lifecycle">Data changes</option><option value="workflow">Workflow</option><option value="security">Security</option><option value="access">Access</option><option value="integration">Integration</option><option value="system">System</option></select><select value={eventStatus} onChange={event => { setEventStatus(event.target.value); resetPages(); }} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">All outcomes</option><option value="success">Success</option><option value="warning">Warning</option><option value="failed">Failed</option></select></div>;
  return <div className="space-y-5"><ERPPageHeader title="Audit Logs" description={role === 'superadmin' ? 'Cross-tenant oversight for data changes, workflow actions, and user access.' : 'Tenant-scoped visibility into record changes and access activity.'} actions={filters} />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><ERPMetricCard label="Change Events" value={events.length} /><ERPMetricCard label="Access Events" value={access.length} /><ERPMetricCard label="Scope" value={role === 'superadmin' ? 'Global' : 'Organization'} detail={role === 'superadmin' ? 'Multi-tenant visibility' : 'Restricted to your organization'} /></div>
    <Tabs defaultValue="events" className="space-y-4"><TabsList><TabsTrigger value="events" className="gap-1.5"><Waypoints className="h-3.5 w-3.5" /> Change Logs</TabsTrigger><TabsTrigger value="access" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Access Logs</TabsTrigger></TabsList>
      <TabsContent value="events"><Card><CardHeader className="border-b bg-muted/20"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><Activity className="h-4 w-4" /> Audit Event Stream <span className="ml-auto normal-case tracking-normal text-muted-foreground">Select a record to view fields and evidence</span></CardTitle>{canExportAudit ? <div className="flex gap-2"><Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => exportAudit('events', 'csv')}><Download />{exporting === 'events-csv' ? 'Exporting...' : 'CSV'}</Button><Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => exportAudit('events', 'pdf')}><Download />{exporting === 'events-pdf' ? 'Exporting...' : 'PDF'}</Button></div> : null}</div></CardHeader><CardContent className="space-y-2 p-4">
        {eventQuery.isLoading ? <div className="p-4 text-sm text-muted-foreground animate-pulse">Loading audit events…</div> : eventQuery.error ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{(eventQuery.error as Error).message}</div> : eventRows.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No matching audit events found.</div> : eventRows.map(row => { const fields = changesFor(row); const open = expandedEvents.has(row.id); return <section key={row.id} className="overflow-hidden rounded-xl border bg-card"><button type="button" onClick={() => toggle(row.id, 'event')} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-4 text-left hover:bg-muted/30">{open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}<EventBadges group={row.event_group} type={row.event_type} status={row.status} /><span className="min-w-44 flex-1 font-semibold">{row.object_repr || row.model_label || 'Audit event'}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{actorLabel(row)}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{formatDate(row.created_at)}</span></button>{open ? <div className="border-t bg-muted/10 p-4"><div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs text-muted-foreground">Actor</p><p className="font-medium">{actorLabel(row)}</p></div><div><p className="text-xs text-muted-foreground">Tenant / branch</p><p className="font-medium">{row.tenant_name ?? 'Global'}{row.branch_name ? ` / ${row.branch_name}` : ''}</p></div><div><p className="text-xs text-muted-foreground">Model</p><p className="font-medium">{row.model_label ?? '—'}</p></div><div><p className="text-xs text-muted-foreground">Record ID</p><p className="font-mono">{row.object_pk ?? '—'}</p></div></div>{row.note ? <div className="mt-4 rounded-lg border-l-4 border-primary/50 bg-background p-3 text-sm">{row.note}</div> : null}<div className="mt-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Changed fields <span className="rounded-full bg-background px-2 py-0.5">{fields.length}</span></div>{fields.length ? <div className="overflow-x-auto rounded-lg border bg-background"><div className="min-w-[740px] divide-y"><div className="grid grid-cols-[0.7fr_1fr_1fr_0.9fr] gap-4 bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"><span>Field</span><span>Previous value</span><span>New value</span><span>Changed at</span></div>{fields.map(({ field, value }) => <div key={field} className="grid grid-cols-[0.7fr_1fr_1fr_0.9fr] gap-4 px-3 py-3 text-sm"><span className="font-medium">{fieldLabel(field)}</span><span className="break-words text-muted-foreground">{formatValue(value.before)}</span><span className="break-words font-medium text-emerald-700">{formatValue(value.after ?? value.related_ids ?? value.action)}</span><span className="text-xs text-muted-foreground">{formatDate(value.changed_at || row.created_at)}</span></div>)}</div></div> : <p className="rounded-lg border border-dashed bg-background p-3 text-sm text-muted-foreground">No business fields changed in this event.</p>}</div><div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Server className="h-3.5 w-3.5" /> {readMeta(row.metadata, 'host')} <span>•</span> Client IP: {readMeta(row.metadata, 'client_ip')}</div></div> : null}</section>; })}<Pager page={eventPage} total={events.length} onChange={setEventPage} />
      </CardContent></Card></TabsContent>
      <TabsContent value="access"><Card><CardHeader className="border-b bg-muted/20"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><Shield className="h-4 w-4" /> Access Activity</CardTitle>{canExportAudit ? <div className="flex gap-2"><Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => exportAudit('access', 'csv')}><Download />{exporting === 'access-csv' ? 'Exporting...' : 'CSV'}</Button><Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => exportAudit('access', 'pdf')}><Download />{exporting === 'access-pdf' ? 'Exporting...' : 'PDF'}</Button></div> : null}</div></CardHeader><CardContent className="space-y-2 p-4">
        {accessQuery.isLoading ? <div className="p-4 text-sm text-muted-foreground animate-pulse">Loading access logs…</div> : accessQuery.error ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{(accessQuery.error as Error).message}</div> : accessRows.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No matching access logs found.</div> : accessRows.map(row => { const open = expandedAccess.has(row.id); return <section key={row.id} className="overflow-hidden rounded-xl border bg-card"><button type="button" onClick={() => toggle(row.id, 'access')} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-4 text-left hover:bg-muted/30">{open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}<EventBadges group={row.event_group} type={row.event_type} /><span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{row.request_method ?? 'GET'}</span><span className="min-w-52 flex-1 truncate font-mono text-sm">{row.request_path ?? '—'}</span><span className="text-xs text-muted-foreground">{actorLabel(row)}</span><span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span></button>{open ? <div className="grid gap-3 border-t bg-muted/10 p-4 text-sm md:grid-cols-2 xl:grid-cols-3"><div><p className="text-xs text-muted-foreground">Actor</p><p className="font-medium">{actorLabel(row)}</p></div><div><p className="text-xs text-muted-foreground">Tenant</p><p className="font-medium">{row.tenant_name ?? 'Global'}</p></div><div><p className="text-xs text-muted-foreground">Response status</p><p className="font-medium">{row.status_code ?? '—'}</p></div><div><p className="text-xs text-muted-foreground">Host / Client IP</p><p>{readMeta(row.metadata, 'host')} / {readMeta(row.metadata, 'client_ip')}</p></div><div className="xl:col-span-2"><p className="text-xs text-muted-foreground">Referrer</p><p className="break-all">{readMeta(row.metadata, 'referer')}</p></div></div> : null}</section>; })}<Pager page={accessPage} total={access.length} onChange={setAccessPage} />
      </CardContent></Card></TabsContent>
    </Tabs>
  </div>;
}
