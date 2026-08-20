import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { KanbanSquare, Rows3 } from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  meeting: <CalendarClock className="h-4 w-4" />,
  note: <MessageSquare className="h-4 w-4" />,
  task: <CheckCircle2 className="h-4 w-4" />,
};

const TYPE_COLORS: Record<string, string> = {
  call: 'bg-blue-100 text-blue-800 border-blue-200',
  email: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  meeting: 'bg-purple-100 text-purple-800 border-purple-200',
  note: 'bg-amber-100 text-amber-800 border-amber-200',
  task: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const TYPES = [
  { value: 'call', label: 'Phone Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
  { value: 'task', label: 'Task' },
];

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function toDateKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function sortAsc(items: any[]) {
  return [...items].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function QueueCard({
  title,
  subtitle,
  items,
  emptyLabel,
  accent,
}: {
  title: string;
  subtitle: string;
  items: any[];
  emptyLabel: string;
  accent: string;
}) {
  return (
    <div className="w-[340px] shrink-0 rounded-2xl border bg-card shadow-sm">
      <div className="sticky top-0 z-10 rounded-t-2xl border-b bg-card/95 p-5 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</div>
            <div className="mt-1 text-lg font-semibold">{subtitle}</div>
          </div>
          <div className={`rounded-full px-3 py-1 text-sm font-black ${accent}`}>{items.length}</div>
        </div>
      </div>
      <div className="min-h-[460px] space-y-3 p-5">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">{emptyLabel}</div>
          ) : (
            items.map((item) => <FollowUpCard key={item.id} activity={item} compact />)
          )}
      </div>
    </div>
  );
}

function FollowUpCard({ activity, compact = false }: { activity: any; compact?: boolean }) {
  const dt = formatDateTime(activity.date);
  const today = todayDateKey();
  return (
    <div className={`rounded-2xl border bg-background p-4 ${compact ? 'transition-all hover:-translate-y-0.5 hover:shadow-md' : 'shadow-sm'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${TYPE_COLORS[activity.type] ?? 'bg-secondary border-border'}`}>
            {TYPE_ICONS[activity.type] ?? <MessageSquare className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{activity.summary}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{activity.contact_name || 'No person linked'}</span>
              <span>{activity.organisation_name || 'No company linked'}</span>
              <span>{activity.lead_title || 'No opportunity linked'}</span>
              <span>{activity.created_by_name || 'Unknown owner'}</span>
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="mb-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">CRM-ACT-{activity.id}</div>
          <div className="text-xs font-mono text-muted-foreground">{dt.date}</div>
          <div className="text-[11px] text-muted-foreground">{dt.time}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${TYPE_COLORS[activity.type] ?? 'bg-secondary border-border'}`}>
          {TYPE_ICONS[activity.type] ?? <MessageSquare className="h-3 w-3" />}
          {activity.type_display || activity.type}
        </span>
        {toDateKey(activity.date) < today ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-[10px] font-medium text-rose-700">
            <AlertTriangle className="h-3 w-3" />
            Overdue
          </span>
        ) : toDateKey(activity.date) === today ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-700">
            <Clock3 className="h-3 w-3" />
            Due today
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-medium text-emerald-700">
            <CalendarClock className="h-3 w-3" />
            Upcoming
          </span>
        )}
      </div>
      {!compact ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/crm/people"><Button size="sm" variant="outline">Person</Button></Link>
          <Link href="/crm/companies"><Button size="sm" variant="outline">Company</Button></Link>
          <Link href="/crm/opportunities"><Button size="sm" variant="outline" className="gap-2"><Target className="h-3.5 w-3.5" /> Opportunity</Button></Link>
        </div>
      ) : null}
    </div>
  );
}

export default function FollowUpsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const today = todayDateKey();

  const { data, isLoading } = useQuery({
    queryKey: ['crm-followups', typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      params.set('page_size', '200');
      const res = await API(`/follow-ups/?${params.toString()}`);
      return res.json();
    },
  });

  const followUps = Array.isArray(data) ? data : data?.results ?? [];

  const queues = useMemo(() => {
    const ordered = sortAsc(followUps);
    const overdue = ordered.filter((item) => toDateKey(item.date) < today);
    const dueToday = ordered.filter((item) => toDateKey(item.date) === today);
    const upcoming = ordered.filter((item) => toDateKey(item.date) > today);
    const recent = [...followUps].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8);
    return {
      overdue,
      today: dueToday,
      upcoming,
      recent,
    };
  }, [followUps, today]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground mt-1">Track overdue work, today’s follow-ups, upcoming touchpoints, and recent activity.</p>
        </div>
        <LogFollowUpDialog />
      </div>

      <section className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Follow-up Overview
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Keep customer follow-ups clear and on time.</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Separate what is late, what is due today, and what is coming next so important customer work does not get lost.
            </p>
          </div>
          <div className="min-w-[340px] space-y-3">
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value) => value && setViewMode(value as 'board' | 'list')}
              className="justify-start rounded-xl border bg-muted/30 p-1"
            >
              <ToggleGroupItem value="board" className="gap-2">
                <KanbanSquare className="h-4 w-4" />
                Board
              </ToggleGroupItem>
              <ToggleGroupItem value="list" className="gap-2">
                <Rows3 className="h-4 w-4" />
                List
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border bg-muted/20 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Overdue</div>
                <div className="mt-2 text-2xl font-semibold">{queues.overdue.length}</div>
              </div>
              <div className="rounded-2xl border bg-muted/20 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Due Today</div>
                <div className="mt-2 text-2xl font-semibold">{queues.today.length}</div>
              </div>
              <div className="rounded-2xl border bg-muted/20 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Upcoming</div>
                <div className="mt-2 text-2xl font-semibold">{queues.upcoming.length}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTypeFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${!typeFilter ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}
        >All</button>
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(typeFilter === t.value ? '' : t.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${typeFilter === t.value ? 'bg-primary text-primary-foreground border-primary' : `${TYPE_COLORS[t.value]} border hover:opacity-80`}`}
          >
            {TYPE_ICONS[t.value]}{t.label}
          </button>
        ))}
      </div>

      {viewMode === 'board' ? (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Follow-up Board</div>
            <div className="mt-1 text-lg font-semibold">Work grouped by urgency</div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex min-w-max gap-4">
              <QueueCard
                title="Overdue"
                subtitle="Past due items"
                items={queues.overdue}
                emptyLabel="No overdue follow-ups right now."
                accent="bg-rose-100 text-rose-700"
              />
              <QueueCard
                title="Due Today"
                subtitle={formatLongDate(today)}
                items={queues.today}
                emptyLabel="Nothing due today."
                accent="bg-amber-100 text-amber-700"
              />
              <QueueCard
                title="Upcoming"
                subtitle="Next scheduled touchpoints"
                items={queues.upcoming.slice(0, 8)}
                emptyLabel="No upcoming follow-ups scheduled."
                accent="bg-emerald-100 text-emerald-700"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Summary</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Opportunity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading follow-ups…</TableCell></TableRow>
              ) : followUps.length ? followUps.map((activity: any) => (
                <TableRow key={activity.id} className="hover:bg-muted/20">
                  <TableCell>
                    <div className="font-medium">{activity.summary}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">CRM-ACT-{activity.id}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{activity.type_display || activity.type}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{activity.contact_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{activity.organisation_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{activity.lead_title || '—'}</TableCell>
                  <TableCell>
                    {toDateKey(activity.date) < today ? (
                      <span className="text-xs font-medium text-rose-700">Overdue</span>
                    ) : toDateKey(activity.date) === today ? (
                      <span className="text-xs font-medium text-amber-700">Due today</span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-700">Upcoming</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(activity.date).date}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-16 text-center text-sm text-muted-foreground">No follow-ups logged yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Recent Timeline</div>
              <div className="mt-1 text-lg font-semibold">Latest logged interactions</div>
            </div>
            <div className="text-xs text-muted-foreground">Most recent 8 entries</div>
          </div>
          <div className="mt-4 space-y-3">
            {isLoading ? (
              <div className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading follow-ups…</div>
            ) : queues.recent.length ? (
              queues.recent.map((activity: any) => <FollowUpCard key={activity.id} activity={activity} />)
            ) : (
              <div className="text-center py-16 text-sm text-muted-foreground">No follow-ups logged yet.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LogFollowUpDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [form, setForm] = useState({ type: 'call', summary: '', date: localIso, contact: '', lead: '', organisation: '' });

  const { data: orgsData } = useQuery({ queryKey: ['crm-companies-picker'], queryFn: () => API('/companies/?page_size=200').then(r => r.json()), enabled: open });
  const { data: peopleData } = useQuery({ queryKey: ['crm-people-picker', ''], queryFn: () => API('/people/?page_size=200').then(r => r.json()), enabled: open });
  const { data: oppsData } = useQuery({ queryKey: ['crm-opps-picker'], queryFn: () => API('/opportunities/?page_size=200').then(r => r.json()), enabled: open });

  const orgs = Array.isArray(orgsData) ? orgsData : orgsData?.results ?? [];
  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];
  const opps = Array.isArray(oppsData) ? oppsData : oppsData?.results ?? [];

  const save = useMutation({
    mutationFn: async () => {
      const body: any = { type: form.type, summary: form.summary, date: form.date };
      if (form.contact) body.contact = parseInt(form.contact, 10);
      if (form.lead) body.lead = parseInt(form.lead, 10);
      if (form.organisation) body.organisation = parseInt(form.organisation, 10);
      const res = await API('/follow-ups/', { method: 'POST', body: JSON.stringify(body) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Could not save follow-up');
      return payload;
    },
    onSuccess: () => {
      toast({ title: 'Follow-up logged' });
      qc.invalidateQueries({ queryKey: ['crm-followups'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      setOpen(false);
      setForm({ type: 'call', summary: '', date: localIso, contact: '', lead: '', organisation: '' });
    },
    onError: () => toast({ title: 'Could not save', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Log Follow-up</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle className="font-bold uppercase tracking-widest">Log a Follow-up</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Type</label>
            <div className="flex rounded-md overflow-hidden border border-border">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, type: t.value }))}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-colors flex items-center justify-center gap-1 ${form.type === t.value ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  {TYPE_ICONS[t.value]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">{TYPES.find((t) => t.value === form.type)?.label}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Summary *</label>
            <Input value={form.summary} onChange={e => setForm((p) => ({ ...p, summary: e.target.value }))} placeholder="What happened or what needs to be done?" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Date & Time</label>
            <Input type="datetime-local" value={form.date} onChange={e => setForm((p) => ({ ...p, date: e.target.value }))} className="font-mono text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company</label>
              <Select value={form.organisation} onValueChange={v => setForm((p) => ({ ...p, organisation: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{orgs.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Person</label>
              <Select value={form.contact} onValueChange={v => setForm((p) => ({ ...p, contact: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{people.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opportunity</label>
            <Select value={form.lead} onValueChange={v => setForm((p) => ({ ...p, lead: v }))}>
              <SelectTrigger><SelectValue placeholder="Link to an opportunity (optional)" /></SelectTrigger>
              <SelectContent>{opps.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => save.mutate()} className="w-full font-bold uppercase tracking-widest" disabled={!form.summary || save.isPending}>
            {save.isPending ? 'Saving…' : 'Log Follow-up'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
