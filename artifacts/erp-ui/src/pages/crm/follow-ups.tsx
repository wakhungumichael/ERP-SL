import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Phone, Mail, Calendar, MessageSquare, CheckCircle2 } from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  call:    <Phone className="h-4 w-4" />,
  email:   <Mail className="h-4 w-4" />,
  meeting: <Calendar className="h-4 w-4" />,
  note:    <MessageSquare className="h-4 w-4" />,
  task:    <CheckCircle2 className="h-4 w-4" />,
};

const TYPE_COLORS: Record<string, string> = {
  call:    'bg-blue-100 text-blue-800 border-blue-200',
  email:   'bg-indigo-100 text-indigo-800 border-indigo-200',
  meeting: 'bg-purple-100 text-purple-800 border-purple-200',
  note:    'bg-amber-100 text-amber-800 border-amber-200',
  task:    'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const TYPES = [
  { value: 'call', label: 'Phone Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
  { value: 'task', label: 'Task' },
];

export default function FollowUpsPage() {
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-followups', typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      const res = await API(`/follow-ups/?${params}&page_size=50`);
      return res.json();
    },
  });

  const followUps = Array.isArray(data) ? data : data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground mt-1">Every call, email, meeting, and note logged with your contacts</p>
        </div>
        <LogFollowUpDialog />
      </div>

      {/* Type filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTypeFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${!typeFilter ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}
        >All</button>
        {TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(typeFilter === t.value ? '' : t.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${typeFilter === t.value ? 'bg-primary text-primary-foreground border-primary' : `${TYPE_COLORS[t.value]} border hover:opacity-80`}`}
          >
            {TYPE_ICONS[t.value]}{t.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading follow-ups…</div>
      ) : followUps.length ? (
        <div className="relative space-y-4">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
          {followUps.map((a: any) => (
            <div key={a.id} className="relative flex gap-4 ml-0">
              <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-background shadow-sm ${TYPE_COLORS[a.type] ?? 'bg-secondary'}`}>
                {TYPE_ICONS[a.type] ?? <MessageSquare className="h-4 w-4" />}
              </div>
              <div className="flex-1 bg-card rounded-lg border shadow-sm p-4 mb-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{a.summary}</p>
                    <div className="flex flex-wrap gap-3 mt-1.5">
                      {a.contact_name && <span className="text-xs text-muted-foreground">👤 {a.contact_name}</span>}
                      {a.organisation_name && <span className="text-xs text-muted-foreground">🏢 {a.organisation_name}</span>}
                      {a.lead_title && <span className="text-xs text-muted-foreground">🎯 {a.lead_title}</span>}
                      {a.created_by_name && <span className="text-xs text-muted-foreground">By {a.created_by_name}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono text-muted-foreground">{new Date(a.date).toLocaleDateString()}</div>
                    <div className="text-[10px] text-muted-foreground">{new Date(a.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-sm text-muted-foreground">No follow-ups logged yet.</div>
      )}
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

  const orgs   = Array.isArray(orgsData)   ? orgsData   : orgsData?.results   ?? [];
  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];
  const opps   = Array.isArray(oppsData)   ? oppsData   : oppsData?.results   ?? [];

  const save = useMutation({
    mutationFn: () => {
      const body: any = { type: form.type, summary: form.summary, date: form.date };
      if (form.contact)      body.contact      = parseInt(form.contact, 10);
      if (form.lead)         body.lead         = parseInt(form.lead, 10);
      if (form.organisation) body.organisation = parseInt(form.organisation, 10);
      return API('/follow-ups/', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
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
          {/* Type toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Type</label>
            <div className="flex rounded-md overflow-hidden border border-border">
              {TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => setForm(p => ({ ...p, type: t.value }))}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-colors flex items-center justify-center gap-1 ${form.type === t.value ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  {TYPE_ICONS[t.value]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">{TYPES.find(t => t.value === form.type)?.label}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Summary *</label>
            <Input value={form.summary} onChange={e => setForm(p => ({ ...p, summary: e.target.value }))} placeholder="What happened or what needs to be done?" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Date & Time</label>
            <Input type="datetime-local" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="font-mono text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company</label>
              <Select value={form.organisation} onValueChange={v => setForm(p => ({ ...p, organisation: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{orgs.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Person</label>
              <Select value={form.contact} onValueChange={v => setForm(p => ({ ...p, contact: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{people.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opportunity</label>
            <Select value={form.lead} onValueChange={v => setForm(p => ({ ...p, lead: v }))}>
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
