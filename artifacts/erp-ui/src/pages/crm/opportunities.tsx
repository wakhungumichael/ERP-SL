import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus, TrendingUp } from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const STAGE_STYLES: Record<string, { badge: string; bar: string; label: string }> = {
  new:         { badge: 'bg-slate-100 text-slate-700 border-slate-300',          bar: 'bg-slate-400',   label: 'New' },
  contacted:   { badge: 'bg-blue-100 text-blue-800 border-blue-300',             bar: 'bg-blue-500',    label: 'Contacted' },
  proposal:    { badge: 'bg-purple-100 text-purple-800 border-purple-300',       bar: 'bg-purple-500',  label: 'Proposal Sent' },
  negotiation: { badge: 'bg-orange-100 text-orange-800 border-orange-300',       bar: 'bg-orange-500',  label: 'Negotiating' },
  won:         { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',    bar: 'bg-emerald-500', label: 'Won' },
  lost:        { badge: 'bg-red-100 text-red-800 border-red-300',                bar: 'bg-red-400',     label: 'Lost' },
};

const STAGES = Object.entries(STAGE_STYLES).map(([k, v]) => ({ value: k, label: v.label }));

export default function OpportunitiesPage() {
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-opps', stageFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stageFilter) params.set('stage', stageFilter);
      if (search) params.set('search', search);
      const res = await API(`/opportunities/?${params}`);
      return res.json();
    },
  });

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline-summary'],
    queryFn: () => API('/opportunities/pipeline-summary/').then(r => r.json()),
  });

  const opps = Array.isArray(data) ? data : data?.results ?? [];
  const pipeline: any[] = pipelineData?.pipeline ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Opportunities</h1>
          <p className="text-sm text-muted-foreground mt-1">Track your sales deals from first contact to closed</p>
        </div>
        <AddOpportunityDialog />
      </div>

      {/* Pipeline summary bar */}
      {pipeline.length > 0 && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {pipeline.map((s: any) => {
            const style = STAGE_STYLES[s.stage];
            return (
              <button
                key={s.stage}
                onClick={() => setStageFilter(stageFilter === s.stage ? '' : s.stage)}
                className={`p-3 rounded-lg border text-left transition-all shadow-sm hover:shadow-md ${stageFilter === s.stage ? 'ring-2 ring-primary ring-offset-1' : ''} bg-card`}
              >
                <div className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${STAGE_STYLES[s.stage]?.badge.split(' ').find(c => c.startsWith('text-')) ?? 'text-muted-foreground'}`}>{s.label}</div>
                <div className="text-xl font-black">{s.count}</div>
                {s.total_value > 0 && <div className="text-[10px] font-mono text-muted-foreground mt-0.5">KES {s.total_value.toLocaleString()}</div>}
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center bg-card p-3 rounded-lg border shadow-sm">
        <Input
          placeholder="Search opportunities…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="h-8 border-0 shadow-none focus-visible:ring-0 text-sm flex-1"
        />
        {stageFilter && (
          <button onClick={() => setStageFilter('')} className="text-xs text-primary hover:underline font-medium">
            Clear filter
          </button>
        )}
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Opportunity</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Estimated Value</TableHead>
              <TableHead>Expected Close</TableHead>
              <TableHead>Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading opportunities…</TableCell></TableRow>
            ) : opps.length ? opps.map((o: any) => {
              const style = STAGE_STYLES[o.stage];
              return (
                <TableRow key={o.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-semibold">{o.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.organisation_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.contact_name || '—'}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${style?.badge ?? 'bg-secondary border-border'}`}>
                      {style?.label ?? o.stage}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">
                    {o.value ? `${o.currency} ${parseFloat(o.value).toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{o.expected_close_date || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.assigned_to_name || '—'}</TableCell>
                </TableRow>
              );
            }) : (
              <TableRow><TableCell colSpan={7} className="text-center py-16 text-sm text-muted-foreground">No opportunities found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddOpportunityDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '', organisation: '', contact: '', stage: 'new',
    value: '', currency: 'KES', expected_close_date: '', notes: '',
  });

  const { data: orgsData } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: () => API('/companies/?page_size=200').then(r => r.json()),
    enabled: open,
  });
  const orgs = Array.isArray(orgsData) ? orgsData : orgsData?.results ?? [];

  const { data: peopleData } = useQuery({
    queryKey: ['crm-people-picker', form.organisation],
    queryFn: () => {
      const params = form.organisation ? `?organisation=${form.organisation}` : '';
      return API(`/people/${params}&page_size=200`).then(r => r.json());
    },
    enabled: open,
  });
  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];

  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...form };
      if (body.organisation) body.organisation = parseInt(body.organisation, 10); else delete body.organisation;
      if (body.contact) body.contact = parseInt(body.contact, 10); else delete body.contact;
      if (!body.value) delete body.value;
      if (!body.expected_close_date) delete body.expected_close_date;
      return API('/opportunities/', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: 'Opportunity added' });
      qc.invalidateQueries({ queryKey: ['crm-opps'] });
      qc.invalidateQueries({ queryKey: ['crm-pipeline-summary'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      setOpen(false);
      setForm({ title: '', organisation: '', contact: '', stage: 'new', value: '', currency: 'KES', expected_close_date: '', notes: '' });
    },
    onError: () => toast({ title: 'Could not save', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Add Opportunity</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-bold uppercase tracking-widest">New Opportunity</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opportunity Title *</label>
            <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Bulk haulage contract with Acme" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company</label>
              <Select value={form.organisation} onValueChange={v => setForm(p => ({ ...p, organisation: v, contact: '' }))}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{orgs.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Person</label>
              <Select value={form.contact} onValueChange={v => setForm(p => ({ ...p, contact: v }))} disabled={!form.organisation}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>{people.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Stage</label>
            <Select value={form.stage} onValueChange={v => setForm(p => ({ ...p, stage: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Estimated Value</label>
              <Input type="number" min={0} value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} placeholder="0" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Currency</label>
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="KES">KES</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Expected Close Date</label>
            <Input type="date" value={form.expected_close_date} onChange={e => setForm(p => ({ ...p, expected_close_date: e.target.value }))} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</label>
            <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Additional context…" />
          </div>
          <Button onClick={() => save.mutate()} className="w-full font-bold uppercase tracking-widest" disabled={!form.title || save.isPending}>
            {save.isPending ? 'Saving…' : 'Add Opportunity'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
