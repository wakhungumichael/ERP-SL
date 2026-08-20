import { useQuery } from '@tanstack/react-query';
import { Wallet, ShieldCheck, AlertTriangle, ReceiptText } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/use-auth';

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function BudgetingOverview() {
  const { token } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['budgeting-dashboard'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/budgeting/dashboard/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load budgeting dashboard');
      return res.json();
    },
  });

  const totals = data?.totals ?? {};
  const counts = data?.counts ?? {};

  const cards = [
    { label: 'Allocated', value: formatMoney(totals.allocated), icon: Wallet, tone: 'text-emerald-600' },
    { label: 'Committed', value: formatMoney(totals.committed), icon: ShieldCheck, tone: 'text-amber-600' },
    { label: 'Obligated', value: formatMoney(totals.obligated), icon: ReceiptText, tone: 'text-sky-600' },
    { label: 'Available', value: formatMoney(totals.available), icon: AlertTriangle, tone: 'text-violet-600' },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Budget Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Watch allocated funds, commitments, obligations, and budget control activity across the tenant.
          </p>
        </div>
        <Badge variant="secondary">{counts.active_budgets ?? 0} active budgets</Badge>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading budgeting metrics…</div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Budgeting data could not be loaded in the current session.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                  <card.icon className={`h-4 w-4 ${card.tone}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Budgets</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="font-semibold text-foreground">{counts.budgets ?? 0}</div>
                Total budget headers configured.
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Budget Lines</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="font-semibold text-foreground">{counts.lines ?? 0}</div>
                Period and account-level budget lines available for checks.
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Commitments</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="font-semibold text-foreground">{counts.commitments ?? 0}</div>
                Reserved or obligated spending records tracked by the engine.
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Budget Checks</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="font-semibold text-foreground">{counts.checks ?? 0}</div>
                Validation events captured against requisitions and approvals.
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

