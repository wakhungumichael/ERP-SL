import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/context/use-auth';

type GroupRow = { id: number; name: string };
type RuleRow = {
  id: number;
  name: string;
  cost_center: string;
  min_amount: string;
  max_amount: string | null;
  step_order: number;
  approval_group: number;
  approval_group_name: string;
  is_active: boolean;
};

function currency(value: string | number | null | undefined) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export default function ProcurementApprovalRules() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [form, setForm] = useState({
    name: '',
    cost_center: '',
    min_amount: '0',
    max_amount: '',
    step_order: '1',
    approval_group: '',
  });

  const rulesQuery = useQuery({
    queryKey: ['procurement-approval-matrix'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/procurement/approval-matrix/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load approval rules');
      return res.json();
    },
  });

  const groupsQuery = useQuery({
    queryKey: ['procurement-approval-groups'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/procurement/approval-groups/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load groups');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        min_amount: Number(form.min_amount),
        max_amount: form.max_amount ? Number(form.max_amount) : null,
        step_order: Number(form.step_order),
        approval_group: Number(form.approval_group),
      };
      const res = await fetch('/api/procurement/approval-matrix/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save approval rule');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['procurement-approval-matrix'] });
      setOpen(false);
      setForm({
        name: '',
        cost_center: '',
        min_amount: '0',
        max_amount: '',
        step_order: '1',
        approval_group: '',
      });
    },
  });

  const rules: RuleRow[] = rulesQuery.data?.results ?? [];
  const groups: GroupRow[] = groupsQuery.data?.results ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, RuleRow[]>();
    for (const rule of rules) {
      const key = rule.cost_center || 'All Cost Centers';
      const current = map.get(key) ?? [];
      current.push(rule);
      map.set(key, current);
    }
    return Array.from(map.entries());
  }, [rules]);

  const pagedRules = useMemo(() => {
    const start = (page - 1) * Number(pageSize);
    return rules.slice(start, start + Number(pageSize));
  }, [page, pageSize, rules]);

  const pagedGrouped = useMemo(() => {
    const map = new Map<string, RuleRow[]>();
    for (const rule of pagedRules) {
      const key = rule.cost_center || 'All cost centers';
      const current = map.get(key) ?? [];
      current.push(rule);
      map.set(key, current);
    }
    return Array.from(map.entries());
  }, [pagedRules]);

  const totalPages = Math.max(1, Math.ceil(rules.length / Number(pageSize)));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Approval routing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Decide who approves spending by amount band and, if needed, by cost center.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add route</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New approval route</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Route name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Cost center</Label>
                <Input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} placeholder="Leave blank to use this everywhere" />
              </div>
              <div className="space-y-2">
                <Label>Minimum amount</Label>
                <Input value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Maximum amount</Label>
                <Input value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} placeholder="Leave blank if there is no cap" />
              </div>
              <div className="space-y-2">
                <Label>Approval step</Label>
                <Input value={form.step_order} onChange={(e) => setForm({ ...form, step_order: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Approver group</Label>
                <Select value={form.approval_group} onValueChange={(value) => setForm({ ...form, approval_group: value })}>
                  <SelectTrigger><SelectValue placeholder="Choose a group" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.approval_group}>
                  Save route
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">{rules.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Active</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">{rules.filter((rule) => rule.is_active).length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Groups Used</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">{new Set(rules.map((rule) => rule.approval_group_name)).size}</CardContent>
        </Card>
      </div>

      {pagedGrouped.map(([costCenter, items]) => (
        <Card key={costCenter}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{costCenter}</CardTitle>
            <Badge variant="secondary">{items.length} routes</Badge>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Spend range</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.sort((a, b) => a.step_order - b.step_order).map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>
                      {currency(rule.min_amount)} to {rule.max_amount ? currency(rule.max_amount) : 'No limit'}
                    </TableCell>
                    <TableCell>{rule.step_order}</TableCell>
                    <TableCell>{rule.approval_group_name}</TableCell>
                    <TableCell>
                      <Badge className={rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {rules.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Showing page {page} of {totalPages} with {rules.length} approval routes
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Rows</span>
            <Select value={pageSize} onValueChange={(value) => { setPageSize(value); setPage(1); }}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
