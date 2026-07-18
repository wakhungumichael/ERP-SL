import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Building2, Globe, Mail, Phone } from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const TYPE_BADGE: Record<string, string> = {
  customer: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
  prospect: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400',
  partner:  'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400',
  other:    'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400',
};

export default function CompaniesPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-companies', search, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      const res = await API(`/companies/?${params}`);
      return res.json();
    },
  });

  const companies = Array.isArray(data) ? data : data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1">All businesses you work with — customers, prospects, and partners</p>
        </div>
        <AddCompanyDialog />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-card p-3 rounded-lg border shadow-sm">
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search companies…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="h-8 border-0 shadow-none focus-visible:ring-0 text-sm"
          />
        </div>
        <div className="w-px h-6 bg-border" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 border-0 shadow-none w-36 text-sm">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Types</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Company Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-center">People</TableHead>
              <TableHead className="text-center">Open Deals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading companies…</TableCell></TableRow>
            ) : companies.length ? companies.map((c: any) => (
              <TableRow key={c.id} className="hover:bg-muted/30 transition-colors">
                <TableCell>
                  <Link href={`/crm/companies/${c.id}`} className="font-bold hover:underline text-primary flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {c.name}
                  </Link>
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 hover:underline">
                      <Globe className="h-3 w-3" /> {c.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${TYPE_BADGE[c.type] ?? TYPE_BADGE.other}`}>
                    {c.type}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.industry || '—'}</TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {c.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</div>}
                    {c.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono"><Phone className="h-3 w-3" />{c.phone}</div>}
                  </div>
                </TableCell>
                <TableCell className="text-center font-mono font-bold">{c.contact_count}</TableCell>
                <TableCell className="text-center">
                  {c.open_leads > 0
                    ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary">{c.open_leads}</span>
                    : <span className="text-muted-foreground text-xs">—</span>}
                </TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={6} className="text-center py-16 text-sm text-muted-foreground">No companies yet. Add your first one.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddCompanyDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', type: 'customer', industry: '', email: '', phone: '', website: '', address: '' });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => API('/companies/', { method: 'POST', body: JSON.stringify(form) }).then(r => r.json()),
    onSuccess: () => { toast({ title: 'Company added' }); qc.invalidateQueries({ queryKey: ['crm-companies'] }); qc.invalidateQueries({ queryKey: ['crm-dashboard'] }); setOpen(false); setForm({ name: '', type: 'customer', industry: '', email: '', phone: '', website: '', address: '' }); },
    onError: () => toast({ title: 'Could not save company', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Add Company</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle className="font-bold uppercase tracking-widest">New Company</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company Name *</label>
            <Input value={form.name} onChange={f('name')} placeholder="Acme Logistics Ltd." className="font-medium" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Relationship Type</label>
              <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Industry</label>
              <Input value={form.industry} onChange={f('industry')} placeholder="e.g. Logistics" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={f('email')} placeholder="info@company.com" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Phone</label>
              <Input value={form.phone} onChange={f('phone')} placeholder="+254 700 000 000" className="font-mono text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Website</label>
            <Input value={form.website} onChange={f('website')} placeholder="https://company.com" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Address</label>
            <Input value={form.address} onChange={f('address')} placeholder="Physical address" />
          </div>
          <Button onClick={() => save.mutate()} className="w-full font-bold uppercase tracking-widest" disabled={!form.name || save.isPending}>
            {save.isPending ? 'Saving…' : 'Add Company'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
