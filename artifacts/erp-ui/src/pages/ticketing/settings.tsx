import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { EyeOff, KeyRound } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';

async function authed(token: string, path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}

export default function TicketingSettings() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [allowedDomains, setAllowedDomains] = useState('');
  const [portalAccessPolicy, setPortalAccessPolicy] = useState('email_match');
  const [brandSettingsText, setBrandSettingsText] = useState('{\n  "brand_color": "#0f766e",\n  "logo_url": "",\n  "support_email": ""\n}');
  const [widgetSettingsText, setWidgetSettingsText] = useState('{\n  "headline": "How can we help?",\n  "submit_label": "Create ticket"\n}');
  const [keyType, setKeyType] = useState<'public' | 'secret'>('public');
  const [newKeyName, setNewKeyName] = useState('');
  const [issuedToken, setIssuedToken] = useState('');

  const { data: config } = useQuery({
    queryKey: ['ticketing-config'],
    enabled: !!token,
    queryFn: () => authed(token!, '/api/ticketing/config/'),
  });
  const { data: keys } = useQuery({
    queryKey: ['ticketing-keys'],
    enabled: !!token,
    queryFn: () => authed(token!, '/api/ticketing/keys/'),
  });

  useEffect(() => {
    if (config) {
      setAllowedDomains((config.allowed_domains ?? []).join(', '));
      setPortalAccessPolicy(config.portal_access_policy ?? 'email_match');
      setBrandSettingsText(JSON.stringify(config.brand_settings ?? {}, null, 2));
      setWidgetSettingsText(JSON.stringify(config.widget_settings ?? {}, null, 2));
    }
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: () => authed(token!, '/api/ticketing/config/', {
      method: 'PATCH',
      body: JSON.stringify({
        allowed_domains: allowedDomains.split(',').map((entry) => entry.trim()).filter(Boolean),
        portal_access_policy: portalAccessPolicy,
        brand_settings: JSON.parse(brandSettingsText),
        widget_settings: JSON.parse(widgetSettingsText),
        require_cors_origin: config?.require_cors_origin ?? true,
        allow_anonymous_tracking: config?.allow_anonymous_tracking ?? true,
        allow_requester_close: config?.allow_requester_close ?? true,
      }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticketing-config'] }),
  });

  const createPublicKey = useMutation({
    mutationFn: () => authed(token!, '/api/ticketing/keys/', {
      method: 'POST',
      body: JSON.stringify({ name: newKeyName || `${keyType === 'public' ? 'Public' : 'Secret'} Key ${Date.now()}`, key_type: keyType }),
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['ticketing-keys'] });
      setIssuedToken(result.raw_token ?? '');
      setNewKeyName('');
    },
  });

  const revokeKey = useMutation({
    mutationFn: (keyId: number) => authed(token!, `/api/ticketing/keys/${keyId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ revoke: true }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticketing-keys'] }),
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ticketing Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage domain allowlists, portal behavior, and integration credentials.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Tenant Controls</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Allowed Domains</Label>
              <Input
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="https://app.example.com, https://support.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-policy">Portal Access Policy</Label>
              <Input id="portal-policy" value={portalAccessPolicy} onChange={(e) => setPortalAccessPolicy(e.target.value)} placeholder="email_match, secure_token, or account_only" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-settings">Brand Settings JSON</Label>
              <Textarea id="brand-settings" rows={8} className="font-mono text-xs" value={brandSettingsText} onChange={(e) => setBrandSettingsText(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="widget-settings">Widget Settings JSON</Label>
              <Textarea id="widget-settings" rows={8} className="font-mono text-xs" value={widgetSettingsText} onChange={(e) => setWidgetSettingsText(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium">Require Origin Checks</div>
                <div className="text-sm text-muted-foreground">Reject submissions from domains outside the tenant allowlist.</div>
              </div>
              <Switch checked={config?.require_cors_origin ?? true} disabled />
            </div>
            <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>Save Settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">API Keys</CardTitle>
            <KeyRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-[1fr,140px]">
              <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Frontend Widget Key" />
              <Input value={keyType} onChange={(e) => setKeyType(e.target.value === 'secret' ? 'secret' : 'public')} placeholder="public or secret" />
            </div>
            <Button size="sm" onClick={() => createPublicKey.mutate()} disabled={createPublicKey.isPending}>
              {createPublicKey.isPending ? 'Generating…' : `Generate ${keyType === 'public' ? 'Public' : 'Secret'} Key`}
            </Button>
            {issuedToken ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-medium">Copy this now</div>
                <div className="mt-1 break-all font-mono">{issuedToken}</div>
              </div>
            ) : null}
            {(keys ?? []).length === 0 ? (
              <div className="text-muted-foreground">No ticketing API keys yet.</div>
            ) : (
              (keys ?? []).map((key: any) => (
                <div key={key.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{key.name}</div>
                      <div className="mt-1 text-muted-foreground">{key.key_type} • {key.token_prefix}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={key.is_active ? 'default' : 'outline'}>{key.is_active ? 'Active' : 'Revoked'}</Badge>
                      {key.is_active ? (
                        <Button variant="ghost" size="sm" onClick={() => revokeKey.mutate(key.id)} disabled={revokeKey.isPending}>
                          <EyeOff className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
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
