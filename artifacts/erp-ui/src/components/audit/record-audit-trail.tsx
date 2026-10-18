/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, History, ShieldAlert, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { apiErrorFromResponse, getUserFacingError } from '@/lib/api-errors';

type AuditSummary = { created_by_name?: string | null; created_on?: string | null; updated_by_name?: string | null; updated_on?: string | null; deleted_by_name?: string | null; deleted_on?: string | null };
type AuditEvent = { id: number; actor_name?: string | null; event_group?: string; event_type?: string; status?: string; note?: string; object_repr?: string; changes?: Record<string, unknown>; metadata?: Record<string, unknown>; created_at?: string };
type FieldChange = { before?: unknown; after?: unknown; action?: string; related_ids?: unknown[]; changed_at?: string };
const HIDDEN_FIELDS = new Set(['id', 'tenant', 'tenant_id', 'branch', 'branch_id', 'created_by', 'created_by_id', 'last_modified_by', 'last_modified_by_id']);
const label = (value?: string) => value ? value.replace(/_id$/, '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : '—';
const date = (value?: string | null) => value ? new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
const value = (item: unknown) => item === null || item === undefined || item === '' ? '—' : item === true ? 'Yes' : item === false ? 'No' : Array.isArray(item) ? item.join(', ') || 'None' : typeof item === 'object' ? JSON.stringify(item) : String(item);
const actor = (event: AuditEvent) => event.actor_name || String(event.metadata?.actor_name || event.metadata?.actor_username || 'System process');
const fields = (event: AuditEvent) => Object.entries(event.changes ?? {}).filter(([field]) => !HIDDEN_FIELDS.has(field) && !field.endsWith('_at')).map(([field, change]) => ({ field, change: (change ?? {}) as FieldChange }));
const csvCell = (item: unknown) => `"${String(item ?? '').replaceAll('"', '""')}"`;
const html = (item: unknown) => String(item ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function download(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function exportLoadedTrail(events: AuditEvent[], objectPk: string | number, format: 'csv' | 'pdf') {
  const rows = events.map((event) => [date(event.created_at), actor(event), label(event.event_group), label(event.event_type), label(event.status), event.object_repr || 'Record event', fields(event).map(({ field, change }) => `${label(field)}: ${value(change.before)} -> ${value(change.after ?? change.related_ids ?? change.action)}`).join('; '), event.note || '']);
  const headers = ['Timestamp', 'Actor', 'Category', 'Action', 'Outcome', 'Record', 'Field changes', 'Notes'];
  if (format === 'csv') {
    download([headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'), `audit-record-${objectPk}.csv`, 'text/csv;charset=utf-8');
    return;
  }
  const tableRows = rows.map((row) => `<tr>${row.map((cell) => `<td>${html(cell)}</td>`).join('')}</tr>`).join('');
  const report = `<!doctype html><html><head><title>Audit record ${html(objectPk)}</title><style>@page { size: A4 landscape; margin: 14mm; } body { font-family: Arial, sans-serif; color: #172033; } h1 { font-size: 18px; margin: 0 0 6px; } p { color: #556070; margin: 0 0 16px; } table { width: 100%; border-collapse: collapse; font-size: 9px; } th { background: #1f2937; color: white; text-align: left; } th, td { border: 1px solid #d1d5db; padding: 5px; vertical-align: top; word-break: break-word; }</style></head><body><h1>Audit Trail: Record ${html(objectPk)}</h1><p>Generated ${html(date(new Date().toISOString()))}. Save this print dialog as PDF.</p><table><thead><tr>${headers.map((header) => `<th>${html(header)}</th>`).join('')}</tr></thead><tbody>${tableRows || `<tr><td colspan="${headers.length}">No audit events recorded.</td></tr>`}</tbody></table></body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  const url = URL.createObjectURL(new Blob([report], { type: 'text/html' }));
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 60_000);
  };
  frame.src = url;
  document.body.appendChild(frame);
}

function SummaryField({ name, children }: { name: string; children: React.ReactNode }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{name}</p><p className="mt-1 text-sm font-medium">{children}</p></div>;
}
function EventRow({ event, showChanges }: { event: AuditEvent; showChanges: boolean }) {
  const [open, setOpen] = useState(false);
  const changes = fields(event);
  return <section className="overflow-hidden rounded-lg border bg-background"><button type="button" onClick={() => setOpen(current => !current)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left hover:bg-muted/30">{open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">{label(event.event_group)}</span><span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800">{label(event.event_type)}</span><span className="flex-1 text-sm font-medium">{event.object_repr || 'Record event'}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{actor(event)}</span><span className="text-xs text-muted-foreground">{date(event.created_at)}</span></button>{open ? <div className="border-t bg-muted/10 p-3"><div className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">Actor:</span> {actor(event)}</p><p><span className="text-muted-foreground">Outcome:</span> {label(event.status)}</p></div>{event.note ? <p className="mt-3 rounded border-l-4 border-primary/50 bg-background p-2.5 text-sm">{event.note}</p> : null}{showChanges && changes.length ? <div className="mt-3 overflow-x-auto rounded-md border bg-background"><div className="min-w-[700px] divide-y"><div className="grid grid-cols-[0.7fr_1fr_1fr_0.9fr] gap-3 bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"><span>Field</span><span>Previous value</span><span>New value</span><span>Changed at</span></div>{changes.map(({ field, change }) => <div key={field} className="grid grid-cols-[0.7fr_1fr_1fr_0.9fr] gap-3 px-3 py-2.5 text-sm"><span className="font-medium">{label(field)}</span><span className="break-words text-muted-foreground">{value(change.before)}</span><span className="break-words font-medium text-emerald-700">{value(change.after ?? change.related_ids ?? change.action)}</span><span className="text-xs text-muted-foreground">{date(change.changed_at || event.created_at)}</span></div>)}</div></div> : showChanges ? <p className="mt-3 rounded border border-dashed bg-background p-2.5 text-sm text-muted-foreground">No business fields changed in this event.</p> : null}</div> : null}</section>;
}

export function RecordAuditTrail({ modelLabel, objectPk }: { modelLabel: string; objectPk: string | number }) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const permissions = new Set(Array.isArray((user as any)?.permissions) ? (user as any).permissions.map(String) : []);
  const canView = Boolean((user as any)?.is_superuser) || permissions.has('Platform_Core.view_tenant_audit_logs') || permissions.has('Platform_Core.view_global_audit_logs');
  const canExport = Boolean((user as any)?.is_superuser) || permissions.has('Platform_Core.export_audit_logs');
  const { data, isLoading, error } = useQuery({ queryKey: ['record-audit-trail', modelLabel, String(objectPk)], queryFn: async () => {
    const params = new URLSearchParams({ model_label: modelLabel, object_pk: String(objectPk) });
    const response = await fetch(`/api/platform/audit/record-trail/?${params}`, { headers: token ? { Authorization: `Token ${token}` } : {} });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? 'Failed to load audit trail.');
    return payload?.data ?? { summary: {}, events: [] };
  }, enabled: open && canView && Boolean(token), staleTime: 20_000 });
  if (!canView) return null;
  const summary: AuditSummary = data?.summary ?? {};
  const events: AuditEvent[] = Array.isArray(data?.events) ? data.events : [];
  const exportTrail = async (format: 'csv' | 'pdf') => {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ dataset: 'events', export_format: format, model_label: modelLabel, object_pk: String(objectPk) });
      const response = await fetch(`/api/platform/audit/export/?${params}`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, 'We could not generate this audit export. Please try again.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `audit-record-${objectPk}.${format}`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      try {
        exportLoadedTrail(events, objectPk, format);
        toast({ title: format === 'csv' ? 'Audit CSV downloaded' : 'Audit report ready to save', description: format === 'csv' ? 'The server export was unavailable, so the loaded audit trail was exported locally.' : 'The server export was unavailable. Choose “Save as PDF” in the print dialog.' });
      } catch (fallbackError) {
        const message = getUserFacingError(fallbackError ?? reason, 'We could not generate this audit export. Please try again.');
        toast({ title: message.title, description: message.description, variant: 'destructive' });
      }
    } finally { setExporting(false); }
  };
  return <><Button size="sm" variant="outline" className="gap-1.5 text-xs font-bold uppercase tracking-wide" onClick={() => setOpen(true)}><History className="h-3.5 w-3.5" /> Audit Trail</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><div className="flex flex-wrap items-center justify-between gap-3 pr-8"><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Audit Trail</DialogTitle>{canExport ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={exporting} onClick={() => exportTrail('csv')}><Download /> CSV</Button><Button size="sm" variant="outline" disabled={exporting} onClick={() => exportTrail('pdf')}><Download /> PDF</Button></div> : null}</div></DialogHeader>{isLoading ? <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading audit trail…</div> : error ? <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{(error as Error).message}</div> : <Tabs defaultValue="summary" className="mt-2"><TabsList className="w-full justify-start"><TabsTrigger value="summary">Summary</TabsTrigger><TabsTrigger value="activity">Activity ({events.length})</TabsTrigger><TabsTrigger value="changes">Field Changes</TabsTrigger></TabsList><TabsContent value="summary" className="space-y-4 pt-3"><div className="grid gap-3 md:grid-cols-3"><SummaryField name="Created">{summary.created_by_name ? `${summary.created_by_name} · ${date(summary.created_on)}` : date(summary.created_on)}</SummaryField><SummaryField name="Last updated">{summary.updated_by_name ? `${summary.updated_by_name} · ${date(summary.updated_on)}` : date(summary.updated_on)}</SummaryField><SummaryField name="Deleted">{summary.deleted_on ? `${summary.deleted_by_name ?? 'Unknown'} · ${date(summary.deleted_on)}` : 'Not deleted'}</SummaryField></div><div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">Select <strong>Activity</strong> to review every event or <strong>Field Changes</strong> to compare stored values. Each entry expands independently.</div></TabsContent><TabsContent value="activity" className="space-y-2 pt-3">{events.length ? events.map(event => <EventRow key={event.id} event={event} showChanges={false} />) : <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No audit events have been recorded for this record yet.</div>}</TabsContent><TabsContent value="changes" className="space-y-2 pt-3">{events.length ? events.map(event => <EventRow key={event.id} event={event} showChanges />) : <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No field changes have been recorded for this record yet.</div>}</TabsContent></Tabs>}</DialogContent></Dialog></>;
}
