import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Blocks, CircleDot, GitBranchPlus, Link2, Route, Search, Send, ShieldCheck, Workflow } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const BASE = '/api/platform';

type WorkflowStep = {
  id: number;
  workflow: number;
  name: string;
  step_order: number;
  approval_group_name?: string | null;
  min_amount: string | number;
  max_amount?: string | number | null;
  cost_center?: string;
};

type WorkflowEntityBinding = {
  id: number;
  workflow: number;
  module_slug: string;
  entity_type: string;
  entity_label: string;
  route_path?: string;
  api_base_path?: string;
  trigger_events: string[];
  is_primary: boolean;
  is_active: boolean;
};

type WorkflowNode = {
  id: number;
  workflow: number;
  code: string;
  name: string;
  node_type: string;
  step_order: number;
  is_initial: boolean;
  approval_group?: number | null;
  approval_group_name?: string | null;
  approval_mode: string;
  required_approvals: number;
  assigned_user_name?: string | null;
  min_amount: string | number;
  max_amount?: string | number | null;
  cost_center?: string;
  entry_action?: string;
  exit_action?: string;
  notify_dashboard: boolean;
  allow_quick_action: boolean;
  sla_hours: number;
  is_active: boolean;
};

type WorkflowTransition = {
  id: number;
  workflow: number;
  from_node: number;
  from_node_name?: string | null;
  to_node: number;
  to_node_name?: string | null;
  name: string;
  transition_key: string;
  decision?: string;
  priority: number;
  is_default: boolean;
  condition_field?: string;
  condition_operator: string;
  condition_value?: string;
  is_active: boolean;
};

type WorkflowDefinition = {
  id: number;
  code: string;
  name: string;
  entity_type: string;
  scope: string;
  trigger_event: string;
  description?: string;
  is_active: boolean;
  entity_bindings: WorkflowEntityBinding[];
  steps: WorkflowStep[];
  nodes: WorkflowNode[];
  transitions: WorkflowTransition[];
};

type GroupOption = { id: number; name: string };

function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
    return j?.data ?? j;
  });
}

const workflowCatalog = [
  { module: 'Weighbridge', moduleSlug: 'weighbridge', entityType: 'weighbridge_transaction', label: 'Weighment Transaction', routePath: '/weighbridge/transactions', apiPath: '/api/commercial-weighbridge/transactions/', trigger: 'complete' },
  { module: 'Sales', moduleSlug: 'sales', entityType: 'sales_order', label: 'Sales Order', routePath: '/sales/orders', apiPath: '/api/sales/orders/', trigger: 'submit' },
  { module: 'Procurement', moduleSlug: 'procurement', entityType: 'procurement_requisition', label: 'Procurement Requisition', routePath: '/procurement/requisitions', apiPath: '/api/procurement/requisitions/', trigger: 'submit' },
  { module: 'Purchases', moduleSlug: 'purchases', entityType: 'purchase_order', label: 'Purchase Order', routePath: '/purchases/orders', apiPath: '/api/purchases/orders/', trigger: 'submit' },
  { module: 'Purchases', moduleSlug: 'purchases', entityType: 'goods_receipt', label: 'Goods Receipt', routePath: '/purchases/goods-receipts', apiPath: '/api/purchases/goods-receipts/', trigger: 'complete' },
  { module: 'Finance', moduleSlug: 'accounting', entityType: 'vendor_bill', label: 'Vendor Bill', routePath: '/finance/vendor-bills', apiPath: '/api/accounting/vendor-bills/', trigger: 'submit' },
  { module: 'Finance', moduleSlug: 'accounting', entityType: 'payment_batch', label: 'Payment Batch', routePath: '/finance/payments', apiPath: '/api/accounting/payment-batches/', trigger: 'submit' },
  { module: 'Finance', moduleSlug: 'accounting', entityType: 'journal_entry', label: 'Journal Entry', routePath: '/finance/journal-entries', apiPath: '/api/accounting/journal-entries/', trigger: 'post' },
  { module: 'Inventory', moduleSlug: 'inventory', entityType: 'stock_adjustment', label: 'Stock Adjustment', routePath: '/inventory/adjustments', apiPath: '/api/inventory/adjustments/', trigger: 'submit' },
  { module: 'People', moduleSlug: 'hr', entityType: 'leave_request', label: 'Leave Request', routePath: '/hr/leave-requests', apiPath: '/api/hr/leave-requests/', trigger: 'submit' },
] as const;

const entityTypeOptions = workflowCatalog.map((item) => item.entityType);

