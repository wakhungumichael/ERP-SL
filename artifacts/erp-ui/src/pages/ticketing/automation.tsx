import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/use-auth';
import { toast } from '@/hooks/use-toast';

type RoutingRule = {
  id: number;
  name: string;
  priority: number;
  conditions: Record<string, string>;
  target_status: string;
  is_active: boolean;
  assign_to_name?: string;
};

type WebhookEndpoint = {
  id: number;
  name: string;
  target_url: string;
  signing_secret: string;
  subscribed_events: string[];
  is_active: boolean;
  last_status_code: number | null;
};

const EVENT_OPTIONS = [
  { value: 'ticket.created', label: 'Ticket created' },
  { value: 'ticket.status_changed', label: 'Status changed' },
  { value: 'ticket.replied', label: 'Agent replied' },
];

async function request(token: string, path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || 'Request failed');
  return data;
}

export default function TicketingAutomation() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [ruleForm, setRuleForm] = useState({
    name: '',
    priority: '100',
    category: 'billing',
    priorityMatch: 'urgent',
    sourcePage: '',
    subjectContains: '',
    targetStatus: 'open',
    isActive: true,
  });
  const [webhookForm, setWebhookForm] = useState({
    name: '',
    targetUrl: '',
    subscribedEvents: ['ticket.created', 'ticket.status_changed'],
    isActive: true,
  });

  const { data: rules } = useQuery<RoutingRule[]>({
    queryKey: ['ticketing-rules'],
    enabled: !!token,
    queryFn: () => request(token!, '/api/ticketing/routing-rules/'),
  });

  const { data: webhooks } = useQuery<WebhookEndpoint[]>({
    queryKey: ['ticketing-webhooks'],
    enabled: !!token,
    queryFn: () => request(token!, '/api/ticketing/webhooks/'),
  });

  const activeRuleCount = useMemo(() => (rules ?? []).filter((rule) => rule.is_active).length, [rules]);
  const activeWebhookCount = useMemo(() => (webhooks ?? []).filter((webhook) => webhook.is_active).length, [webhooks]);

  const createRule = useMutation({
    mutationFn: async () => {
      const conditions: Record<string, string> = {};
      if (ruleForm.category !== 'any') conditions.category = ruleForm.category;
      if (ruleForm.priorityMatch !== 'any') conditions.priority = ruleForm.priorityMatch;
      if (ruleForm.sourcePage.trim()) conditions.source_page = ruleForm.sourcePage.trim();
      if (ruleForm.subjectContains.trim()) conditions.subject_contains = ruleForm.subjectContains.trim();
      return request(token!, '/api/ticketing/routing-rules/', {
        method: 'POST',
        body: JSON.stringify({
          name: ruleForm.name.trim(),
          priority: Number(ruleForm.priority || 100),
          conditions,
          target_status: ruleForm.targetStatus,
          is_active: ruleForm.isActive,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-rules'] });
      setRuleForm({
        name: '',
        priority: '100',
        category: 'billing',
        priorityMatch: 'urgent',
        sourcePage: '',
        subjectContains: '',
        targetStatus: 'open',
        isActive: true,
      });
      toast({ title: 'Routing rule created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not create rule', description: error.message, variant: 'destructive' });
    },
  });

  const deleteRule = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ticketing/routing-rules/${id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete rule');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-rules'] });
      toast({ title: 'Routing rule deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not delete rule', description: error.message, variant: 'destructive' });
    },
  });

  const createWebhook = useMutation({
    mutationFn: async () => request(token!, '/api/ticketing/webhooks/', {
      method: 'POST',
      body: JSON.stringify({
        name: webhookForm.name.trim(),
        target_url: webhookForm.targetUrl.trim(),
        subscribed_events: webhookForm.subscribedEvents,
        is_active: webhookForm.isActive,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-webhooks'] });
      setWebhookForm({
        name: '',
        targetUrl: '',
        subscribedEvents: ['ticket.created', 'ticket.status_changed'],
        isActive: true,
      });
      toast({ title: 'Webhook created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not create webhook', description: error.message, variant: 'destructive' });
    },
  });

  const deleteWebhook = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ticketing/webhooks/${id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete webhook');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-webhooks'] });
      toast({ title: 'Webhook deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not delete webhook', description: error.message, variant: 'destructive' });
    },
  });

  function toggleEvent(eventName: string, checked: boolean) {
    setWebhookForm((current) => ({
      ...current,
      subscribedEvents: checked
        ? Array.from(new Set([...current.subscribedEvents, eventName]))
        : current.subscribedEvents.filter((item) => item !== eventName),
    }));
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Automation Flow</h1>
        <p className="mt-1 text-sm text-muted-foreground">Describe business rules in plain terms and wire outbound updates for downstream systems.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Automation Journey</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 1</div>
              <div className="mt-2 font-medium">Detect the ticket pattern</div>
              <p className="mt-1 text-sm text-muted-foreground">Match by category, urgency, page, or subject keywords.</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 2</div>
              <div className="mt-2 font-medium">Set the operational path</div>
              <p className="mt-1 text-sm text-muted-foreground">Move matching cases into the right working status.</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 3</div>
              <div className="mt-2 font-medium">Notify downstream systems</div>
              <p className="mt-1 text-sm text-muted-foreground">Send key ticket events to Slack, BI, or other apps.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
          <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Routing rules</div><div className="mt-2 text-xl font-semibold">{(rules ?? []).length}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Active rules</div><div className="mt-2 text-xl font-semibold">{activeRuleCount}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Live webhooks</div><div className="mt-2 text-xl font-semibold">{activeWebhookCount}</div></CardContent></Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Routing Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rule-name">Rule name</Label>
                <Input id="rule-name" value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} placeholder="Urgent Billing Queue" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-priority">Evaluation order</Label>
                <Input id="rule-priority" value={ruleForm.priority} onChange={(event) => setRuleForm((current) => ({ ...current, priority: event.target.value }))} placeholder="100" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Ticket category</Label>
                <Select value={ruleForm.category} onValueChange={(value) => setRuleForm((current) => ({ ...current, category: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any category</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority match</Label>
                <Select value={ruleForm.priorityMatch} onValueChange={(value) => setRuleForm((current) => ({ ...current, priorityMatch: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any priority</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="source-page">Source page contains</Label>
                <Input id="source-page" value={ruleForm.sourcePage} onChange={(event) => setRuleForm((current) => ({ ...current, sourcePage: event.target.value }))} placeholder="/billing/invoices" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject-keywords">Subject contains</Label>
                <Input id="subject-keywords" value={ruleForm.subjectContains} onChange={(event) => setRuleForm((current) => ({ ...current, subjectContains: event.target.value }))} placeholder="invoice, receipt, branch" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Move matching tickets to</Label>
              <Select value={ruleForm.targetStatus} onValueChange={(value) => setRuleForm((current) => ({ ...current, targetStatus: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-4">
              <div>
                <div className="font-medium">Rule is active</div>
                <p className="text-sm text-muted-foreground">Only active rules participate when a ticket is created.</p>
              </div>
              <Switch checked={ruleForm.isActive} onCheckedChange={(value) => setRuleForm((current) => ({ ...current, isActive: value }))} />
            </div>

            <Button onClick={() => createRule.mutate()} disabled={!ruleForm.name.trim() || createRule.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              {createRule.isPending ? 'Saving...' : 'Create Rule'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Webhook Endpoint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-name">Destination name</Label>
              <Input id="webhook-name" value={webhookForm.name} onChange={(event) => setWebhookForm((current) => ({ ...current, name: event.target.value }))} placeholder="Support Slack Bridge" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Target URL</Label>
              <Input id="webhook-url" value={webhookForm.targetUrl} onChange={(event) => setWebhookForm((current) => ({ ...current, targetUrl: event.target.value }))} placeholder="https://example.com/hooks/support" />
            </div>

            <div className="space-y-3 rounded-xl border p-4">
              <div className="font-medium">Send these events</div>
              {EVENT_OPTIONS.map((eventOption) => (
                <label key={eventOption.value} className="flex items-center gap-3">
                  <Checkbox
                    checked={webhookForm.subscribedEvents.includes(eventOption.value)}
                    onCheckedChange={(checked) => toggleEvent(eventOption.value, Boolean(checked))}
                  />
                  <span className="text-sm">{eventOption.label}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl border p-4">
              <div>
                <div className="font-medium">Webhook is active</div>
                <p className="text-sm text-muted-foreground">Keep the endpoint ready to receive new ticket events.</p>
              </div>
              <Switch checked={webhookForm.isActive} onCheckedChange={(value) => setWebhookForm((current) => ({ ...current, isActive: value }))} />
            </div>

            <Button onClick={() => createWebhook.mutate()} disabled={!webhookForm.name.trim() || !webhookForm.targetUrl.trim() || !webhookForm.subscribedEvents.length || createWebhook.isPending}>
              <Save className="mr-1 h-4 w-4" />
              {createWebhook.isPending ? 'Saving...' : 'Create Webhook'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Routing Rules</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(rules ?? []).length === 0 ? (
              <div className="text-muted-foreground">No routing rules yet.</div>
            ) : (
              (rules ?? []).map((rule) => (
                <div key={rule.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{rule.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Runs in order {rule.priority} and moves matching tickets to {rule.target_status || 'their current status'}.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={rule.is_active ? 'default' : 'outline'}>{rule.is_active ? 'Active' : 'Inactive'}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => deleteRule.mutate(rule.id)} disabled={deleteRule.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(rule.conditions ?? {}).length ? Object.entries(rule.conditions).map(([key, value]) => (
                      <Badge key={`${rule.id}-${key}`} variant="secondary">{key.replaceAll('_', ' ')}: {value}</Badge>
                    )) : <Badge variant="secondary">Applies to all tickets</Badge>}
                  </div>
                  {rule.assign_to_name ? <div className="mt-3 text-xs text-muted-foreground">Assigned to: {rule.assign_to_name}</div> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Webhook Endpoints</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(webhooks ?? []).length === 0 ? (
              <div className="text-muted-foreground">No webhook destinations configured yet.</div>
            ) : (
              (webhooks ?? []).map((webhook) => (
                <div key={webhook.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{webhook.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{webhook.target_url}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={webhook.is_active ? 'default' : 'outline'}>{webhook.is_active ? 'Active' : 'Inactive'}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => deleteWebhook.mutate(webhook.id)} disabled={deleteWebhook.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(webhook.subscribed_events ?? []).map((eventName) => (
                      <Badge key={`${webhook.id}-${eventName}`} variant="secondary">{eventName}</Badge>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Zap className="h-3.5 w-3.5" />
                    Last delivery status: {webhook.last_status_code ?? 'No deliveries yet'}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
