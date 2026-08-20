import { useQuery } from '@tanstack/react-query';
import { History, ShieldAlert, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/use-auth';

type AuditSummary = {
  created_by_name?: string | null;
  created_on?: string | null;
  updated_by_name?: string | null;
  updated_on?: string | null;
  deleted_by_name?: string | null;
  deleted_on?: string | null;
};

type AuditEvent = {
  id: number;
  actor_name?: string | null;
  event_group?: string;
  event_type?: string;
  status?: string;
  note?: string;
  object_repr?: string;
  changes?: Record<string, unknown>;
  created_at?: string;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE');
}

function formatEventLabel(value?: string) {
  if (!value) return 'Event';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

export function RecordAuditTrail({
  modelLabel,
  objectPk,
}: {
  modelLabel: string;
  objectPk: string | number;
}) {
  const { token } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['record-audit-trail', modelLabel, String(objectPk)],
    queryFn: async () => {
      const params = new URLSearchParams({
        model_label: modelLabel,
        object_pk: String(objectPk),
      });
      const response = await fetch(`/api/platform/audit/record-trail/?${params.toString()}`, {
        headers: token ? { Authorization: `Token ${token}` } : {},
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? 'Failed to load audit trail.');
      }
      return payload?.data ?? { summary: {}, events: [] };
    },
    enabled: Boolean(token) && Boolean(modelLabel) && String(objectPk).length > 0,
    staleTime: 20_000,
  });

  const summary: AuditSummary = data?.summary ?? {};
  const events: AuditEvent[] = Array.isArray(data?.events) ? data.events : [];

  return (
    <Card>
      <CardHeader className="bg-muted/20 border-b">
        <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
          <History className="h-4 w-4" /> Audit Trail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground animate-pulse">Loading audit trail…</div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <SummaryField
                label="Created"
                value={
                  summary.created_by_name
                    ? `${summary.created_by_name} · ${formatDate(summary.created_on)}`
                    : formatDate(summary.created_on)
                }
              />
              <SummaryField
                label="Updated"
                value={
                  summary.updated_by_name
                    ? `${summary.updated_by_name} · ${formatDate(summary.updated_on)}`
                    : formatDate(summary.updated_on)
                }
              />
              <SummaryField
                label="Deleted"
                value={
                  summary.deleted_on
                    ? `${summary.deleted_by_name ?? 'Unknown'} · ${formatDate(summary.deleted_on)}`
                    : 'Not deleted'
                }
              />
            </div>

            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                No audit events have been recorded for this record yet.
              </div>
            ) : (
              <div className="space-y-3">
                {events.map(event => {
                  const changedFields = Object.keys(event.changes ?? {});
                  return (
                    <div key={event.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                            {formatEventLabel(event.event_group)}
                          </span>
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-800">
                            {formatEventLabel(event.event_type)}
                          </span>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {event.status ?? 'success'}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {formatDate(event.created_at)}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        <UserRound className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{event.actor_name ?? 'System'}</span>
                        {event.object_repr ? (
                          <span className="text-muted-foreground">on {event.object_repr}</span>
                        ) : null}
                      </div>
                      {event.note ? (
                        <p className="mt-2 text-sm text-muted-foreground">{event.note}</p>
                      ) : null}
                      {changedFields.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {changedFields.map(field => (
                            <span
                              key={field}
                              className="rounded-full border bg-muted/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                            >
                              {field.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
