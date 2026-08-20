import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';

type RoutingRule = {
  id: number;
  name: string;
  priority: number;
  conditions: Record<string, unknown>;
  target_status: string;
  is_active: boolean;
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
    conditionsText: JSON.stringify({ category: 'billing', priority: 'urgent' }, null, 2),
    targetStatus: 'open',
    isActive: true,
  });
  const [webhookForm, setWebhookForm] = useState({
    name: '',
    targetUrl: '',
    subscribedEvents: 'ticket.created, ticket.status_changed',
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

  const createRule = useMutation({
    mutationFn: async () => request(token!, '/api/ticketing/routing-rules/', {
      method: 'POST',
      body: JSON.stringify({
        name: ruleForm.name,
        priority: Number(ruleForm.priority || 100),
        conditions: JSON.parse(ruleForm.conditionsText),
        target_status: ruleForm.targetStatus,
        is_active: ruleForm.isActive,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-rules'] });
      setRuleForm({
        name: '',
        priority: '100',
        conditionsText: JSON.stringify({ category: 'billing', priority: 'urgent' }, null, 2),
        targetStatus: 'open',
        isActive: true,
      });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticketing-rules'] }),
  });

  const createWebhook = useMutation({
    mutationFn: async () => request(token!, '/api/ticketing/webhooks/', {
      method: 'POST',
      body: JSON.stringify({
        name: webhookForm.name,
        target_url: webhookForm.targetUrl,
        subscribed_events: webhookForm.subscribedEvents.split(',').map((entry) => entry.trim()).filter(Boolean),
        is_active: webhookForm.isActive,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-webhooks'] });
      setWebhookForm({
        name: '',
        targetUrl: '',
        subscribedEvents: 'ticket.created, ticket.status_changed',
        isActive: true,
      });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticketing-webhooks'] }),
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Automation</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure routing decisions and webhook fan-out for external systems.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Routing Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rule-name">Rule Name</Label>
                <Input id="rule-name" value={ruleForm.name} onChange={(e) => setRuleForm((current) => ({ ...current, name: e.target.value }))} placeholder="Urgent Billing Queue" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-priority">Priority</Label>
                <Input id="rule-priority" value={ruleForm.priority} onChange={(e) => setRuleForm((current) => ({ ...current, priority: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-status">Target Status</Label>
              <Input id="rule-status" value={ruleForm.targetStatus} onChange={(e) => setRuleForm((current) => ({ ...current, targetStatus: e.target.value }))} placeholder="open" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-conditions">Conditions JSON</Label>
              <Textarea id="rule-conditions" rows={8} className="font-mono text-xs" value={ruleForm.conditionsText} onChange={(e) => setRuleForm((current) => ({ ...current, conditionsText: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium">Rule Active</div>
                <div className="text-sm text-muted-foreground">Only active rules participate in ticket routing.</div>
              </div>
              <Switch checked={ruleForm.isActive} onCheckedChange={(value) => setRuleForm((current) => ({ ...current, isActive: value }))} />
            </div>
            <Button onClick={() => createRule.mutate()} disabled={!ruleForm.name.trim() || createRule.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              {createRule.isPending ? 'Saving…' : 'Create Rule'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Webhook Endpoint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-name">Name</Label>
              <Input id="webhook-name" value={webhookForm.name} onChange={(e) => setWebhookForm((current) => ({ ...current, name: e.target.value }))} placeholder="Support Slack Bridge" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Target URL</Label>
              <Input id="webhook-url" value={webhookForm.targetUrl} onChange={(e) => setWebhookForm((current) => ({ ...current, targetUrl: e.target.value }))} placeholder="https://example.com/hooks/support" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-events">Subscribed Events</Label>
              <Input id="webhook-events" value={webhookForm.subscribedEvents} onChange={(e) => setWebhookForm((current) => ({ ...current, subscribedEvents: e.target.value }))} placeholder="ticket.created, ticket.status_changed" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium">Endpoint Active</div>
                <div className="text-sm text-muted-foreground">Inactive endpoints will keep their config but stop receiving events.</div>
              </div>
              <Switch checked={webhookForm.isActive} onCheckedChange={(value) => setWebhookForm((current) => ({ ...current, isActive: value }))} />
            </div>
            <Button onClick={() => createWebhook.mutate()} disabled={!webhookForm.name.trim() || !webhookForm.targetUrl.trim() || createWebhook.isPending}>
              <Save className="mr-1 h-4 w-4" />
              {createWebhook.isPending ? 'Saving…' : 'Create Webhook'}
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
                <div key={rule.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{rule.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Priority {rule.priority} → {rule.target_status || 'unchanged status'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={rule.is_active ? 'default' : 'outline'}>{rule.is_active ? 'Active' : 'Inactive'}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => deleteRule.mutate(rule.id)} disabled={deleteRule.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(rule.conditions, null, 2)}</pre>
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
                <div key={webhook.id} className="rounded-lg border p-3">
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
                  <div className="mt-3 text-xs text-muted-foreground">
                    Events: {(webhook.subscribed_events ?? []).join(', ') || 'all configured events'}{webhook.last_status_code ? ` • Last status ${webhook.last_status_code}` : ''}
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