const triggerOptions = ['submit', 'approve', 'complete', 'post', 'close'];
const moduleSlugOptions = [...new Set(workflowCatalog.map((item) => item.moduleSlug)), 'platform'];
const nodeTypeOptions = ['start', 'approval', 'review', 'condition', 'notification', 'task', 'end'];
const approvalModeOptions = ['single', 'any_one', 'all_members', 'quorum'];
const operatorOptions = ['always', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_true', 'is_false'];
const conditionFieldOptions = ['estimated_total', 'amount', 'cost_center', 'currency', 'status'];

export default function WorkflowCenter() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [studioTab, setStudioTab] = useState('workflow');
  const [selectedCatalogEntity, setSelectedCatalogEntity] = useState<(typeof workflowCatalog)[number]>(workflowCatalog[0]);
  const [workflowForm, setWorkflowForm] = useState({
    code: 'weighbridge-transaction-approval',
    name: 'Weighment Transaction Approval',
    entity_type: 'weighbridge_transaction',
    scope: 'document',
    trigger_event: 'complete',
    description: 'Approval route for completed Weighment Transaction records in Weighbridge.',
  });
  const [bindingForm, setBindingForm] = useState({
    workflow: '',
    module_slug: 'weighbridge',
    entity_type: 'weighbridge_transaction',
    entity_label: 'Weighment Transaction',
    route_path: '/weighbridge/transactions',
    api_base_path: '/api/commercial-weighbridge/transactions/',
    trigger_events: 'complete,approve,reject',
    is_primary: true,
  });
  const [nodeForm, setNodeForm] = useState({
    workflow: '',
    code: '',
    name: '',
    node_type: 'approval',
    step_order: '1',
    is_initial: false,
    approval_group: '',
    approval_mode: 'single',
    required_approvals: '1',
    min_amount: '0',
    max_amount: '',
    cost_center: '',
    entry_action: '',
    exit_action: '',
    notify_dashboard: true,
    allow_quick_action: true,
    sla_hours: '0',
  });
  const [transitionForm, setTransitionForm] = useState({
    workflow: '',
    from_node: '',
    to_node: '',
    name: '',
    transition_key: 'next',
    decision: 'approve',
    priority: '1',
    is_default: false,
    condition_field: 'estimated_total',
    condition_operator: 'always',
    condition_value: '',
  });

  const defsQuery = useQuery({
    queryKey: ['workflow-definitions-v2'],
    enabled: !!token,
    queryFn: () => api(token!, '/workflows/definitions/?page_size=100'),
    retry: false,
  });

  const rolesQuery = useQuery({
    queryKey: ['workflow-groups'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/procurement/approval-groups/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load approval groups');
      return res.json();
    },
    retry: false,
  });

  const workflows: WorkflowDefinition[] = defsQuery.data?.results ?? defsQuery.data ?? [];
  const groups: GroupOption[] = rolesQuery.data?.results ?? rolesQuery.data ?? [];

  useEffect(() => {
    if (!workflows.length) {
      setSelectedWorkflowId(null);
      return;
    }
    if (!selectedWorkflowId || !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [workflows, selectedWorkflowId]);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;

  useEffect(() => {
    if (!selectedWorkflow) {
      return;
    }
    setBindingForm((prev) => ({ ...prev, workflow: String(selectedWorkflow.id) }));
    setNodeForm((prev) => ({ ...prev, workflow: String(selectedWorkflow.id) }));
    setTransitionForm((prev) => ({ ...prev, workflow: String(selectedWorkflow.id) }));
  }, [selectedWorkflow]);

  useEffect(() => {
    setStudioTab('workflow');
  }, [selectedWorkflowId]);

  const createWorkflow = useMutation({
    mutationFn: () => api(token!, '/workflows/definitions/', 'POST', workflowForm),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['workflow-definitions-v2'] });
      setSelectedWorkflowId(created?.id ?? null);
      toast({ title: 'Workflow created' });
      setWorkflowForm({
        code: '',
        name: '',
        entity_type: 'procurement_requisition',
        scope: 'document',
        trigger_event: 'submit',
        description: '',
      });
    },
    onError: (e: any) => {
      toast({ title: 'Workflow save failed', description: e.message, variant: 'destructive' });
    },
  });

  const createBinding = useMutation({
    mutationFn: () => api(token!, '/workflows/entity-bindings/', 'POST', {
      workflow: Number(bindingForm.workflow),
      module_slug: bindingForm.module_slug,
      entity_type: bindingForm.entity_type,
      entity_label: bindingForm.entity_label,
      route_path: bindingForm.route_path,
      api_base_path: bindingForm.api_base_path,
      trigger_events: bindingForm.trigger_events.split(',').map((item) => item.trim()).filter(Boolean),
      is_primary: bindingForm.is_primary,
      is_active: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-definitions-v2'] });
      toast({ title: 'Model link created' });
      if (selectedWorkflow) {
        setBindingForm({
          workflow: String(selectedWorkflow.id),
          module_slug: 'procurement',
          entity_type: selectedWorkflow.entity_type,
          entity_label: selectedWorkflow.name,
          route_path: '',
          api_base_path: '',
          trigger_events: selectedWorkflow.trigger_event,
          is_primary: true,
        });
      }
    },
    onError: (e: any) => {
      toast({ title: 'Model link failed', description: e.message, variant: 'destructive' });
    },
  });

  const createNode = useMutation({
    mutationFn: () => api(token!, '/workflows/nodes/', 'POST', {
      workflow: Number(nodeForm.workflow),
      code: nodeForm.code,
      name: nodeForm.name,
      node_type: nodeForm.node_type,
      step_order: Number(nodeForm.step_order),
      is_initial: nodeForm.is_initial,
      approval_group: nodeForm.approval_group ? Number(nodeForm.approval_group) : null,
      approval_mode: nodeForm.approval_mode,
      required_approvals: Number(nodeForm.required_approvals),
      min_amount: Number(nodeForm.min_amount),
      max_amount: nodeForm.max_amount ? Number(nodeForm.max_amount) : null,
      cost_center: nodeForm.cost_center,
      entry_action: nodeForm.entry_action,
      exit_action: nodeForm.exit_action,
      notify_dashboard: nodeForm.notify_dashboard,
      allow_quick_action: nodeForm.allow_quick_action,
      sla_hours: Number(nodeForm.sla_hours),
      is_active: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-definitions-v2'] });
      toast({ title: 'Node created' });
      if (selectedWorkflow) {
        setNodeForm({
          workflow: String(selectedWorkflow.id),
          code: '',
          name: '',
          node_type: 'approval',
          step_order: String((selectedWorkflow.nodes?.length ?? 0) + 1),
          is_initial: false,
          approval_group: '',
          approval_mode: 'single',
          required_approvals: '1',
          min_amount: '0',
          max_amount: '',
          cost_center: '',
          entry_action: '',
          exit_action: '',
          notify_dashboard: true,
          allow_quick_action: true,
          sla_hours: '0',
        });
      }
    },
    onError: (e: any) => {
      toast({ title: 'Node save failed', description: e.message, variant: 'destructive' });
    },
  });

  const createTransition = useMutation({
    mutationFn: () => api(token!, '/workflows/transitions/', 'POST', {
      workflow: Number(transitionForm.workflow),
      from_node: Number(transitionForm.from_node),
      to_node: Number(transitionForm.to_node),
      name: transitionForm.name,
      transition_key: transitionForm.transition_key,
      decision: transitionForm.decision,
      priority: Number(transitionForm.priority),
      is_default: transitionForm.is_default,
      condition_field: transitionForm.condition_operator === 'always' ? '' : transitionForm.condition_field,
      condition_operator: transitionForm.condition_operator,
      condition_value: transitionForm.condition_value,
      is_active: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-definitions-v2'] });
      toast({ title: 'Transition created' });
      if (selectedWorkflow) {
        setTransitionForm({
          workflow: String(selectedWorkflow.id),
          from_node: '',
          to_node: '',
          name: '',
          transition_key: 'next',
          decision: 'approve',
          priority: '1',
          is_default: false,
          condition_field: 'estimated_total',
          condition_operator: 'always',
          condition_value: '',
        });
      }
    },
    onError: (e: any) => {
      toast({ title: 'Transition save failed', description: e.message, variant: 'destructive' });
    },
  });

  const summary = useMemo(() => {
    const nodes = workflows.flatMap((workflow) => workflow.nodes ?? []);
    const transitions = workflows.flatMap((workflow) => workflow.transitions ?? []);
    const groupsUsed = new Set(nodes.map((node) => node.approval_group_name).filter(Boolean));
    return {
      workflowCount: workflows.length,
      nodeCount: nodes.length,
      transitionCount: transitions.length,
      activeGroups: groupsUsed.size,
    };
  }, [workflows]);

  const selectedNodes = useMemo(
    () => [...(selectedWorkflow?.nodes ?? [])].sort((a, b) => a.step_order - b.step_order || a.id - b.id),
    [selectedWorkflow],
  );
  const selectedTransitions = useMemo(
    () => [...(selectedWorkflow?.transitions ?? [])].sort((a, b) => a.priority - b.priority || a.id - b.id),
    [selectedWorkflow],
  );
  const selectedSteps = useMemo(
    () => [...(selectedWorkflow?.steps ?? [])].sort((a, b) => a.step_order - b.step_order || a.id - b.id),
    [selectedWorkflow],
  );
  const visibleCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    if (!needle) return workflowCatalog;
    return workflowCatalog.filter((item) => `${item.module} ${item.label} ${item.entityType}`.toLowerCase().includes(needle));
  }, [catalogSearch]);

  const chooseCatalogEntity = (entity: (typeof workflowCatalog)[number]) => {
    setSelectedCatalogEntity(entity);
    // Choosing a catalogue document starts a new route instead of leaving an unrelated workflow open.
    setSelectedWorkflowId(null);
    setWorkflowForm({
      code: `${entity.entityType.replace(/_/g, '-')}-approval`,
      name: `${entity.label} Approval`,
      entity_type: entity.entityType,
      scope: 'document',
      trigger_event: entity.trigger,
      description: `Approval route for ${entity.label} records in ${entity.module}.`,
    });
    setBindingForm((previous) => ({
      ...previous,
      module_slug: entity.moduleSlug,
      entity_type: entity.entityType,
      entity_label: entity.label,
      route_path: entity.routePath,
      api_base_path: entity.apiPath,
      trigger_events: `${entity.trigger},approve,reject`,
    }));
  };

  return (
    <div className="space-y-5 p-6">
      <div className="rounded-3xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <Workflow className="h-4 w-4" /> Approval Workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Workflow Studio</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Configure how each ERP document is submitted, reviewed, approved, returned, and completed. Start with a business record,
              assign approver roles, then connect the route that users follow from the document's <span className="font-medium text-foreground">Forward for approval</span> action.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border bg-background/80 px-4 py-3"><div className="text-xl font-semibold">{summary.workflowCount}</div><div className="text-xs text-muted-foreground">Workflows</div></div>
            <div className="rounded-2xl border bg-background/80 px-4 py-3"><div className="text-xl font-semibold">{summary.nodeCount}</div><div className="text-xs text-muted-foreground">Approval nodes</div></div>
            <div className="rounded-2xl border bg-background/80 px-4 py-3"><div className="text-xl font-semibold">{summary.transitionCount}</div><div className="text-xs text-muted-foreground">Routes</div></div>
            <div className="rounded-2xl border bg-background/80 px-4 py-3"><div className="text-xl font-semibold">{summary.activeGroups}</div><div className="text-xs text-muted-foreground">Approver groups</div></div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
        <Badge className="rounded-full px-3 py-1" variant="default">1. Select document</Badge>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <Badge className="rounded-full px-3 py-1" variant="outline">2. Configure approver nodes</Badge>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <Badge className="rounded-full px-3 py-1" variant="outline">3. Connect decisions and publish</Badge>
      </div>

      {defsQuery.isError ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">
            Workflow definitions failed to load. {(defsQuery.error as Error)?.message || 'Unknown error.'}
          </CardContent>
        </Card>
      ) : null}

      {rolesQuery.isError ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">
            Approval groups failed to load. {(rolesQuery.error as Error)?.message || 'Unknown error.'}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[330px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/25">
              <div className="flex items-center gap-2">
                <Blocks className="h-5 w-5 text-primary" />
                <CardTitle>ERP Document Catalogue</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Pick the record that needs a forward-for-approval route.</p>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search modules or records" />
              </div>
              <ScrollArea className="h-[340px] pr-3">
                <div className="space-y-1">
                  {visibleCatalog.map((entity) => (
                    <button
                      type="button"
                      key={entity.entityType}
                      onClick={() => chooseCatalogEntity(entity)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-colors',
                        selectedCatalogEntity.entityType === entity.entityType ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border hover:bg-muted/60',
                      )}
                    >
                      <span><span className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">{entity.module}</span><span className="block font-medium">{entity.label}</span></span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                  {visibleCatalog.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching ERP document.</p> : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {!selectedWorkflow ? <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <GitBranchPlus className="h-5 w-5 text-primary" />
                <CardTitle>Create {selectedCatalogEntity.label} Route</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={workflowForm.code} onChange={(e) => setWorkflowForm({ ...workflowForm, code: e.target.value })} placeholder="procurement-requisition-approval" />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={workflowForm.name} onChange={(e) => setWorkflowForm({ ...workflowForm, name: e.target.value })} placeholder="Procurement Requisition Approval" />
              </div>
              <div className="space-y-2">
                <Label>Entity Type</Label>
                <Select value={workflowForm.entity_type} onValueChange={(value) => setWorkflowForm({ ...workflowForm, entity_type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {entityTypeOptions.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Trigger Event</Label>
                <Select value={workflowForm.trigger_event} onValueChange={(value) => setWorkflowForm({ ...workflowForm, trigger_event: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {triggerOptions.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={workflowForm.description} onChange={(e) => setWorkflowForm({ ...workflowForm, description: e.target.value })} rows={5} />
              </div>
              <Button className="w-full" onClick={() => createWorkflow.mutate()} disabled={createWorkflow.isPending || !workflowForm.code || !workflowForm.name}>
                Save Workflow
              </Button>
            </CardContent>
          </Card> : null}

          <Card>
            <CardHeader>
              <CardTitle>Workflow Registry</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[640px]">
                <div className="space-y-2 p-4">
                  {workflows.map((workflow) => (
                    <button
                      key={workflow.id}
                      type="button"
                      onClick={() => setSelectedWorkflowId(workflow.id)}
                      className={cn(
                        'w-full rounded-2xl border p-4 text-left transition-colors',
                        selectedWorkflowId === workflow.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{workflow.name}</div>
                        <Badge variant="secondary">{workflow.code}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {workflow.entity_type} · {workflow.nodes?.length ?? 0} nodes · {workflow.transitions?.length ?? 0} transitions
                      </div>
                    </button>
                  ))}
                  {workflows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No workflows yet. Create one from the builder above.
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {selectedWorkflow ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{selectedWorkflow.name}</CardTitle>
                        <Badge variant="secondary">{selectedWorkflow.code}</Badge>
                        <Badge variant="outline">{selectedWorkflow.entity_type}</Badge>
                        <Badge variant="outline">on {selectedWorkflow.trigger_event}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {selectedWorkflow.description || 'Use the workspace below to build nodes, committee approvals, and routing rules.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-xl border px-3 py-2">
                        <div className="font-semibold">{selectedWorkflow.entity_bindings?.length ?? 0}</div>
                        <div className="text-muted-foreground">Links</div>
                      </div>
                      <div className="rounded-xl border px-3 py-2">
                        <div className="font-semibold">{selectedNodes.length}</div>
                        <div className="text-muted-foreground">Nodes</div>
                      </div>
                      <div className="rounded-xl border px-3 py-2">
                        <div className="font-semibold">{selectedTransitions.length}</div>
                        <div className="text-muted-foreground">Routes</div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <Tabs value={studioTab} onValueChange={setStudioTab} className="rounded-2xl border bg-card p-2 shadow-sm">
                <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent p-0">
                  <TabsTrigger className="rounded-xl px-4 py-2.5" value="workflow">Workflow</TabsTrigger>
                  <TabsTrigger className="rounded-xl px-4 py-2.5" value="departments">Departments</TabsTrigger>
                  <TabsTrigger className="rounded-xl px-4 py-2.5" value="nodes">Nodes</TabsTrigger>
                  <TabsTrigger className="rounded-xl px-4 py-2.5" value="transitions">Transitions</TabsTrigger>
                  <TabsTrigger className="rounded-xl px-4 py-2.5" value="roles">Roles & Committees</TabsTrigger>
                  <TabsTrigger className="rounded-xl px-4 py-2.5" value="conditions">Conditions</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className={cn('grid gap-6', studioTab === 'workflow' ? '2xl:grid-cols-[minmax(0,1.1fr)_420px]' : 'grid-cols-1', !['workflow', 'nodes', 'transitions'].includes(studioTab) && 'hidden')}>
                <div className={cn('space-y-6', studioTab !== 'workflow' && 'hidden')}>
                  <Card>
                    <CardHeader>
                      <CardTitle>Workflow Map</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {selectedNodes.length === 0 ? (
                          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No nodes yet. Add a start node, then approval or review nodes, then connect them with transitions.
                          </div>
                        ) : (
                          selectedNodes.map((node, index) => {
                            const outgoing = selectedTransitions.filter((transition) => transition.from_node === node.id);
                            return (
                              <div key={node.id} className="space-y-3">
                                <div className="rounded-2xl border bg-background p-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={node.is_initial ? 'default' : 'outline'}>{node.node_type}</Badge>
                                    <div className="font-medium">{node.step_order}. {node.name}</div>
                                    <div className="text-xs text-muted-foreground">{node.code}</div>
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm">
                                    <div>
                                      <div className="text-muted-foreground">Approver</div>
                                      <div>{node.approval_group_name || node.assigned_user_name || 'System / unassigned'}</div>
                                    </div>
                                    <div>
                                      <div className="text-muted-foreground">Approval Rule</div>
                                      <div>{node.approval_mode} · require {node.required_approvals}</div>
                                    </div>
                                    <div>
                                      <div className="text-muted-foreground">Filter</div>
                                      <div>{node.cost_center || 'All'} · {node.min_amount} to {node.max_amount ?? 'No limit'}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 text-xs text-muted-foreground">
                                    Entry: {node.entry_action || 'none'} · Exit: {node.exit_action || 'none'} · SLA: {node.sla_hours}h
                                  </div>
                                </div>

                                {outgoing.length > 0 ? (
                                  <div className="pl-6">
                                    {outgoing.map((transition) => (
                                      <div key={transition.id} className="flex items-start gap-3 py-1 text-sm">
                                        <div className="mt-1 h-8 w-px bg-border" />
                                        <div className="rounded-xl border bg-muted/40 px-3 py-2">
                                          <div className="font-medium">{transition.name}</div>
                                          <div className="text-xs text-muted-foreground">
                                            {transition.decision || transition.transition_key} to {transition.to_node_name || 'Unknown'}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {transition.condition_operator === 'always'
                                              ? 'Always'
                                              : `${transition.condition_field || 'field'} ${transition.condition_operator} ${transition.condition_value || '-'}`}
                                            {transition.is_default ? ' · default' : ''}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : index < selectedNodes.length - 1 ? (
                                  <div className="pl-6 text-xs text-muted-foreground">No route defined from this node yet.</div>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={cn(studioTab !== 'workflow' && 'hidden')}>
                    <CardContent className="pt-6">
                      <Tabs defaultValue="bindings" className="space-y-4">
                        <TabsList>
                          <TabsTrigger value="bindings">Model Links</TabsTrigger>
                          <TabsTrigger value="nodes">Nodes</TabsTrigger>
                          <TabsTrigger value="transitions">Transitions</TabsTrigger>
                          <TabsTrigger value="legacy">Legacy Steps</TabsTrigger>
                        </TabsList>

                        <TabsContent value="bindings">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Model</TableHead>
                                <TableHead>Module</TableHead>
                                <TableHead>Triggers</TableHead>
                                <TableHead>Route/API</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(selectedWorkflow.entity_bindings ?? []).map((binding) => (
                                <TableRow key={binding.id}>
                                  <TableCell>
                                    <div className="font-medium">{binding.entity_label}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {binding.entity_type}{binding.is_primary ? ' · primary' : ''}
                                    </div>
                                  </TableCell>
                                  <TableCell>{binding.module_slug}</TableCell>
                                  <TableCell>{binding.trigger_events.join(', ') || 'None'}</TableCell>
                                  <TableCell>
                                    <div>{binding.route_path || 'No route'}</div>
                                    <div className="text-xs text-muted-foreground">{binding.api_base_path || 'No API path'}</div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TabsContent>

                        <TabsContent value="nodes">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Node</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Rules</TableHead>
                                <TableHead>Triggers</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedNodes.map((node) => (
                                <TableRow key={node.id}>
                                  <TableCell>
                                    <div className="font-medium">{node.step_order}. {node.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {node.code}{node.is_initial ? ' · initial' : ''}{node.is_active ? '' : ' · inactive'}
                                    </div>
                                  </TableCell>
                                  <TableCell>{node.node_type}</TableCell>
                                  <TableCell>
                                    <div>{node.approval_group_name || node.assigned_user_name || 'System / unassigned'}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {node.approval_mode} · need {node.required_approvals}
                                    </div>
                                  </TableCell>
                                  <TableCell>{node.cost_center || 'All'} · {node.min_amount} to {node.max_amount ?? 'No limit'}</TableCell>
                                  <TableCell>{node.entry_action || 'no-entry-trigger'} / {node.exit_action || 'no-exit-trigger'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TabsContent>

                        <TabsContent value="transitions">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Route</TableHead>
                                <TableHead>Decision</TableHead>
                                <TableHead>Condition</TableHead>
                                <TableHead>Priority</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedTransitions.map((transition) => (
                                <TableRow key={transition.id}>
                                  <TableCell>
                                    <div className="font-medium">{transition.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {transition.from_node_name || 'Unknown'} to {transition.to_node_name || 'Unknown'}
                                    </div>
                                  </TableCell>
                                  <TableCell>{transition.decision || transition.transition_key}</TableCell>
                                  <TableCell>
                                    {transition.condition_operator === 'always'
                                      ? 'Always'
                                      : `${transition.condition_field || 'field'} ${transition.condition_operator} ${transition.condition_value || '-'}`}
                                    {transition.is_default ? ' · default' : ''}
                                  </TableCell>
                                  <TableCell>{transition.priority}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TabsContent>

                        <TabsContent value="legacy">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Step</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Cost Center</TableHead>
                                <TableHead>Amount Range</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedSteps.map((step) => (
                                <TableRow key={step.id}>
                                  <TableCell>{step.step_order}. {step.name}</TableCell>
                                  <TableCell>{step.approval_group_name || 'Unassigned'}</TableCell>
                                  <TableCell>{step.cost_center || 'All'}</TableCell>
                                  <TableCell>{step.min_amount} to {step.max_amount ?? 'No limit'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-6">
                  <Card className={cn(studioTab !== 'workflow' && 'hidden')}>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Link2 className="h-5 w-5 text-primary" />
                        <CardTitle>Link ERP Model</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Module</Label>
                        <Select value={bindingForm.module_slug} onValueChange={(value) => setBindingForm({ ...bindingForm, module_slug: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {moduleSlugOptions.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Entity Type</Label>
                        <Input value={bindingForm.entity_type} onChange={(e) => setBindingForm({ ...bindingForm, entity_type: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Entity Label</Label>
                        <Input value={bindingForm.entity_label} onChange={(e) => setBindingForm({ ...bindingForm, entity_label: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Trigger Events</Label>
                        <Input value={bindingForm.trigger_events} onChange={(e) => setBindingForm({ ...bindingForm, trigger_events: e.target.value })} placeholder="submit,approve,reject" />
                      </div>
                      <div className="space-y-2">
                        <Label>Route Path</Label>
                        <Input value={bindingForm.route_path} onChange={(e) => setBindingForm({ ...bindingForm, route_path: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>API Base Path</Label>
                        <Input value={bindingForm.api_base_path} onChange={(e) => setBindingForm({ ...bindingForm, api_base_path: e.target.value })} />
                      </div>
                      <div className="flex items-center justify-between rounded-xl border p-4">
                        <Label>Primary Binding</Label>
                        <Switch checked={bindingForm.is_primary} onCheckedChange={(value) => setBindingForm({ ...bindingForm, is_primary: value })} />
                      </div>
                      <Button className="w-full" onClick={() => createBinding.mutate()} disabled={createBinding.isPending || !bindingForm.workflow || !bindingForm.entity_type || !bindingForm.entity_label}>
                        Save Model Link
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className={cn(studioTab !== 'nodes' && 'hidden')}>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Workflow className="h-5 w-5 text-primary" />
                        <CardTitle>Add Node</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Code</Label>
                          <Input value={nodeForm.code} onChange={(e) => setNodeForm({ ...nodeForm, code: e.target.value })} placeholder="finance-approval" />
                        </div>
                        <div className="space-y-2">
                          <Label>Name</Label>
                          <Input value={nodeForm.name} onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })} placeholder="Finance Approval" />
                        </div>
                        <div className="space-y-2">
                          <Label>Node Type</Label>
                          <Select value={nodeForm.node_type} onValueChange={(value) => setNodeForm({ ...nodeForm, node_type: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {nodeTypeOptions.map((option) => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Step Order</Label>
                          <Input value={nodeForm.step_order} onChange={(e) => setNodeForm({ ...nodeForm, step_order: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>Approval Role</Label>
                          <Select value={nodeForm.approval_group} onValueChange={(value) => setNodeForm({ ...nodeForm, approval_group: value })}>
                            <SelectTrigger><SelectValue placeholder="Optional role routing" /></SelectTrigger>
                            <SelectContent>
                              {groups.map((group) => (
                                <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Approval Mode</Label>
                          <Select value={nodeForm.approval_mode} onValueChange={(value) => setNodeForm({ ...nodeForm, approval_mode: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {approvalModeOptions.map((option) => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Required Approvals</Label>
                          <Input value={nodeForm.required_approvals} onChange={(e) => setNodeForm({ ...nodeForm, required_approvals: e.target.value })} placeholder="1" />
                        </div>
                        <div className="space-y-2">
                          <Label>Cost Center</Label>
                          <Input value={nodeForm.cost_center} onChange={(e) => setNodeForm({ ...nodeForm, cost_center: e.target.value })} placeholder="Optional filter" />
                        </div>
                        <div className="space-y-2">
                          <Label>Minimum Amount</Label>
                          <Input value={nodeForm.min_amount} onChange={(e) => setNodeForm({ ...nodeForm, min_amount: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>Maximum Amount</Label>
                          <Input value={nodeForm.max_amount} onChange={(e) => setNodeForm({ ...nodeForm, max_amount: e.target.value })} placeholder="Blank means open-ended" />
                        </div>
                        <div className="space-y-2">
                          <Label>Entry Action / Trigger</Label>
                          <Input value={nodeForm.entry_action} onChange={(e) => setNodeForm({ ...nodeForm, entry_action: e.target.value })} placeholder="notify_dashboard" />
                        </div>
                        <div className="space-y-2">
                          <Label>Exit Action / Trigger</Label>
                          <Input value={nodeForm.exit_action} onChange={(e) => setNodeForm({ ...nodeForm, exit_action: e.target.value })} placeholder="create_commitment" />
                        </div>
                        <div className="space-y-2">
                          <Label>SLA Hours</Label>
                          <Input value={nodeForm.sla_hours} onChange={(e) => setNodeForm({ ...nodeForm, sla_hours: e.target.value })} />
                        </div>
                      </div>
                      <div className="grid gap-3 rounded-xl border p-4">
                        <div className="flex items-center justify-between">
                          <Label>Initial Node</Label>
                          <Switch checked={nodeForm.is_initial} onCheckedChange={(value) => setNodeForm({ ...nodeForm, is_initial: value })} />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label>Dashboard Notification</Label>
                          <Switch checked={nodeForm.notify_dashboard} onCheckedChange={(value) => setNodeForm({ ...nodeForm, notify_dashboard: value })} />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label>Quick Actions</Label>
                          <Switch checked={nodeForm.allow_quick_action} onCheckedChange={(value) => setNodeForm({ ...nodeForm, allow_quick_action: value })} />
                        </div>
                      </div>
                      <Button className="w-full" onClick={() => createNode.mutate()} disabled={createNode.isPending || !nodeForm.workflow || !nodeForm.code || !nodeForm.name}>
                        Save Node
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className={cn(studioTab !== 'transitions' && 'hidden')}>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Route className="h-5 w-5 text-primary" />
                        <CardTitle>Add Transition</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input value={transitionForm.name} onChange={(e) => setTransitionForm({ ...transitionForm, name: e.target.value })} placeholder="Finance approves and routes to admin" />
                      </div>
                      <div className="space-y-2">
                        <Label>Transition Key</Label>
                        <Input value={transitionForm.transition_key} onChange={(e) => setTransitionForm({ ...transitionForm, transition_key: e.target.value })} placeholder="approve-to-admin" />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>From Node</Label>
                          <Select value={transitionForm.from_node} onValueChange={(value) => setTransitionForm({ ...transitionForm, from_node: value })}>
                            <SelectTrigger><SelectValue placeholder="Choose source node" /></SelectTrigger>
                            <SelectContent>
                              {selectedNodes.map((node) => (
                                <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>To Node</Label>
                          <Select value={transitionForm.to_node} onValueChange={(value) => setTransitionForm({ ...transitionForm, to_node: value })}>
                            <SelectTrigger><SelectValue placeholder="Choose target node" /></SelectTrigger>
                            <SelectContent>
                              {selectedNodes.map((node) => (
                                <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Decision</Label>
                          <Input value={transitionForm.decision} onChange={(e) => setTransitionForm({ ...transitionForm, decision: e.target.value })} placeholder="approve / reject / submit" />
                        </div>
                        <div className="space-y-2">
                          <Label>Priority</Label>
                          <Input value={transitionForm.priority} onChange={(e) => setTransitionForm({ ...transitionForm, priority: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>Condition Field</Label>
                          <Select value={transitionForm.condition_field} onValueChange={(value) => setTransitionForm({ ...transitionForm, condition_field: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {conditionFieldOptions.map((option) => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Operator</Label>
                          <Select value={transitionForm.condition_operator} onValueChange={(value) => setTransitionForm({ ...transitionForm, condition_operator: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {operatorOptions.map((option) => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Condition Value</Label>
                        <Input value={transitionForm.condition_value} onChange={(e) => setTransitionForm({ ...transitionForm, condition_value: e.target.value })} placeholder="5000.01 or FINANCE" />
                      </div>
                      <div className="flex items-center justify-between rounded-xl border p-4">
                        <Label>Default Route</Label>
                        <Switch checked={transitionForm.is_default} onCheckedChange={(value) => setTransitionForm({ ...transitionForm, is_default: value })} />
                      </div>
                      <Button className="w-full" onClick={() => createTransition.mutate()} disabled={createTransition.isPending || !transitionForm.workflow || !transitionForm.name || !transitionForm.from_node || !transitionForm.to_node}>
                        Save Transition
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {studioTab === 'departments' ? (
                <Card>
                  <CardHeader>
                    <div className="flex flex-col gap-1">
                      <CardTitle>Workflow Departments</CardTitle>
                      <p className="text-sm text-muted-foreground">Use approval groups as the operational departments or committees that receive this workflow's work.</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border bg-muted/30 p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Workflow</div><div className="mt-1 font-semibold">{selectedWorkflow.name}</div></div>
                      <div className="rounded-2xl border bg-muted/30 p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Available departments</div><div className="mt-1 text-2xl font-semibold">{groups.length}</div></div>
                      <div className="rounded-2xl border bg-muted/30 p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Assigned nodes</div><div className="mt-1 text-2xl font-semibold">{selectedNodes.filter((node) => node.approval_group_name).length}</div></div>
                    </div>
                    <Table>
                      <TableHeader><TableRow><TableHead>Department / committee</TableHead><TableHead>Used by node</TableHead><TableHead>Approval model</TableHead><TableHead>Next setup step</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {groups.map((group) => {
                          const linkedNodes = selectedNodes.filter((node) => node.approval_group === group.id || node.approval_group_name === group.name);
                          return <TableRow key={group.id}><TableCell className="font-medium">{group.name}</TableCell><TableCell>{linkedNodes.length ? linkedNodes.map((node) => node.name).join(', ') : 'Not yet assigned'}</TableCell><TableCell>{linkedNodes.length ? linkedNodes.map((node) => node.approval_mode).join(', ') : 'Configure on a node'}</TableCell><TableCell className="text-muted-foreground">Assign this group from the Nodes tab</TableCell></TableRow>;
                        })}
                        {groups.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">No approval groups are available. Create roles or committees in Platform Admin, then return here to route a node to them.</TableCell></TableRow> : null}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}

              {studioTab === 'nodes' ? (
                <Card>
                  <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Approval Node Records</CardTitle><p className="mt-1 text-sm text-muted-foreground">Each row is a child record of {selectedWorkflow.name}. Define the responsible role, voting behavior, SLA and financial scope.</p></div><Button size="sm" onClick={() => setStudioTab('workflow')}>Add node</Button></div></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Node</TableHead><TableHead>Role / committee</TableHead><TableHead>Action rule</TableHead><TableHead>Next route</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {selectedNodes.map((node) => {
                          const next = selectedTransitions.filter((transition) => transition.from_node === node.id).map((transition) => transition.to_node_name || 'Unnamed node').join(', ');
                          return <TableRow key={node.id}><TableCell>{node.step_order}</TableCell><TableCell><div className="font-medium">{node.name}</div><div className="text-xs text-muted-foreground">{node.node_type}{node.is_initial ? ' · start node' : ''}</div></TableCell><TableCell>{node.approval_group_name || node.assigned_user_name || 'Unassigned'}</TableCell><TableCell>{node.approval_mode} · {node.required_approvals} required</TableCell><TableCell>{next || 'No transition yet'}</TableCell></TableRow>;
                        })}
                        {selectedNodes.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No nodes created. Use the Workflow tab to add the first approval node.</TableCell></TableRow> : null}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}

              {studioTab === 'transitions' ? (
                <Card>
                  <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Transition Records</CardTitle><p className="mt-1 text-sm text-muted-foreground">These child records decide where a document goes after an action. Use them for approve, reject, return and escalation paths.</p></div><Button size="sm" onClick={() => setStudioTab('workflow')}>Add transition</Button></div></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>From node</TableHead><TableHead>Decision</TableHead><TableHead>To node</TableHead><TableHead>Priority</TableHead><TableHead>Default</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {selectedTransitions.map((transition) => <TableRow key={transition.id}><TableCell>{transition.from_node_name || 'Unknown'}</TableCell><TableCell><div className="font-medium">{transition.name}</div><div className="text-xs text-muted-foreground">{transition.decision || transition.transition_key}</div></TableCell><TableCell>{transition.to_node_name || 'Unknown'}</TableCell><TableCell>{transition.priority}</TableCell><TableCell>{transition.is_default ? 'Yes' : 'No'}</TableCell></TableRow>)}
                        {selectedTransitions.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No transitions created. Use the Workflow tab to connect nodes.</TableCell></TableRow> : null}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}

              {studioTab === 'roles' ? (
                <Card>
                  <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Roles & Committee Assignments</CardTitle><p className="mt-1 text-sm text-muted-foreground">A role or committee can be reused by many workflows and can serve one or many nodes within this workflow.</p></div><Button size="sm" variant="outline" onClick={() => setStudioTab('workflow')}>Assign to node</Button></div></CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {groups.map((group) => {
                      const linkedNodes = selectedNodes.filter((node) => node.approval_group === group.id || node.approval_group_name === group.name);
                      return <div key={group.id} className="rounded-2xl border p-5"><div className="flex items-start justify-between gap-2"><div className="font-semibold">{group.name}</div><Badge variant={linkedNodes.length ? 'default' : 'outline'}>{linkedNodes.length ? 'In use' : 'Available'}</Badge></div><p className="mt-3 text-sm text-muted-foreground">{linkedNodes.length ? `Assigned to ${linkedNodes.map((node) => node.name).join(', ')}.` : 'Not assigned to a workflow node yet.'}</p><div className="mt-4 text-xs text-muted-foreground">Manage membership under Platform Admin roles, then select it on an approval node.</div></div>;
                    })}
                    {groups.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No roles or committees are available for this tenant.</div> : null}
                  </CardContent>
                </Card>
              ) : null}

              {studioTab === 'conditions' ? (
                <Card>
                  <CardHeader><CardTitle>Conditional Routing</CardTitle><p className="text-sm text-muted-foreground">Conditions are held on transitions, so every route remains transparent and auditable against the document data.</p></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Route</TableHead><TableHead>Rule</TableHead><TableHead>Result</TableHead><TableHead>Fallback</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {selectedTransitions.map((transition) => <TableRow key={transition.id}><TableCell>{transition.from_node_name || 'Unknown'} <ArrowRight className="mx-2 inline h-3.5 w-3.5" /> {transition.to_node_name || 'Unknown'}</TableCell><TableCell>{transition.condition_operator === 'always' ? 'Always run' : `${transition.condition_field || 'field'} ${transition.condition_operator} ${transition.condition_value || '-'}`}</TableCell><TableCell>{transition.decision || transition.transition_key}</TableCell><TableCell>{transition.is_default ? 'Default path' : 'Conditional path'}</TableCell></TableRow>)}
                        {selectedTransitions.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">No conditions defined. Add transitions first, then configure their field rules on the Workflow tab.</TableCell></TableRow> : null}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <div className="space-y-6">
              <Card className="overflow-hidden border-primary/25">
                <CardHeader className="border-b bg-primary/5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><CircleDot className="h-4 w-4" /> Selected ERP record</div>
                      <CardTitle className="text-2xl">{selectedCatalogEntity.label}</CardTitle>
                      <p className="text-sm text-muted-foreground">{selectedCatalogEntity.module} · {selectedCatalogEntity.routePath}</p>
                    </div>
                    <Badge variant="outline">Triggers on {selectedCatalogEntity.trigger}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_290px]">
                  <div className="space-y-5">
                    <div>
                      <h2 className="font-semibold">Approval route preview</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Create this workflow to open the live design canvas, add role-based nodes, and define the route between them.</p>
                    </div>
                    <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
                      {[
                        ['Document submitted', 'The record is ready for approval.'],
                        ['Role review', 'A selected role, group, or committee acts.'],
                        ['Approved or returned', 'The next route or final document action applies.'],
                      ].map(([title, description], index) => (
                        <div key={title} className="flex flex-1 items-center gap-3 rounded-2xl border bg-background p-4">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{index + 1}</div>
                          <div><div className="font-medium">{title}</div><div className="text-xs leading-5 text-muted-foreground">{description}</div></div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-dashed bg-muted/20 p-4 text-sm">
                      <div className="flex items-center gap-2 font-medium"><Send className="h-4 w-4 text-primary" /> Document action</div>
                      <p className="mt-1 text-muted-foreground">Once linked, users see <span className="font-medium text-foreground">Forward for approval</span> on the {selectedCatalogEntity.label} record. Their action opens the first eligible approval node and puts the task in the approver inbox.</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-muted/25 p-5">
                    <ShieldCheck className="h-7 w-7 text-primary" />
                    <h3 className="mt-4 font-semibold">Ready to build</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">The form at left is prefilled for this ERP record. Save it, then configure its nodes and transitions here.</p>
                    <div className="mt-5 space-y-2 text-sm">
                      <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Entity</span><span className="font-medium">{selectedCatalogEntity.entityType}</span></div>
                      <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Module</span><span className="font-medium">{selectedCatalogEntity.module}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Default trigger</span><span className="font-medium">{selectedCatalogEntity.trigger}</span></div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>How the live designer works</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3 text-sm">
                  <div className="rounded-xl border p-4"><div className="font-medium">1. Bind the model</div><p className="mt-1 text-muted-foreground">Connect the workflow to its ERP screen and API so the document action is available in context.</p></div>
                  <div className="rounded-xl border p-4"><div className="font-medium">2. Add approver nodes</div><p className="mt-1 text-muted-foreground">Set a responsible role or committee, voting mode, amount limit, SLA and dashboard notification.</p></div>
                  <div className="rounded-xl border p-4"><div className="font-medium">3. Draw the decisions</div><p className="mt-1 text-muted-foreground">Connect nodes with approve, reject and conditional routes. The workflow map remains the operational source of truth.</p></div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
