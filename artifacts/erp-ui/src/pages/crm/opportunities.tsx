import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { ProcessFlow } from '@/components/workflow/process-flow';
import {
  ArrowRight,
  Boxes,
  Building2,
  CalendarClock,
  CircleCheckBig,
  FileText,
  PackageCheck,
  PencilLine,
  Plus,
  ShoppingCart,
  Target,
  TrendingUp,
  UserRound,
  AlertTriangle,
  KanbanSquare,
  Rows3,
} from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const STAGE_STYLES: Record<string, { badge: string; bar: string; label: string; tone: string; helper: string }> = {
  new: { badge: 'bg-slate-100 text-slate-700 border-slate-300', bar: 'bg-slate-400', label: 'New', tone: 'text-slate-700', helper: 'Qualify and identify the right contact.' },
  contacted: { badge: 'bg-blue-100 text-blue-800 border-blue-300', bar: 'bg-blue-500', label: 'Contacted', tone: 'text-blue-700', helper: 'Build context and confirm active interest.' },
  proposal: { badge: 'bg-purple-100 text-purple-800 border-purple-300', bar: 'bg-purple-500', label: 'Proposal Sent', tone: 'text-purple-700', helper: 'Move commercial details into formal quoting.' },
  negotiation: { badge: 'bg-orange-100 text-orange-800 border-orange-300', bar: 'bg-orange-500', label: 'Negotiating', tone: 'text-orange-700', helper: 'Close blockers, pricing, and delivery commitments.' },
  won: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', bar: 'bg-emerald-500', label: 'Won', tone: 'text-emerald-700', helper: 'Hand off quickly into order execution.' },
  lost: { badge: 'bg-red-100 text-red-800 border-red-300', bar: 'bg-red-400', label: 'Lost', tone: 'text-red-700', helper: 'Capture learning and prevent silent churn.' },
};

const STAGES = Object.entries(STAGE_STYLES).map(([value, config]) => ({ value, label: config.label }));

type Opportunity = {
  id: number;
  title: string;
  organisation?: number | null;
  organisation_name?: string;
  contact?: number | null;
  contact_name?: string;
  stage: string;
  stage_display?: string;
  value?: string | number | null;
  currency?: string;
  expected_close_date?: string | null;
  assigned_to?: number | null;
  assigned_to_name?: string;
  products?: number[];
  product_summary?: { id: number; name: string; code?: string; product_type?: string }[];
  notes?: string;
};

type ProductOption = {
  id: number;
  name: string;
  code?: string;
  product_type?: string;
};

function formatMoney(value: string | number | null | undefined, currency = 'KES') {
  const amount = value == null ? 0 : Number(value);
  return `${currency} ${amount.toLocaleString()}`;
}

function stageNextStep(stage: string) {
  if (stage === 'won') {
    return {
      href: '/sales/orders',
      label: 'Create sales order',
      shortLabel: 'Sales order',
      helper: 'Keep the handoff moving into executable delivery and billing.',
      icon: <ShoppingCart className="h-3.5 w-3.5" />,
    };
  }
  if (stage === 'proposal' || stage === 'negotiation') {
    return {
      href: '/sales/estimates',
      label: 'Open quotes',
      shortLabel: 'Quote',
      helper: 'Move pricing and scope into a formal quote.',
      icon: <FileText className="h-3.5 w-3.5" />,
    };
  }
  return {
    href: '/sales/products',
    label: 'Review product fit',
    shortLabel: 'Products',
    helper: 'Confirm the right products and scope before moving the deal forward.',
    icon: <Boxes className="h-3.5 w-3.5" />,
  };
}

function formatDate(value?: string | null) {
  if (!value) return 'No close date';
  return new Date(value).toLocaleDateString();
}

