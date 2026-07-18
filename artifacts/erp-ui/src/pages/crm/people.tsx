import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Mail, Phone, User } from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

export default function PeoplePage() {
  const [search, setSearch] = useState('');

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">People</h1>
          <p className="text-sm text-muted-foreground mt-1">Individual contacts at your companies and prospects</p>
        </div>
        <AddPersonDialog organisations={orgs} />
      </div>

      <div className="flex items-center gap-2 max-w-sm bg-card border rounded-lg px-3 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          placeholder="Search people…"
          value={search} onChange={e => setSearch(e.target.value)}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading people…</TableCell></TableRow>
            ) : people.length ? people.map((p: any) => (
              <TableRow key={p.id} className="hover:bg-muted/30 transition-colors">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary">{(p.first_name?.[0] ?? '?')}{(p.last_name?.[0] ?? '')}</span>
                    </div>
                    <span className="font-semibold">{p.full_name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.job_title || '—'}</TableCell>
                <TableCell className="text-sm font-medium">{p.organisation_name || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {p.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{p.email}</div>}
                    {p.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono"><Phone className="h-3 w-3" />{p.phone}</div>}
                  </div>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={4} className="text-center py-16 text-sm text-muted-foreground">No people yet. Add your first contact.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddPersonDialog({ organisations }: { organisations: any[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ first_name: '', last_name: '', job_title: '', email: '', phone: '', organisation: '' });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...form };
      if (!body.organisation) delete body.organisation;
      else body.organisation = parseInt(body.organisation, 10);
      return API('/people/', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: 'Person added' });
      qc.invalidateQueries({ queryKey: ['crm-people'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
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
