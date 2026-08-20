import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Mail,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const STAGE_BADGE: Record<string, string> = {
  new: 'bg-slate-100 text-slate-700 border-slate-300',
  contacted: 'bg-blue-100 text-blue-800 border-blue-300',
  proposal: 'bg-purple-100 text-purple-800 border-purple-300',
  negotiation: 'bg-orange-100 text-orange-800 border-orange-300',
  won: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  lost: 'bg-red-100 text-red-800 border-red-300',
};

function formatMoney(value: string | number | null | undefined, currency = 'KES') {
  const amount = value == null ? 0 : Number(value);
  return `${currency} ${amount.toLocaleString()}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString();
}

type Person = {
  id: number;
  first_name: string;
  last_name?: string;
  full_name: string;
  job_title?: string;
  email?: string;
  phone?: string;
  organisation?: number | null;
  organisation_name?: string;
  notes?: string;
};

export default function PeoplePage() {
  const [search, setSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-people', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await API(`/people/?${params}`);
      return res.json();
    },
  });

  const { data: orgsData } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: async () => {
      const res = await API('/companies/?page_size=200');
      return res.json();
    },
  });

  const people = Array.isArray(data) ? data : data?.results ?? [];
  const orgs = Array.isArray(orgsData) ? orgsData : orgsData?.results ?? [];

  useEffect(() => {
    if (!selectedPerson) return;
    const fresh = people.find((person: Person) => person.id === selectedPerson.id);
    if (fresh) setSelectedPerson(fresh);
  }, [people, selectedPerson]);

  const summary = useMemo(() => ({
    total: people.length,
    linkedCompanies: new Set(people.map((person: Person) => person.organisation).filter(Boolean)).size,
    withEmail: people.filter((person: Person) => !!person.email).length,
    withPhone: people.filter((person: Person) => !!person.phone).length,
  }), [people]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">People</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage customer contacts, key decision-makers, and day-to-day business relationships.</p>
        </div>
        <AddPersonDialog organisations={orgs} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Visible Contacts</div><div className="mt-2 text-2xl font-semibold">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Linked Companies</div><div className="mt-2 text-2xl font-semibold text-sky-600">{summary.linkedCompanies}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">With Email</div><div className="mt-2 text-2xl font-semibold text-violet-600">{summary.withEmail}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">With Phone</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{summary.withPhone}</div></CardContent></Card>
      </div>

      <div className="flex items-center gap-2 max-w-sm bg-card border rounded-lg px-3 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          placeholder="Search contacts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 border-0 shadow-none focus-visible:ring-0 text-sm"
        />
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact Details</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading people…</TableCell></TableRow>
            ) : people.length ? people.map((person: Person) => (
              <TableRow key={person.id} className="hover:bg-muted/30 transition-colors">
                <TableCell>
                  <button onClick={() => setSelectedPerson(person)} className="text-left">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{(person.first_name?.[0] ?? '?')}{(person.last_name?.[0] ?? '')}</span>
                      </div>
                      <div>
                        <div className="font-semibold text-primary hover:underline">{person.full_name}</div>
                        <div className="text-xs text-muted-foreground">View contact details</div>
                      </div>
                    </div>
                  </button>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{person.job_title || '—'}</TableCell>
                <TableCell className="text-sm font-medium">{person.organisation_name || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {person.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{person.email}</div>}
                    {person.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono"><Phone className="h-3 w-3" />{person.phone}</div>}
                  </div>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setSelectedPerson(person)}>View Details</Button>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={5} className="text-center py-16 text-sm text-muted-foreground">No people yet. Add your first contact.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PersonWorkspaceSheet
        person={selectedPerson}
        open={!!selectedPerson}
        onOpenChange={(open) => { if (!open) setSelectedPerson(null); }}
      />
    </div>
  );
}

function PersonWorkspaceSheet({
  person,
  open,
  onOpenChange,
}: {
  person: Person | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: opportunitiesData, isLoading: loadingOpportunities } = useQuery({
    queryKey: ['crm-person-opportunities', person?.id],
    queryFn: async () => {
      const res = await API(`/opportunities/?contact=${person?.id}&page_size=50`);
      return res.json();
    },
    enabled: open && !!person,
  });

  const { data: activitiesData, isLoading: loadingActivities } = useQuery({
    queryKey: ['crm-person-activities', person?.id],
    queryFn: async () => {
      const res = await API(`/follow-ups/?contact=${person?.id}&page_size=50`);
      return res.json();
    },
    enabled: open && !!person,
  });

  if (!person) return null;

  const opportunities = Array.isArray(opportunitiesData) ? opportunitiesData : opportunitiesData?.results ?? [];
  const activities = Array.isArray(activitiesData) ? activitiesData : activitiesData?.results ?? [];
  const openDeals = opportunities.filter((item: any) => !['won', 'lost'].includes(item.stage));
  const pipelineValue = openDeals.reduce((sum: number, item: any) => sum + Number(item.value ?? 0), 0);
  const overdueActivities = activities.filter((item: any) => new Date(item.date).getTime() < Date.now());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" />
            Contact Details
          </SheetTitle>
          <SheetDescription>
            Review this contact, their deals, and their follow-ups in one clear view.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section className="rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-200">
                  Contact Record
                </div>
                <h2 className="mt-3 text-3xl font-black tracking-tight">{person.full_name}</h2>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-200">
                  <span>{person.job_title || 'No job title'}</span>
                  <span>{person.organisation_name || 'No company linked'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {person.organisation ? (
                  <Link href="/crm/companies">
                    <Button variant="secondary" className="gap-2">
                      <Building2 className="h-4 w-4" />
                      View Company
                    </Button>
                  </Link>
                ) : null}
                <Link href={openDeals.length > 0 ? '/crm/opportunities' : '/crm/follow-ups'}>
                  <Button className="gap-2">
                    <ArrowRight className="h-4 w-4" />
                    {openDeals.length > 0 ? 'Work Deals' : 'Plan Follow-up'}
                  </Button>
                </Link>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Open Deals</div>
                <div className="mt-2 text-2xl font-black">{openDeals.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Pipeline Value</div>
                <div className="mt-2 text-2xl font-black">{formatMoney(pipelineValue)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Follow-ups</div>
                <div className="mt-2 text-2xl font-black">{activities.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Overdue</div>
                <div className="mt-2 text-2xl font-black">{overdueActivities.length}</div>
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Summary</div>
                <div className="mt-4 grid gap-4">
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Channels</div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2"><Mail className="h-4 w-4" /> {person.email || 'No email recorded'}</div>
                      <div className="flex items-center gap-2"><Phone className="h-4 w-4" /> {person.phone || 'No phone recorded'}</div>
                      <div className="flex items-center gap-2"><Building2 className="h-4 w-4" /> {person.organisation_name || 'No company linked'}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</div>
                    <p className="mt-3 text-sm text-muted-foreground">{person.notes || 'No stakeholder notes recorded yet.'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Next Steps</div>
                <div className="mt-4 grid gap-3">
                  <Link href="/crm/follow-ups" className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Keep follow-ups on time</div>
                        <div className="mt-1 text-sm text-muted-foreground">Calls, meetings, and tasks around this person should be visible and timely.</div>
                      </div>
                      <CalendarClock className="h-4 w-4 shrink-0 text-sky-600" />
                    </div>
                  </Link>
                  <Link href="/sales/estimates" className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Move active conversations into quotes</div>
                        <div className="mt-1 text-sm text-muted-foreground">Proposal-stage work should leave the contact note layer and become structured commercial work.</div>
                      </div>
                      <TrendingUp className="h-4 w-4 shrink-0 text-violet-600" />
                    </div>
                  </Link>
                  <Link href="/sales/orders" className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Escalate wins into execution</div>
                        <div className="mt-1 text-sm text-muted-foreground">When this contact helps close a deal, keep the handoff moving into operations.</div>
                      </div>
                      <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                    </div>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Linked Opportunities</div>
                  <div className="mt-1 text-lg font-semibold">Deals where this person matters</div>
                </div>
                <Link href="/crm/opportunities" className="text-sm text-primary hover:underline">Open opportunities</Link>
              </div>
              <div className="mt-4 space-y-3">
                {loadingOpportunities ? <div className="text-sm text-muted-foreground">Loading opportunities…</div> : opportunities.length ? opportunities.slice(0, 8).map((opportunity: any) => (
                  <div key={opportunity.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{opportunity.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{opportunity.organisation_name || 'No company'} • {formatDate(opportunity.expected_close_date)}</div>
                      </div>
                      <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STAGE_BADGE[opportunity.stage] ?? 'bg-secondary border-border'}`}>
                        {opportunity.stage_display || opportunity.stage}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-mono text-muted-foreground">{formatMoney(opportunity.value, opportunity.currency || 'KES')}</div>
                      <Link href={['proposal', 'negotiation'].includes(opportunity.stage) ? '/sales/estimates' : opportunity.stage === 'won' ? '/sales/orders' : '/crm/opportunities'}>
                        <Button size="sm" variant="outline" className="gap-2">
                          <Target className="h-3.5 w-3.5" />
                          Next Step
                        </Button>
                      </Link>
                    </div>
                  </div>
                )) : <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">No opportunities linked to this contact yet.</div>}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Follow-up Timeline</div>
                  <div className="mt-1 text-lg font-semibold">Recent touchpoints and pending accountability</div>
                </div>
                <Link href="/crm/follow-ups" className="text-sm text-primary hover:underline">Open follow-ups</Link>
              </div>
              <div className="mt-4 space-y-3">
                {loadingActivities ? <div className="text-sm text-muted-foreground">Loading follow-ups…</div> : activities.length ? activities.slice(0, 8).map((activity: any) => (
                  <div key={activity.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{activity.summary}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{activity.lead_title || 'No linked opportunity'} • {activity.created_by_name || 'Unknown owner'}</div>
                      </div>
                      <div className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {formatDate(activity.date)}
                      </div>
                    </div>
                  </div>
                )) : <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">No follow-ups logged for this contact yet.</div>}
              </div>
            </CardContent>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddPersonDialog({ organisations }: { organisations: any[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ first_name: '', last_name: '', job_title: '', email: '', phone: '', organisation: '' });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const body: any = { ...form };
      if (!body.organisation) delete body.organisation;
      else body.organisation = parseInt(body.organisation, 10);
      const res = await API('/people/', { method: 'POST', body: JSON.stringify(body) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Could not save person');
      return payload;
    },
    onSuccess: () => {
      toast({ title: 'Person added' });
      qc.invalidateQueries({ queryKey: ['crm-people'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      qc.invalidateQueries({ queryKey: ['crm-companies'] });
      setOpen(false);
      setForm({ first_name: '', last_name: '', job_title: '', email: '', phone: '', organisation: '' });
    },
    onError: () => toast({ title: 'Could not save', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Add Person</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader><DialogTitle className="font-bold uppercase tracking-widest">New Person</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">First Name *</label>
              <Input value={form.first_name} onChange={f('first_name')} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Last Name</label>
              <Input value={form.last_name} onChange={f('last_name')} placeholder="Smith" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Job Title</label>
            <Input value={form.job_title} onChange={f('job_title')} placeholder="Logistics Manager" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company</label>
            <Select value={form.organisation} onValueChange={v => setForm(p => ({ ...p, organisation: v }))}>
              <SelectTrigger><SelectValue placeholder="Select company (optional)" /></SelectTrigger>
              <SelectContent>
                {organisations.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={f('email')} placeholder="jane@company.com" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Phone</label>
              <Input value={form.phone} onChange={f('phone')} placeholder="+254 700 000" className="font-mono text-sm" />
            </div>
          </div>
          <Button onClick={() => save.mutate()} className="w-full font-bold uppercase tracking-widest" disabled={!form.first_name || save.isPending}>
            {save.isPending ? 'Saving…' : 'Add Person'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