function daysToClose(value?: string | null) {
  if (!value) return null;
  const now = new Date();
  const close = new Date(value);
  const diff = Math.ceil((close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function useProductCatalog(enabled = true) {
  return useQuery({
    queryKey: ['sales-products-picker'],
    queryFn: async () => {
      const token = localStorage.getItem('sl-erp-token');
      const res = await fetch('/api/sales/products/?page_size=200&is_active=true', {
        headers: { Authorization: `Token ${token}` },
      });
      return res.json();
    },
    staleTime: 60_000,
    enabled,
  });
}

function ProductSelectionField({
  products,
  selectedIds,
  onChange,
}: {
  products: ProductOption[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (value: string) => {
    onChange(
      selectedIds.includes(value)
        ? selectedIds.filter((item) => item !== value)
        : [...selectedIds, value],
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {selectedIds.length ? selectedIds.map((id) => {
          const match = products.find((product) => String(product.id) === id);
          if (!match) return null;
          return (
            <span key={id} className="inline-flex rounded-full border bg-muted/30 px-2.5 py-1 text-xs">
              {match.name}
            </span>
          );
        }) : <span className="text-sm text-muted-foreground">No products or services linked yet.</span>}
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border p-3">
        {products.length ? products.map((product) => {
          const productId = String(product.id);
          const selected = selectedIds.includes(productId);
          return (
            <label key={product.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/30">
              <Checkbox checked={selected} onCheckedChange={() => toggle(productId)} />
              <div className="min-w-0">
                <div className="text-sm font-medium">{product.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[product.product_type, product.code].filter(Boolean).join(' • ') || 'Product'}
                </div>
              </div>
            </label>
          );
        }) : (
          <div className="text-sm text-muted-foreground">No active products or services available.</div>
        )}
      </div>
    </div>
  );
}

export default function OpportunitiesPage() {
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-opps', stageFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stageFilter) params.set('stage', stageFilter);
      if (search) params.set('search', search);
      const res = await API(`/opportunities/?${params.toString()}`);
      return res.json();
    },
  });

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline-summary'],
    queryFn: () => API('/opportunities/pipeline-summary/').then((r) => r.json()),
  });
  const { data: catalogData } = useProductCatalog();

  const opportunities = Array.isArray(data) ? data : data?.results ?? [];
  const pipeline: any[] = pipelineData?.pipeline ?? [];
  const productCatalog: ProductOption[] = Array.isArray(catalogData) ? catalogData : catalogData?.results ?? [];

  useEffect(() => {
    if (!selectedOpportunity) return;
    const fresh = opportunities.find((opportunity: Opportunity) => opportunity.id === selectedOpportunity.id);
    if (fresh) setSelectedOpportunity(fresh);
  }, [opportunities, selectedOpportunity]);

  const grouped = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    STAGES.forEach((stage) => map.set(stage.value, []));
    opportunities.forEach((opportunity: Opportunity) => {
      const bucket = map.get(opportunity.stage) ?? [];
      bucket.push(opportunity);
      map.set(opportunity.stage, bucket);
    });
    return map;
  }, [opportunities]);

  const pipelineValue = opportunities
    .filter((item: Opportunity) => !['won', 'lost'].includes(item.stage))
    .reduce((sum: number, item: Opportunity) => sum + Number(item.value ?? 0), 0);
  const wonCount = opportunities.filter((item: Opportunity) => item.stage === 'won').length;
  const atRiskCount = opportunities.filter((item: Opportunity) => item.stage === 'negotiation' || item.stage === 'proposal').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Opportunities</h1>
          <p className="text-sm text-muted-foreground mt-1">Track deals, update progress, and move work forward from one clear page.</p>
        </div>
        <AddOpportunityDialog />
      </div>

      <section className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Deal Overview
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">See what each deal needs next.</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Use the board or list to check deal status, spot delays, and move sales into quotes or orders.
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
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Open Deal Value</div>
                <div className="mt-2 text-2xl font-semibold">{formatMoney(pipelineValue)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Value of deals still in progress</div>
              </div>
              <div className="rounded-2xl border bg-muted/20 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Won Deals</div>
                <div className="mt-2 text-2xl font-semibold">{wonCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Deals already marked as won</div>
              </div>
              <div className="rounded-2xl border bg-muted/20 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Proposal or Negotiation</div>
                <div className="mt-2 text-2xl font-semibold">{atRiskCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Deals that may need faster follow-up</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ProcessFlow
        title="Sales Flow"
        description="Move a deal from first contact to quote, order, delivery, and invoice without losing context."
        stages={[
          { label: 'Lead', active: true },
          { label: 'Proposal', active: !!pipeline.find((s: any) => s.stage === 'proposal') },
          { label: 'Negotiation', active: !!pipeline.find((s: any) => s.stage === 'negotiation') },
          { label: 'Won', active: !!pipeline.find((s: any) => s.stage === 'won') },
          { label: 'Sales Order' },
          { label: 'Fulfillment' },
          { label: 'Invoice' },
        ]}
        actions={[
          {
            label: 'Create Quote',
            href: '/sales/estimates',
            icon: <TrendingUp className="h-4 w-4 text-violet-600" />,
            helper: 'Move proposal and negotiation deals into formal quotes.',
            tone: 'default',
          },
          {
            label: 'Create Sales Order',
            href: '/sales/orders',
            icon: <ShoppingCart className="h-4 w-4 text-sky-600" />,
            helper: 'Turn won deals into confirmed customer orders.',
            tone: 'success',
          },
          {
            label: 'View Fulfillment',
            href: '/inventory/overview',
            icon: <PackageCheck className="h-4 w-4 text-emerald-600" />,
            helper: 'Check stock, reservations, and dispatch progress.',
            tone: 'warning',
          },
        ]}
      />

      {pipeline.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {pipeline.map((stage: any) => (
            <button
              key={stage.stage}
              onClick={() => setStageFilter(stageFilter === stage.stage ? '' : stage.stage)}
              className={`rounded-lg border bg-card p-3 text-left shadow-sm transition-all hover:shadow-md ${stageFilter === stage.stage ? 'ring-2 ring-primary ring-offset-1' : ''}`}
            >
              <div className={`mb-2 text-[10px] font-bold uppercase tracking-wide ${STAGE_STYLES[stage.stage]?.tone ?? 'text-muted-foreground'}`}>{stage.label}</div>
              <div className="text-xl font-black">{stage.count}</div>
              {stage.total_value > 0 && <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">KES {stage.total_value.toLocaleString()}</div>}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
        <Input
          placeholder="Search deals, companies, or contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 flex-1 border-0 text-sm shadow-none focus-visible:ring-0"
        />
        {stageFilter && (
          <button onClick={() => setStageFilter('')} className="text-xs font-medium text-primary hover:underline">
            Clear filter
          </button>
        )}
      </div>

      {viewMode === 'board' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Deal Board</div>
              <div className="mt-1 text-lg font-semibold">Deals grouped by stage</div>
            </div>
            <Link href="/sales/estimates" className="text-sm text-primary hover:underline">View quotes</Link>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex min-w-max gap-4">
              {STAGES.map((stage) => {
                const items = grouped.get(stage.value) ?? [];
                const style = STAGE_STYLES[stage.value];
                return (
                  <div key={stage.value} className="w-[300px] shrink-0 rounded-2xl border bg-card shadow-sm">
                    <div className="sticky top-0 z-10 rounded-t-2xl border-b bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{style.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{style.helper}</div>
                        </div>
                        <div className="rounded-full bg-muted px-2.5 py-1 text-sm font-semibold">{items.length}</div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${style.bar}`}
                          style={{ width: `${Math.min(100, (items.length / Math.max(1, opportunities.length)) * 250)}%` }}
                        />
                      </div>
                    </div>
                    <div className="min-h-[420px] space-y-3 p-4">
                      {items.length ? items.slice(0, 6).map((opportunity) => {
                        const nextStep = stageNextStep(opportunity.stage);
                        const closeInDays = daysToClose(opportunity.expected_close_date);
                        return (
                          <button
                            key={opportunity.id}
                            onClick={() => setSelectedOpportunity(opportunity)}
                            className="w-full rounded-2xl border bg-background p-3 text-left transition-colors hover:bg-muted/20"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="line-clamp-2 text-sm font-semibold">{opportunity.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{opportunity.organisation_name || 'Unlinked company'}</div>
                              {opportunity.product_summary?.length ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {opportunity.product_summary.slice(0, 2).map((product) => (
                                    <span key={product.id} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                      {product.name}
                                    </span>
                                  ))}
                                  {opportunity.product_summary.length > 2 ? (
                                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                      +{opportunity.product_summary.length - 2}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                              <span className="text-[10px] font-mono text-muted-foreground">CRM-{opportunity.id}</span>
                            </div>
                            <div className="mt-3 space-y-2">
                              <div className="text-sm font-medium">{formatMoney(opportunity.value, opportunity.currency || 'KES')}</div>
                              {opportunity.contact_name ? (
                                <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <UserRound className="h-3 w-3" />
                                  {opportunity.contact_name}
                                </div>
                              ) : null}
                              {closeInDays !== null ? (
                                <div className={`inline-flex items-center gap-1 text-[11px] ${closeInDays < 0 ? 'text-rose-700' : closeInDays <= 7 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                                  {closeInDays <= 7 ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                                  {closeInDays < 0 ? `${Math.abs(closeInDays)}d overdue` : `${closeInDays}d left`}
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                              <div className="text-[11px] text-muted-foreground">{opportunity.assigned_to_name || 'Unassigned'}</div>
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                                {nextStep.icon}
                                {nextStep.shortLabel}
                              </span>
                            </div>
                          </button>
                        );
                      }) : (
                        <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                          No deals here yet.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Opportunity</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Products/Services</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Estimated Value</TableHead>
              <TableHead>Expected Close</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Next Step</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading opportunities…</TableCell></TableRow>
            ) : opportunities.length ? opportunities.map((opportunity: Opportunity) => {
              const style = STAGE_STYLES[opportunity.stage];
              const nextStep = stageNextStep(opportunity.stage);
              return (
                <TableRow key={opportunity.id} className="transition-colors hover:bg-muted/30">
                  <TableCell>
                    <button onClick={() => setSelectedOpportunity(opportunity)} className="text-left">
                      <div className="font-semibold text-primary hover:underline">{opportunity.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">View deal details</div>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{opportunity.organisation_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{opportunity.contact_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {opportunity.product_summary?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {opportunity.product_summary.slice(0, 2).map((product) => (
                          <span key={product.id} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px]">
                            {product.name}
                          </span>
                        ))}
                        {opportunity.product_summary.length > 2 ? (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px]">
                            +{opportunity.product_summary.length - 2}
                          </span>
                        ) : null}
                      </div>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    <InlineStageEditor opportunity={opportunity} />
                    <span className={`mt-2 inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style?.badge ?? 'bg-secondary border-border'}`}>
                      {style?.label ?? opportunity.stage}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">
                    {formatMoney(opportunity.value, opportunity.currency || 'KES')}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{opportunity.expected_close_date || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{opportunity.assigned_to_name || '—'}</TableCell>
                  <TableCell>
                    <Link href={nextStep.href} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                      {nextStep.icon}
                      {nextStep.shortLabel}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow><TableCell colSpan={9} className="py-16 text-center text-sm text-muted-foreground">No opportunities found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <OpportunitySheet
        opportunity={selectedOpportunity}
        open={!!selectedOpportunity}
        onOpenChange={(open) => { if (!open) setSelectedOpportunity(null); }}
        productCatalog={productCatalog}
      />
    </div>
  );
}

function InlineStageEditor({ opportunity }: { opportunity: Opportunity }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const updateStage = useMutation({
    mutationFn: (stage: string) =>
      API(`/opportunities/${opportunity.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      }).then(async (r) => {
        if (!r.ok) throw new Error('Could not update stage');
        return r.json();
      }),
    onSuccess: () => {
      toast({ title: 'Opportunity stage updated' });
      qc.invalidateQueries({ queryKey: ['crm-opps'] });
      qc.invalidateQueries({ queryKey: ['crm-pipeline-summary'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
    onError: () => toast({ title: 'Could not update stage', variant: 'destructive' }),
  });

  return (
    <Select value={opportunity.stage} onValueChange={(value) => updateStage.mutate(value)} disabled={updateStage.isPending}>
      <SelectTrigger className="h-8 border-dashed bg-background text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((stage) => (
          <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OpportunitySheet({
  opportunity,
  open,
  onOpenChange,
  productCatalog,
}: {
  opportunity: Opportunity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productCatalog: ProductOption[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: '',
    organisation: '',
    contact: '',
    products: [] as string[],
    stage: 'new',
    value: '',
    currency: 'KES',
    expected_close_date: '',
    notes: '',
  });

  useEffect(() => {
    if (!opportunity) return;
    setForm({
      title: opportunity.title || '',
      organisation: opportunity.organisation ? String(opportunity.organisation) : '',
      contact: opportunity.contact ? String(opportunity.contact) : '',
      products: (opportunity.products ?? []).map(String),
      stage: opportunity.stage || 'new',
      value: opportunity.value != null ? String(opportunity.value) : '',
      currency: opportunity.currency || 'KES',
      expected_close_date: opportunity.expected_close_date || '',
      notes: opportunity.notes || '',
    });
  }, [opportunity]);

  const { data: orgsData } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: () => API('/companies/?page_size=200').then((r) => r.json()),
    enabled: open,
  });
  const organisations = Array.isArray(orgsData) ? orgsData : orgsData?.results ?? [];

  const { data: peopleData } = useQuery({
    queryKey: ['crm-people-picker', form.organisation],
    queryFn: () => {
      const params = new URLSearchParams();
      if (form.organisation) params.set('organisation', form.organisation);
      params.set('page_size', '200');
      const query = params.toString();
      return API(`/people/${query ? `?${query}` : ''}`).then((r) => r.json());
    },
    enabled: open,
  });
  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];

  const save = useMutation({
    mutationFn: () => {
      if (!opportunity) throw new Error('No opportunity selected');
      const body: any = { ...form };
      if (body.organisation) body.organisation = parseInt(body.organisation, 10); else body.organisation = null;
      if (body.contact) body.contact = parseInt(body.contact, 10); else body.contact = null;
      body.products = (body.products || []).map((productId: string) => parseInt(productId, 10));
      if (!body.value) body.value = null;
      if (!body.expected_close_date) body.expected_close_date = null;
      return API(`/opportunities/${opportunity.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error('Could not update opportunity');
        return r.json();
      });
    },
    onSuccess: (updated) => {
      toast({ title: 'Opportunity updated' });
      qc.invalidateQueries({ queryKey: ['crm-opps'] });
      qc.invalidateQueries({ queryKey: ['crm-pipeline-summary'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      setForm({
        title: updated.title || '',
        organisation: updated.organisation ? String(updated.organisation) : '',
        contact: updated.contact ? String(updated.contact) : '',
        products: (updated.products ?? []).map(String),
        stage: updated.stage || 'new',
        value: updated.value != null ? String(updated.value) : '',
        currency: updated.currency || 'KES',
        expected_close_date: updated.expected_close_date || '',
        notes: updated.notes || '',
      });
    },
    onError: () => toast({ title: 'Could not update opportunity', variant: 'destructive' }),
  });

  const convertOpportunity = useMutation({
    mutationFn: async () => {
      if (!opportunity) throw new Error('No opportunity selected');
      const endpoint = form.stage === 'won' ? 'convert-to-sales-order' : 'convert-to-estimate';
      const res = await API(`/opportunities/${opportunity.id}/${endpoint}/`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not create the next document');
      return body;
    },
    onSuccess: (result) => {
      const createdLabel = form.stage === 'won'
        ? result?.order_number || 'sales order'
        : result?.estimate_number || 'quote';
      toast({
        title: form.stage === 'won' ? 'Sales order created' : 'Quote created',
        description: `Created ${createdLabel} from this deal.`,
      });
      qc.invalidateQueries({ queryKey: ['crm-opps'] });
      qc.invalidateQueries({ queryKey: ['crm-pipeline-summary'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
    onError: (error: Error) => toast({ title: 'Could not create next document', description: error.message, variant: 'destructive' }),
  });

  if (!opportunity) return null;

  const nextStep = stageNextStep(form.stage);
  const stageIndex = STAGES.findIndex((item) => item.value === form.stage);
  const canCreateNextDocument = form.stage === 'proposal' || form.stage === 'negotiation' || form.stage === 'won';
  const createActionLabel = form.stage === 'won' ? 'Create Sales Order' : 'Create Quote';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PencilLine className="h-4 w-4 text-primary" />
            Deal Details
          </SheetTitle>
          <SheetDescription>
            Update the deal, review the key details, and move to the next sales step.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Selected Deal</p>
                <h2 className="mt-1 text-xl font-black">{form.title || opportunity.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {opportunity.organisation_name || 'Unlinked company'}</span>
                  <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {opportunity.contact_name || 'No contact yet'}</span>
                  <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatDate(form.expected_close_date)}</span>
                </div>
              </div>
              <span className={`inline-flex rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STAGE_STYLES[form.stage]?.badge ?? 'bg-secondary border-border'}`}>
                {STAGE_STYLES[form.stage]?.label ?? form.stage}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Deal Stage</p>
                <p className="mt-1 text-sm text-muted-foreground">Choose the current stage for this deal.</p>
              </div>
              <Select value={form.stage} onValueChange={(value) => setForm((prev) => ({ ...prev, stage: value }))}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((stage) => (
                    <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {STAGES.map((stage, index) => {
                const current = stage.value === form.stage;
                const reached = stageIndex >= index;
                return (
                  <button
                    key={stage.value}
                    onClick={() => setForm((prev) => ({ ...prev, stage: stage.value }))}
                    className={`rounded-xl border p-3 text-left transition-colors ${current ? 'border-primary bg-primary/5' : reached ? 'bg-muted/30' : 'bg-background'} hover:bg-muted/40`}
                  >
                    <div className="flex items-center gap-2">
                      <CircleCheckBig className={`h-4 w-4 ${reached ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="text-sm font-semibold">{stage.label}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{STAGE_STYLES[stage.value].helper}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
            <div className="space-y-4 rounded-2xl border p-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opportunity Title</label>
                <Input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company</label>
                  <Select value={form.organisation} onValueChange={(value) => setForm((prev) => ({ ...prev, organisation: value, contact: '' }))}>
                    <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {organisations.map((org: any) => <SelectItem key={org.id} value={String(org.id)}>{org.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Person</label>
                  <Select value={form.contact} onValueChange={(value) => setForm((prev) => ({ ...prev, contact: value }))} disabled={!form.organisation}>
                    <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                    <SelectContent>
                      {people.map((person: any) => <SelectItem key={person.id} value={String(person.id)}>{person.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Products & Services</label>
                <ProductSelectionField
                  products={productCatalog}
                  selectedIds={form.products}
                  onChange={(products) => setForm((prev) => ({ ...prev, products }))}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Estimated Value</label>
                  <Input type="number" min={0} value={form.value} onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Currency</label>
                  <Select value={form.currency} onValueChange={(value) => setForm((prev) => ({ ...prev, currency: value }))}>
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
                <Input type="date" value={form.expected_close_date} onChange={(e) => setForm((prev) => ({ ...prev, expected_close_date: e.target.value }))} className="font-mono text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Add notes, blockers, customer feedback, or next actions..."
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => save.mutate()} disabled={save.isPending || !form.title} className="font-bold uppercase tracking-wide">
                  {save.isPending ? 'Saving…' : 'Save Opportunity'}
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Next Step</p>
                <div className="mt-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {nextStep.icon}
                    {nextStep.label}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{nextStep.helper}</p>
                  {form.products.length ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {form.products.length} linked product{form.products.length === 1 ? '' : 's'} will carry into the next document by default.
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-col gap-2">
                    {canCreateNextDocument ? (
                      <Button
                        className="w-full justify-center gap-2"
                        onClick={() => convertOpportunity.mutate()}
                        disabled={convertOpportunity.isPending}
                      >
                        {nextStep.icon}
                        {convertOpportunity.isPending ? 'Creating…' : createActionLabel}
                      </Button>
                    ) : (
                      <Link href={nextStep.href}>
                        <Button className="w-full justify-center gap-2">
                          {nextStep.icon}
                          Open Page
                        </Button>
                      </Link>
                    )}
                    <Link href={nextStep.href}>
                      <Button variant="outline" className="w-full justify-center gap-2">
                        {nextStep.icon}
                        View {form.stage === 'won' ? 'Orders' : form.stage === 'proposal' || form.stage === 'negotiation' ? 'Quotes' : 'Products'}
                      </Button>
                    </Link>
                    <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                      Save Then Continue
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Helpful Tips</p>
                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                  <div className="rounded-xl bg-muted/20 p-3">
                    <div className="font-semibold text-foreground">1. Confirm the need early</div>
                    <p className="mt-1">For new deals, make sure the problem, timeline, and buyer are clear.</p>
                  </div>
                  <div className="rounded-xl bg-muted/20 p-3">
                    <div className="font-semibold text-foreground">2. Move serious deals into quotes</div>
                    <p className="mt-1">Proposal and negotiation work is easier to track once it becomes a formal quote.</p>
                  </div>
                  <div className="rounded-xl bg-muted/20 p-3">
                    <div className="font-semibold text-foreground">3. Act quickly after a win</div>
                    <p className="mt-1">Won deals should move into orders and fulfillment before details are lost.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Quick Links</p>
                <div className="mt-3 grid gap-2">
                  <Link href="/sales/estimates" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                    <FileText className="h-4 w-4" />
                    Estimates
                  </Link>
                  <Link href="/sales/orders" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                    <ShoppingCart className="h-4 w-4" />
                    Sales Orders
                  </Link>
                  <Link href="/inventory/overview" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                    <PackageCheck className="h-4 w-4" />
                    Fulfillment and Inventory
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddOpportunityDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    organisation: '',
    contact: '',
    products: [] as string[],
    stage: 'new',
    value: '',
    currency: 'KES',
    expected_close_date: '',
    notes: '',
  });

  const { data: orgsData } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: () => API('/companies/?page_size=200').then((r) => r.json()),
    enabled: open,
  });
  const organisations = Array.isArray(orgsData) ? orgsData : orgsData?.results ?? [];
  const { data: catalogData } = useProductCatalog(open);
  const productCatalog: ProductOption[] = Array.isArray(catalogData) ? catalogData : catalogData?.results ?? [];

  const { data: peopleData } = useQuery({
    queryKey: ['crm-people-picker', form.organisation],
    queryFn: () => {
      const params = new URLSearchParams();
      if (form.organisation) params.set('organisation', form.organisation);
      params.set('page_size', '200');
      const query = params.toString();
      return API(`/people/${query ? `?${query}` : ''}`).then((r) => r.json());
    },
    enabled: open,
  });
  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];

  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...form };
      if (body.organisation) body.organisation = parseInt(body.organisation, 10); else body.organisation = null;
      if (body.contact) body.contact = parseInt(body.contact, 10); else body.contact = null;
      body.products = (body.products || []).map((productId: string) => parseInt(productId, 10));
      if (!body.value) body.value = null;
      if (!body.expected_close_date) body.expected_close_date = null;
      return API('/opportunities/', {
        method: 'POST',
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error('Could not create opportunity');
        return r.json();
      });
    },
    onSuccess: () => {
      toast({ title: 'Opportunity added' });
      qc.invalidateQueries({ queryKey: ['crm-opps'] });
      qc.invalidateQueries({ queryKey: ['crm-pipeline-summary'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      setOpen(false);
      setForm({
        title: '',
        organisation: '',
        contact: '',
        products: [],
        stage: 'new',
        value: '',
        currency: 'KES',
        expected_close_date: '',
        notes: '',
      });
    },
    onError: () => toast({ title: 'Could not save', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Add Deal</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader><DialogTitle className="font-bold uppercase tracking-widest">New Deal</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Deal Name *</label>
            <Input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Annual supply contract" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Company</label>
              <Select value={form.organisation} onValueChange={(value) => setForm((prev) => ({ ...prev, organisation: value, contact: '' }))}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{organisations.map((org: any) => <SelectItem key={org.id} value={String(org.id)}>{org.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Person</label>
              <Select value={form.contact} onValueChange={(value) => setForm((prev) => ({ ...prev, contact: value }))} disabled={!form.organisation}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>{people.map((person: any) => <SelectItem key={person.id} value={String(person.id)}>{person.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Products & Services</label>
            <ProductSelectionField
              products={productCatalog}
              selectedIds={form.products}
              onChange={(products) => setForm((prev) => ({ ...prev, products }))}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Estimated Value</label>
              <Input type="number" min={0} value={form.value} onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Currency</label>
              <Select value={form.currency} onValueChange={(value) => setForm((prev) => ({ ...prev, currency: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="KES">KES</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Stage</label>
              <Select value={form.stage} onValueChange={(value) => setForm((prev) => ({ ...prev, stage: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Expected Close Date</label>
              <Input type="date" value={form.expected_close_date} onChange={(e) => setForm((prev) => ({ ...prev, expected_close_date: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</label>
            <Input value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Commercial context or next step" />
          </div>
          <Button onClick={() => save.mutate()} className="w-full font-bold uppercase tracking-widest" disabled={!form.title || save.isPending}>
            {save.isPending ? 'Saving…' : 'Add Deal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
