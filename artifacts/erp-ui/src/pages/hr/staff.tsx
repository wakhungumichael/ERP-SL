import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Users, Search, UserPlus, Shield, DollarSign, Calendar,
  CheckCircle2, Clock, Plus, ChevronRight, Pencil,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────── helpers ── */
const ROLE_COLORS: Record<string, string> = {
  superadmin:   'bg-red-100 text-red-800 border-red-200',
  tenant_admin: 'bg-blue-100 text-blue-800 border-blue-200',
  finance:      'bg-emerald-100 text-emerald-800 border-emerald-200',
  operator:     'bg-orange-100 text-orange-800 border-orange-200',
};

const STATUS_STYLES: Record<string, string> = {
  Draft:      'bg-secondary text-secondary-foreground',
  Processing: 'bg-amber-100 text-amber-800',
  Completed:  'bg-emerald-100 text-emerald-800',
};

function kes(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

/* ────────────────────────────────────────────────── PayPeriod dialog ── */
interface NewPeriodDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string | null;
  onSuccess: () => void;
}

function NewPeriodDialog({ open, onOpenChange, token, onSuccess }: NewPeriodDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '', period_start: '', period_end: '', status: 'Draft', notes: '', auto_populate: true,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name || !form.period_start || !form.period_end) {
      toast({ title: 'Required fields missing', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/hr/pay-periods/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      toast({ title: 'Pay period created' });
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Pay Period</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Period Name *</Label>
            <Input placeholder="e.g. July 2026" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Date *</Label>
              <Input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date *</Label>
              <Input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea placeholder="Optional notes…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="h-20" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={form.auto_populate} onChange={e => setForm(f => ({ ...f, auto_populate: e.target.checked }))} className="rounded" />
            Auto-create pay records for all active staff
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Create Period'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────── PayRecord edit dialog ── */
interface EditRecordDialogProps {
  record: any;
  periodId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string | null;
  onSuccess: () => void;
}

function EditRecordDialog({ record, periodId, open, onOpenChange, token, onSuccess }: EditRecordDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    basic_pay: String(record?.basic_pay ?? ''),
    allowances: String(record?.allowances ?? ''),
    deductions: String(record?.deductions ?? ''),
    net_pay: String(record?.net_pay ?? ''),
    notes: record?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  // Auto-calc net
  const calcNet = () => {
    const net = Number(form.basic_pay || 0) + Number(form.allowances || 0) - Number(form.deductions || 0);
    setForm(f => ({ ...f, net_pay: String(net) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/pay-periods/${periodId}/records/${record.id}/`, {
        method: 'PATCH',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basic_pay:  Number(form.basic_pay  || 0),
          allowances: Number(form.allowances || 0),
          deductions: Number(form.deductions || 0),
          net_pay:    Number(form.net_pay    || 0),
          notes: form.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      toast({ title: 'Pay record updated' });
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const f = (field: 'basic_pay' | 'allowances' | 'deductions' | 'net_pay', label: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number" min="0" step="0.01"
        value={form[field]}
        onChange={e => { setForm(prev => ({ ...prev, [field]: e.target.value })); }}
        onBlur={calcNet}
        className="font-mono"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Pay — {record?.employee_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {f('basic_pay',  'Basic Pay (KES)')}
          {f('allowances', 'Allowances (KES)')}
          {f('deductions', 'Deductions (KES)')}
          {f('net_pay',    'Net Pay (KES)')}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-16" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────── PayPeriod detail ── */
function PayPeriodDetail({ periodId, token }: { periodId: number; token: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editRecord, setEditRecord] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hr-period-detail', periodId],
    queryFn: async () => {
      const res = await fetch(`/api/hr/pay-periods/${periodId}/`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && !!periodId,
    staleTime: 10_000,
  });

  const updateStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/hr/pay-periods/${periodId}/`, {
        method: 'PATCH',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      toast({ title: `Period marked ${newStatus}` });
      qc.invalidateQueries({ queryKey: ['hr-period-detail', periodId] });
      qc.invalidateQueries({ queryKey: ['hr-pay-periods'] });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!data) return null;

  const records: any[] = data.records ?? [];
  const totalNet = records.reduce((s: number, r: any) => s + Number(r.net_pay), 0);
  const canProcess = data.status === 'Draft';
  const canComplete = data.status === 'Processing';

  return (
    <div className="space-y-4">
      {/* Period header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold text-base">{data.name}</div>
          <div className="text-xs text-muted-foreground">{data.period_start} → {data.period_end}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_STYLES[data.status] ?? ''}>{data.status}</Badge>
          {canProcess && (
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => updateStatus('Processing')}>
              <Clock className="h-3 w-3" /> Mark Processing
            </Button>
          )}
          {canComplete && (
            <Button size="sm" className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateStatus('Completed')}>
              <CheckCircle2 className="h-3 w-3" /> Complete Payroll
            </Button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Gross', value: kes(records.reduce((s: number, r: any) => s + Number(r.basic_pay) + Number(r.allowances), 0)) },
          { label: 'Total Deductions', value: kes(records.reduce((s: number, r: any) => s + Number(r.deductions), 0)) },
          { label: 'Total Net Pay', value: kes(totalNet), bold: true },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={`text-base font-mono ${s.bold ? 'font-bold text-primary' : ''}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Records table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Pay Records — {records.length} employees
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Employee</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Basic</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Allow.</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Deduct.</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Net Pay</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">No pay records yet.</TableCell></TableRow>
              ) : records.map((r: any) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="py-2">
                    <div className="font-medium text-sm">{r.employee_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.employee_username}</div>
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs">{kes(r.basic_pay)}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs text-emerald-700">{kes(r.allowances)}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs text-red-600">{kes(r.deductions)}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm font-bold">{kes(r.net_pay)}</TableCell>
                  <TableCell className="py-2 text-right">
                    {data.status !== 'Completed' && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditRecord(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editRecord && (
        <EditRecordDialog
          record={editRecord}
          periodId={periodId}
          open={!!editRecord}
          onOpenChange={v => { if (!v) setEditRecord(null); }}
          token={token}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['hr-period-detail', periodId] });
            qc.invalidateQueries({ queryKey: ['hr-pay-periods'] });
          }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ main ── */
export default function HRStaff() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'staff' | 'payroll'>('staff');
  const [search, setSearch] = useState('');
  const [newPeriodOpen, setNewPeriodOpen] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);

  /* Staff query */
  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['platform-users', search],
    queryFn: async () => {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/platform/users/${qs}`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && tab === 'staff',
    staleTime: 30_000,
  });

  /* Payroll periods query */
  const { data: periodsData, isLoading: periodsLoading } = useQuery({
    queryKey: ['hr-pay-periods'],
    queryFn: async () => {
      const res = await fetch('/api/hr/pay-periods/', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && tab === 'payroll',
    staleTime: 20_000,
  });

  /* HR dashboard */
  const { data: dashData } = useQuery({
    queryKey: ['hr-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/hr/dashboard/', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const staffRows: any[] = staffData?.results ?? staffData ?? [];
  const staffTotal = staffData?.count ?? staffRows.length;
  const periods: any[] = periodsData?.results ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Human Resources
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Staff directory and payroll management
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'staff' && (
            <Button size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs" asChild>
              <a href="/platform/users"><UserPlus className="h-3.5 w-3.5" /> Manage Users</a>
            </Button>
          )}
          {tab === 'payroll' && !selectedPeriodId && (
            <Button size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs" onClick={() => setNewPeriodOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New Pay Period
            </Button>
          )}
          {tab === 'payroll' && selectedPeriodId && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setSelectedPeriodId(null)}>
              ← All Periods
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Staff',   value: dashData?.staff?.total   ?? '—', icon: <Users className="h-4 w-4" /> },
          { label: 'Active',        value: dashData?.staff?.active   ?? '—', icon: <CheckCircle2 className="h-4 w-4" /> },
          { label: 'Pay Periods',   value: dashData?.payroll?.total_periods     ?? '—', icon: <Calendar className="h-4 w-4" /> },
          { label: 'Completed',     value: dashData?.payroll?.completed_periods ?? '—', icon: <DollarSign className="h-4 w-4" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-muted/60 text-primary">{s.icon}</div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                <p className="text-xl font-bold font-mono">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={v => { setTab(v as 'staff' | 'payroll'); setSelectedPeriodId(null); }}>
        <TabsList>
          <TabsTrigger value="staff"><Users className="h-3.5 w-3.5 mr-1.5" />Staff Directory</TabsTrigger>
          <TabsTrigger value="payroll"><DollarSign className="h-3.5 w-3.5 mr-1.5" />Payroll</TabsTrigger>
        </TabsList>

        {/* ── Staff tab ── */}
        <TabsContent value="staff" className="mt-4 space-y-4">
          <div className="bg-card border rounded-lg px-4 py-2 flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0 text-sm h-8" />
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                {staffTotal > 0 ? `${staffTotal} Staff Member${staffTotal !== 1 ? 's' : ''}` : 'Staff Members'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Name</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Username</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Email</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Role / Groups</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/60 rounded animate-pulse" /></TableCell>
                      ))}</TableRow>
                    ))
                  ) : staffRows.length ? staffRows.map((u: any) => {
                    const groups: string[] = (u.groups || []).map((g: any) => g.name ?? g);
                    const isAdmin = u.is_superuser || u.is_staff;
                    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30">
                        <TableCell className="py-2.5 font-medium text-sm">{fullName}</TableCell>
                        <TableCell className="py-2.5 font-mono text-xs">{u.username}</TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground">{u.email || '—'}</TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {isAdmin && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS['superadmin']}`}>
                                {u.is_superuser ? 'Superadmin' : 'Staff'}
                              </span>
                            )}
                            {groups.map(g => (
                              <span key={g} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[g.toLowerCase().replace(/[^a-z]/g, '_')] ?? 'bg-secondary border-border'}`}>{g}</span>
                            ))}
                            {!isAdmin && groups.length === 0 && <span className="text-xs text-muted-foreground">No group</span>}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-center">
                          <Badge variant={u.is_active !== false ? 'default' : 'secondary'} className="text-[10px]">
                            {u.is_active !== false ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-sm text-muted-foreground">No staff members found.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payroll tab ── */}
        <TabsContent value="payroll" className="mt-4">
          {selectedPeriodId ? (
            <PayPeriodDetail periodId={selectedPeriodId} token={token} />
          ) : (
            <div className="space-y-3">
              {periodsLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Loading pay periods…</div>
              ) : periods.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center space-y-3">
                    <DollarSign className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No pay periods yet. Create one to start processing payroll.</p>
                    <Button size="sm" onClick={() => setNewPeriodOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Create First Pay Period
                    </Button>
                  </CardContent>
                </Card>
              ) : periods.map((p: any) => (
                <Card key={p.id} className="hover:border-primary/40 cursor-pointer transition-colors" onClick={() => setSelectedPeriodId(p.id)}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${p.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' : p.status === 'Processing' ? 'bg-amber-100 text-amber-700' : 'bg-muted/60 text-muted-foreground'}`}>
                        <DollarSign className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-bold text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.period_start} → {p.period_end} · {p.record_count} employees</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-mono font-bold text-sm">{kes(p.total_net)}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Net</div>
                      </div>
                      <Badge className={STATUS_STYLES[p.status] ?? ''}>{p.status}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <NewPeriodDialog
        open={newPeriodOpen}
        onOpenChange={setNewPeriodOpen}
        token={token}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['hr-pay-periods'] })}
      />
    </div>
  );
}
