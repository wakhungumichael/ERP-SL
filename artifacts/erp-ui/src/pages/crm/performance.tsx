import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const API = (path: string) => fetch(`/api/crm${path}`, { headers: { Authorization: `Token ${localStorage.getItem('sl-erp-token')}` } });

function money(value: number | string | null | undefined) {
  return `KES ${Number(value ?? 0).toLocaleString()}`;
}

export default function SalesPerformancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [owner, setOwner] = useState('');
  const [filters, setFilters] = useState({ from: monthStart, to: today, owner: '' });
  const usersQuery = useQuery({ queryKey: ['crm-performance-users'], queryFn: async () => (await fetch('/api/platform/users/?page_size=200', { headers: { Authorization: `Token ${localStorage.getItem('sl-erp-token')}` } })).json() });
  const query = useQuery({
    queryKey: ['crm-performance', filters],
    queryFn: async () => {
      const params = new URLSearchParams({ from: filters.from, to: filters.to });
      if (filters.owner) params.set('assigned_to', filters.owner);
      const response = await API(`/performance/?${params}`);
      if (!response.ok) throw new Error('Could not load performance report');
      return response.json();
    },
  });
  const rows = query.data?.results ?? [];
  const totals = useMemo(() => rows.reduce((result: any, row: any) => ({
    pipeline: result.pipeline + Number(row.open_pipeline ?? 0), won: result.won + Number(row.won_value ?? 0), deals: result.deals + Number(row.deals_won ?? 0), activities: result.activities + Number(row.activities_completed ?? 0),
  }), { pipeline: 0, won: 0, deals: 0, activities: 0 }), [rows]);
  const users = usersQuery.data?.results ?? [];
  const conversion = rows.reduce((sum: number, row: any) => sum + Number(row.deals_won ?? 0), 0) ? Math.round((rows.reduce((sum: number, row: any) => sum + Number(row.deals_won ?? 0), 0) / Math.max(1, rows.reduce((sum: number, row: any) => sum + Number(row.deals_won ?? 0) + Number(row.deals_lost ?? 0), 0))) * 100) : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Sales Performance</h1><p className="mt-1 text-sm text-muted-foreground">Pipeline, outcomes and activity completed by sales representative.</p></div>
        <div className="flex flex-wrap items-end gap-2"><div><label className="text-[11px] font-medium text-muted-foreground">From</label><Input className="h-8" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div><label className="text-[11px] font-medium text-muted-foreground">To</label><Input className="h-8" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div><Select value={owner || 'all'} onValueChange={(value) => setOwner(value === 'all' ? '' : value)}><SelectTrigger className="h-8 w-[170px]"><SelectValue placeholder="All reps" /></SelectTrigger><SelectContent><SelectItem value="all">All reps</SelectItem>{users.map((user: any) => <SelectItem key={user.id} value={String(user.id)}>{user.full_name || user.username}</SelectItem>)}</SelectContent></Select><Button size="sm" onClick={() => setFilters({ from, to, owner })}>Apply</Button></div>
      </header>
      <section className="grid grid-cols-2 gap-3 border-y py-3 md:grid-cols-5">{[['Won Value', money(totals.won)], ['Pipeline', money(totals.pipeline)], ['Deals Won', totals.deals], ['Conversion', `${conversion}%`], ['Activities Completed', totals.activities]].map(([label, value]) => <div key={String(label)} className="border-l px-3 first:border-l-0"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></div>)}</section>
      <div className="overflow-x-auto rounded-lg border bg-card"><Table><TableHeader><TableRow className="bg-muted/40"><TableHead>Sales Representative</TableHead><TableHead>Open Pipeline</TableHead><TableHead>Won Value</TableHead><TableHead>Deals Won</TableHead><TableHead>Activities</TableHead><TableHead>Overdue</TableHead><TableHead>Conversion</TableHead></TableRow></TableHeader><TableBody>{query.isLoading ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Loading report…</TableCell></TableRow> : rows.length ? rows.map((row: any) => <TableRow key={row.assigned_to}><TableCell className="font-medium">{row.owner_name}</TableCell><TableCell className="whitespace-nowrap">{money(row.open_pipeline)}</TableCell><TableCell className="whitespace-nowrap">{money(row.won_value)}</TableCell><TableCell>{row.deals_won}</TableCell><TableCell>{row.activities_completed}</TableCell><TableCell>{row.overdue_activities}</TableCell><TableCell>{row.conversion_rate}%</TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No performance data for this period.</TableCell></TableRow>}</TableBody></Table></div>
    </div>
  );
}
