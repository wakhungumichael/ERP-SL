import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, KeyRound, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';
import { toast } from '@/hooks/use-toast';

type TicketingConfig = {
  allowed_domains?: string[];
  portal_access_policy?: 'email_match' | 'secure_token' | 'account_only';
  brand_settings?: Record<string, unknown>;
  widget_settings?: Record<string, unknown>;
  email_settings?: Record<string, unknown>;
  webhook_settings?: Record<string, unknown>;
  channel_settings?: {
    email?: {
      enabled?: boolean;
      inbound_secret?: string;
      from_name?: string;
      reply_subject_prefix?: string;
      allow_new_tickets?: boolean;
    };
    whatsapp?: {
      enabled?: boolean;
      provider?: string;
      verify_token?: string;
      phone_number_id?: string;
      access_token?: string;
      business_account_id?: string;
      allow_new_tickets?: boolean;
    };
  };
  require_cors_origin?: boolean;
  allow_anonymous_tracking?: boolean;
  allow_requester_close?: boolean;
};

type TicketingKey = {
  id: number;
  name: string;
  key_type: 'public' | 'secret';
  token_prefix: string;
  is_active: boolean;
  last_used_at?: string | null;
};

async function authed(token: string, path: string, init?: RequestInit) {
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

export default function TicketingSettings() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [allowedDomains, setAllowedDomains] = useState('');
  const [portalAccessPolicy, setPortalAccessPolicy] = useState<TicketingConfig['portal_access_policy']>('email_match');
  const [brandColor, setBrandColor] = useState('#E85D26');
  const [supportEmail, setSupportEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [widgetHeadline, setWidgetHeadline] = useState('How can we help?');
  const [widgetIntro, setWidgetIntro] = useState('Tell us what happened and our team will guide you.');
  const [submitLabel, setSubmitLabel] = useState('Create Ticket');
  const [requireOriginChecks, setRequireOriginChecks] = useState(true);
  const [allowTracking, setAllowTracking] = useState(true);
  const [allowRequesterClose, setAllowRequesterClose] = useState(true);
  const [emailChannelEnabled, setEmailChannelEnabled] = useState(false);
  const [emailInboundSecret, setEmailInboundSecret] = useState('');
  const [emailFromName, setEmailFromName] = useState('');
  const [emailSubjectPrefix, setEmailSubjectPrefix] = useState('');
  const [emailAllowNewTickets, setEmailAllowNewTickets] = useState(true);
  const [whatsAppEnabled, setWhatsAppEnabled] = useState(false);
  const [whatsAppVerifyToken, setWhatsAppVerifyToken] = useState('');
  const [whatsAppPhoneNumberId, setWhatsAppPhoneNumberId] = useState('');
  const [whatsAppAccessToken, setWhatsAppAccessToken] = useState('');
  const [whatsAppBusinessAccountId, setWhatsAppBusinessAccountId] = useState('');
  const [whatsAppAllowNewTickets, setWhatsAppAllowNewTickets] = useState(true);
  const [keyType, setKeyType] = useState<'public' | 'secret'>('public');
  const [newKeyName, setNewKeyName] = useState('');
  const [issuedToken, setIssuedToken] = useState('');

  const { data: config } = useQuery<TicketingConfig>({
    queryKey: ['ticketing-config'],
    enabled: !!token,
    queryFn: () => authed(token!, '/api/ticketing/config/'),
  });

  const { data: keys } = useQuery<TicketingKey[]>({
    queryKey: ['ticketing-keys'],
    enabled: !!token,
    queryFn: () => authed(token!, '/api/ticketing/keys/'),
  });

  useEffect(() => {
    if (!config) return;
    setAllowedDomains((config.allowed_domains ?? []).join('\n'));
    setPortalAccessPolicy(config.portal_access_policy ?? 'email_match');
    setBrandColor(String(config.brand_settings?.brand_color ?? config.brand_settings?.primary_color ?? '#E85D26'));
    setSupportEmail(String(config.brand_settings?.support_email ?? ''));
    setLogoUrl(String(config.brand_settings?.logo_url ?? ''));
    setWidgetHeadline(String(config.widget_settings?.headline ?? 'How can we help?'));
    setWidgetIntro(String(config.widget_settings?.intro_text ?? config.widget_settings?.description ?? 'Tell us what happened and our team will guide you.'));
    setSubmitLabel(String(config.widget_settings?.submit_label ?? 'Create Ticket'));
    setRequireOriginChecks(Boolean(config.require_cors_origin ?? true));
    setAllowTracking(Boolean(config.allow_anonymous_tracking ?? true));
    setAllowRequesterClose(Boolean(config.allow_requester_close ?? true));
    setEmailChannelEnabled(Boolean(config.channel_settings?.email?.enabled ?? false));
    setEmailInboundSecret(String(config.channel_settings?.email?.inbound_secret ?? ''));
    setEmailFromName(String(config.channel_settings?.email?.from_name ?? ''));
    setEmailSubjectPrefix(String(config.channel_settings?.email?.reply_subject_prefix ?? ''));
    setEmailAllowNewTickets(Boolean(config.channel_settings?.email?.allow_new_tickets ?? true));
    setWhatsAppEnabled(Boolean(config.channel_settings?.whatsapp?.enabled ?? false));
    setWhatsAppVerifyToken(String(config.channel_settings?.whatsapp?.verify_token ?? ''));
    setWhatsAppPhoneNumberId(String(config.channel_settings?.whatsapp?.phone_number_id ?? ''));
    setWhatsAppAccessToken(String(config.channel_settings?.whatsapp?.access_token ?? ''));
    setWhatsAppBusinessAccountId(String(config.channel_settings?.whatsapp?.business_account_id ?? ''));
    setWhatsAppAllowNewTickets(Boolean(config.channel_settings?.whatsapp?.allow_new_tickets ?? true));
  }, [config]);

  const checklist = useMemo(() => {
    const domainsCount = allowedDomains.split('\n').map((value) => value.trim()).filter(Boolean).length;
    const hasBranding = Boolean(brandColor && widgetHeadline.trim());
    const hasPublicKey = (keys ?? []).some((key) => key.key_type === 'public' && key.is_active);
    const hasChannel = emailChannelEnabled || whatsAppEnabled;
    return [
      { label: 'Brand the widget', done: hasBranding },
      { label: 'Approve where tickets can come from', done: domainsCount > 0 || !requireOriginChecks },
      { label: 'Generate a public widget key', done: hasPublicKey },
      { label: 'Turn on email or WhatsApp', done: hasChannel },
    ];
  }, [allowedDomains, brandColor, emailChannelEnabled, keys, requireOriginChecks, whatsAppEnabled, widgetHeadline]);

  const saveConfig = useMutation({
    mutationFn: () => authed(token!, '/api/ticketing/config/', {
      method: 'PATCH',
      body: JSON.stringify({
        allowed_domains: allowedDomains.split('\n').map((entry) => entry.trim()).filter(Boolean),
        portal_access_policy: portalAccessPolicy,
        brand_settings: {
          ...(config?.brand_settings ?? {}),
          brand_color: brandColor,
          primary_color: brandColor,
          support_email: supportEmail.trim(),
          logo_url: logoUrl.trim(),
        },
        widget_settings: {
          ...(config?.widget_settings ?? {}),
          headline: widgetHeadline.trim(),
          intro_text: widgetIntro.trim(),
          submit_label: submitLabel.trim(),
        },
        require_cors_origin: requireOriginChecks,
        allow_anonymous_tracking: allowTracking,
        allow_requester_close: allowRequesterClose,
        channel_settings: {
          email: {
            enabled: emailChannelEnabled,
            inbound_secret: emailInboundSecret.trim(),
            from_name: emailFromName.trim(),
            reply_subject_prefix: emailSubjectPrefix.trim(),
            allow_new_tickets: emailAllowNewTickets,
          },
          whatsapp: {
            enabled: whatsAppEnabled,
            provider: 'meta_cloud_api',
            verify_token: whatsAppVerifyToken.trim(),
            phone_number_id: whatsAppPhoneNumberId.trim(),
            access_token: whatsAppAccessToken.trim(),
            business_account_id: whatsAppBusinessAccountId.trim(),
            allow_new_tickets: whatsAppAllowNewTickets,
          },
        },
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-config'] });
      toast({ title: 'Ticketing settings saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not save settings', description: error.message, variant: 'destructive' });
    },
  });

  const createKey = useMutation({
    mutationFn: () => authed(token!, '/api/ticketing/keys/', {
      method: 'POST',
      body: JSON.stringify({
        name: newKeyName || `${keyType === 'public' ? 'Public' : 'Secret'} Key ${Date.now()}`,
        key_type: keyType,
      }),
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['ticketing-keys'] });
      setIssuedToken(result.raw_token ?? '');
      setNewKeyName('');
      toast({ title: `${keyType === 'public' ? 'Public' : 'Secret'} key created` });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not create key', description: error.message, variant: 'destructive' });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (keyId: number) => authed(token!, `/api/ticketing/keys/${keyId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ revoke: true }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-keys'] });
      toast({ title: 'Key revoked' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not revoke key', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ticketing Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">Guide an admin through branding, access policy, and publishing without exposing raw config blobs.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Go-Live Checklist</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">This is the setup flow a normal admin should follow.</p>
            </div>
            <Sparkles className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {checklist.map((item) => (
              <div key={item.label} className={`rounded-xl border p-4 ${item.done ? 'border-emerald-300 bg-emerald-50' : 'bg-muted/30'}`}>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.done ? 'Ready' : 'Next'}</div>
                <div className="mt-2 font-medium">{item.label}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
          <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Portal access</div><div className="mt-2 text-xl font-semibold">{portalAccessPolicy === 'email_match' ? 'Email + ticket ID' : portalAccessPolicy === 'secure_token' ? 'Secure tracking links' : 'Portal login only'}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Active keys</div><div className="mt-2 text-xl font-semibold">{(keys ?? []).filter((key) => key.is_active).length}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Allowed origins</div><div className="mt-2 text-xl font-semibold">{allowedDomains.split('\n').map((value) => value.trim()).filter(Boolean).length}</div></CardContent></Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <Card>
          <CardHeader>
            <CardTitle>Brand & Widget Experience</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="brand-color">Brand color</Label>
                <div className="flex items-center gap-3">
                  <Input id="brand-color" type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-11 w-20 p-2" />
                  <Input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-email">Support email</Label>
                <Input id="support-email" value={supportEmail} onChange={(event) => setSupportEmail(event.target.value)} placeholder="support@example.com" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo-url">Logo URL</Label>
              <Input id="logo-url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://example.com/logo.png" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="widget-headline">Widget headline</Label>
                <Input id="widget-headline" value={widgetHeadline} onChange={(event) => setWidgetHeadline(event.target.value)} placeholder="How can we help?" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="submit-label">Submit button label</Label>
                <Input id="submit-label" value={submitLabel} onChange={(event) => setSubmitLabel(event.target.value)} placeholder="Create Ticket" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="widget-intro">Intro text</Label>
              <Textarea id="widget-intro" rows={4} value={widgetIntro} onChange={(event) => setWidgetIntro(event.target.value)} placeholder="Explain what customers should include when asking for help." />
            </div>

            <div className="rounded-2xl border p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Preview</div>
              <div className="mt-3 rounded-2xl border bg-white p-5 shadow-sm">
                <div className="text-xl font-semibold" style={{ color: brandColor }}>{widgetHeadline || 'How can we help?'}</div>
                <p className="mt-2 text-sm text-muted-foreground">{widgetIntro || 'Tell us what happened and our team will guide you.'}</p>
                <div className="mt-4 inline-flex rounded-full px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: brandColor }}>
                  {submitLabel || 'Create Ticket'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access & Tracking Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="allowed-domains">Allowed website origins</Label>
              <Textarea
                id="allowed-domains"
                rows={6}
                value={allowedDomains}
                onChange={(event) => setAllowedDomains(event.target.value)}
                placeholder={'https://app.example.com\nhttps://support.example.com'}
              />
              <p className="text-xs text-muted-foreground">Add one origin per line for websites that can submit public tickets.</p>
            </div>

            <div className="space-y-2">
              <Label>How requesters track tickets</Label>
              <Select value={portalAccessPolicy} onValueChange={(value) => setPortalAccessPolicy(value as 'email_match' | 'secure_token' | 'account_only')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email_match">Email + Ticket ID</SelectItem>
                  <SelectItem value="secure_token">Secure tracking links</SelectItem>
                  <SelectItem value="account_only">Portal login only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <div className="font-medium">Require allowed origins</div>
                  <p className="text-sm text-muted-foreground">Block submissions from websites outside the approved list.</p>
                </div>
                <Switch checked={requireOriginChecks} onCheckedChange={setRequireOriginChecks} />
              </div>
              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <div className="font-medium">Allow requester tracking</div>
                  <p className="text-sm text-muted-foreground">Let customers check progress without agent involvement.</p>
                </div>
                <Switch checked={allowTracking} onCheckedChange={setAllowTracking} />
              </div>
              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <div className="font-medium">Allow requester close</div>
                  <p className="text-sm text-muted-foreground">Let requesters mark a solved case as complete.</p>
                </div>
                <Switch checked={allowRequesterClose} onCheckedChange={setAllowRequesterClose} />
              </div>
            </div>

            <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
              {saveConfig.isPending ? 'Saving...' : 'Save Setup'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversation Channels</CardTitle>
          <p className="text-sm text-muted-foreground">Connect customer messages from email and WhatsApp so tickets stay in one tenant-owned thread.</p>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4 rounded-2xl border p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Email Inbox</div>
                <p className="text-sm text-muted-foreground">Accept inbound email replies and send agent updates back through SMTP.</p>
              </div>
              <Switch checked={emailChannelEnabled} onCheckedChange={setEmailChannelEnabled} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Email display name</Label>
                <Input value={emailFromName} onChange={(event) => setEmailFromName(event.target.value)} placeholder="SL ERP Support" />
              </div>
              <div className="space-y-2">
                <Label>Reply subject prefix</Label>
                <Input value={emailSubjectPrefix} onChange={(event) => setEmailSubjectPrefix(event.target.value)} placeholder="[Support]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Inbound email secret</Label>
              <Input value={emailInboundSecret} onChange={(event) => setEmailInboundSecret(event.target.value)} placeholder="shared secret from your email gateway" />
              <p className="text-xs text-muted-foreground">Use with `POST /api/ticketing/inbound/email/&lt;tenant-code&gt;/` and send it as `X-Ticketing-Secret`.</p>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-4">
              <div>
                <div className="font-medium">Allow new tickets from email</div>
                <p className="text-sm text-muted-foreground">If off, inbound email must reference an existing ticket ID.</p>
              </div>
              <Switch checked={emailAllowNewTickets} onCheckedChange={setEmailAllowNewTickets} />
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">WhatsApp Inbox</div>
                <p className="text-sm text-muted-foreground">Receive customer chats from WhatsApp Cloud API and let agents answer from the ERP.</p>
              </div>
              <Switch checked={whatsAppEnabled} onCheckedChange={setWhatsAppEnabled} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Verify token</Label>
                <Input value={whatsAppVerifyToken} onChange={(event) => setWhatsAppVerifyToken(event.target.value)} placeholder="meta webhook verify token" />
              </div>
              <div className="space-y-2">
                <Label>Phone number ID</Label>
                <Input value={whatsAppPhoneNumberId} onChange={(event) => setWhatsAppPhoneNumberId(event.target.value)} placeholder="WhatsApp phone number ID" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Access token</Label>
                <Input value={whatsAppAccessToken} onChange={(event) => setWhatsAppAccessToken(event.target.value)} placeholder="temporary or permanent token" />
              </div>
              <div className="space-y-2">
                <Label>Business account ID</Label>
                <Input value={whatsAppBusinessAccountId} onChange={(event) => setWhatsAppBusinessAccountId(event.target.value)} placeholder="optional business account ID" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-4">
              <div>
                <div className="font-medium">Allow new tickets from WhatsApp</div>
                <p className="text-sm text-muted-foreground">If off, only replies to existing ERP-sent WhatsApp messages will attach to tickets.</p>
              </div>
              <Switch checked={whatsAppAllowNewTickets} onCheckedChange={setWhatsAppAllowNewTickets} />
            </div>
            <p className="text-xs text-muted-foreground">Webhook endpoint: `GET/POST /api/ticketing/inbound/whatsapp/&lt;tenant-code&gt;/`</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Widget & Integration Keys</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Create a public key for the website widget and secret keys for exports or backend integrations.</p>
          </div>
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_180px_auto]">
            <Input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} placeholder="Public website widget key" />
            <Select value={keyType} onValueChange={(value: 'public' | 'secret') => setKeyType(value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public widget key</SelectItem>
                <SelectItem value="secret">Secret server key</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => createKey.mutate()} disabled={createKey.isPending}>
              {createKey.isPending ? 'Creating...' : 'Generate Key'}
            </Button>
          </div>

          {issuedToken ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="font-medium">Copy this now</div>
              <div className="mt-2 break-all font-mono text-xs">{issuedToken}</div>
            </div>
          ) : null}

          {(keys ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No ticketing keys have been created yet.</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(keys ?? []).map((key) => (
                <div key={key.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{key.name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{key.key_type === 'public' ? 'Public widget use' : 'Backend integration use'}</div>
                      <div className="mt-2 font-mono text-xs text-muted-foreground">{key.token_prefix}</div>
                      {key.last_used_at ? <div className="mt-2 text-xs text-muted-foreground">Last used: {new Date(key.last_used_at).toLocaleString()}</div> : null}
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
