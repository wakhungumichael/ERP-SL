import { useMemo, useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, Layers, Globe, Zap, Link2, Plus, Pencil, Trash2 } from 'lucide-react';

const BASE = '/api/platform';
function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
    return j;
  });
}

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  core:        <Layers className="h-4 w-4 text-blue-600" />,
  shared:      <Globe className="h-4 w-4 text-emerald-600" />,
  vertical:    <Zap className="h-4 w-4 text-amber-600" />,
  integration: <Link2 className="h-4 w-4 text-purple-600" />,
};
const CATEGORY_STYLE: Record<string, string> = {
  core:        'border-blue-200 bg-blue-50/40',
  shared:      'border-emerald-200 bg-emerald-50/40',
  vertical:    'border-amber-200 bg-amber-50/40',
  integration: 'border-purple-200 bg-purple-50/40',
};
const CATEGORY_LABEL: Record<string, string> = {
  core: 'Core', shared: 'Shared Services', vertical: 'Industry Vertical', integration: 'Integration',
};
const SCOPE_LABEL: Record<string, string> = {
  organization: 'Organization',
  hybrid: 'Hybrid',
  platform_admin: 'Platform Admin',
};

const EMPTY = {
  slug: '', name: '', category: 'shared', scope: 'organization', description: '', is_core: false, is_active: true, industry_ids: [] as number[],
};

function ModuleDialog({ open, onClose, mod }: { open: boolean; onClose: () => void; mod?: any }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!mod;
  const { data: industriesData } = useQuery({
    queryKey: ['module-industries'],
    queryFn: () => api(token!, '/industries/?page_size=100'),
    enabled: open && !!token,
  });
  const industries: any[] = industriesData?.results ?? [];
  const [form, setForm] = useState(() => mod ? {
    slug: mod.slug, name: mod.name, category: mod.category,
    scope: mod.scope ?? 'organization',
    description: mod.description ?? '', is_core: mod.is_core, is_active: mod.is_active,
    industry_ids: Array.isArray(mod.industries) ? mod.industries.map((industry: any) => industry.id) : [],
  } : { ...EMPTY });

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api(token!, `/modules/${mod.id}/`, 'PATCH', { name: form.name, category: form.category, scope: form.scope, description: form.description, is_core: form.is_core, is_active: form.is_active, industry_ids: form.industry_ids })
      : api(token!, '/modules/', 'POST', { ...form }),
    onSuccess: () => {
      toast({ title: isEdit ? 'Module updated' : 'Module created' });
      qc.invalidateQueries({ queryKey: ['modules'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit — ${mod.name}` : 'New Module'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={form.name} onChange={set('name')} placeholder="e.g. Fleet Management" />
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Slug *</Label>
              <Input value={form.slug} onChange={set('slug')} placeholder="e.g. fleet-management" className="font-mono" />
              <p className="text-[11px] text-muted-foreground">Unique identifier — lowercase, hyphens only. Cannot be changed after creation.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="core">Core</SelectItem>
                <SelectItem value="shared">Shared Services</SelectItem>
                <SelectItem value="vertical">Industry Vertical</SelectItem>
                <SelectItem value="integration">Integration</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={form.scope} onValueChange={v => setForm(p => ({ ...p, scope: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="platform_admin">Platform Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Use Organization for subscribable ERP features, Hybrid for shared platform-plus-organization capabilities, and Platform Admin for control-center modules only.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={set('description')} rows={2} placeholder="Short description of what this module provides." />
          </div>
          <div className="space-y-2">
            <Label>Industries</Label>
            <div className="grid gap-2 rounded-2xl border bg-muted/20 p-3 sm:grid-cols-2">
              {industries.map((industry: any) => {
                const checked = form.industry_ids.includes(industry.id);
                return (
                  <label key={industry.id} className="flex items-start gap-3 rounded-xl border bg-white px-3 py-3 text-sm cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => setForm((current) => ({
                        ...current,
                        industry_ids: value
                          ? [...current.industry_ids, industry.id]
                          : current.industry_ids.filter((id: number) => id !== industry.id),
                      }))}
                    />
                    <span>{industry.name}</span>
                  </label>
                );
              })}
              {industries.length === 0 ? <p className="text-sm text-muted-foreground">No industries configured yet.</p> : null}
            </div>
            <p className="text-[11px] text-muted-foreground">Assign modules to industries so onboarding, plans, and subscriptions can align correctly.</p>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={form.is_core} onCheckedChange={v => setForm(p => ({ ...p, is_core: v }))} />
              <span className="text-sm">Core module (always on)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
              <span className="text-sm">Active</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name || (!isEdit && !form.slug)}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Module'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Modules() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['modules'],
    queryFn: () => api(token!, '/modules/?page_size=100'),
    enabled: !!token,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const toggleMutation = useMutation({
    mutationFn: (mod: any) => api(token!, `/modules/${mod.id}/`, 'PATCH', { is_active: !mod.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modules'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (mod: any) => api(token!, `/modules/${mod.id}/`, 'DELETE'),
    onSuccess: () => {
      toast({ title: 'Module deleted' });
      qc.invalidateQueries({ queryKey: ['modules'] });
      setDeleting(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const modules: any[] = data?.results ?? [];
  const grouped: Record<string, any[]> = {};
  for (const m of modules) (grouped[m.category] ??= []).push(m);
  const categories = ['core', 'shared', 'vertical', 'integration'].filter(c => grouped[c]?.length);
  const summary = useMemo(() => ({
    total: modules.length,
    active: modules.filter((mod) => mod.is_active).length,
    core: modules.filter((mod) => mod.is_core).length,
    liveTenants: modules.reduce((count, mod) => count + Number(mod.active_tenant_count ?? 0), 0),
    planBindings: modules.reduce((count, mod) => count + Number(mod.plan_count ?? 0), 0),
  }), [modules]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Modules</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {modules.length} module{modules.length !== 1 ? 's' : ''} registered · toggle to enable/disable
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Module</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Total', summary.total],
          ['Active', summary.active],
          ['Core', summary.core],
          ['Live Tenants', summary.liveTenants],
          ['Plan Links', summary.planBindings],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-2 text-2xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground text-sm py-12 animate-pulse">Loading…</p>
      ) : modules.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm space-y-3">
          <Layers className="h-10 w-10 mx-auto opacity-20" />
          <p>No modules registered yet.</p>
          <Button size="sm" variant="outline" onClick={() => setShowNew(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Create first module
          </Button>
        </div>
      ) : (
        categories.map(cat => (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-2">
              {CATEGORY_ICON[cat]}
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{CATEGORY_LABEL[cat]}</h2>
                    <Badge variant="secondary" className="text-[10px] h-4">{grouped[cat].length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {grouped[cat].map(mod => (
                      <Card key={mod.id} className={`border group ${CATEGORY_STYLE[cat] ?? ''} ${!mod.is_active ? 'opacity-55' : ''}`}>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm leading-tight">{mod.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{mod.slug}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{SCOPE_LABEL[mod.scope] ?? mod.scope}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {Number(mod.active_tenant_count ?? 0)} tenants · {Number(mod.plan_count ?? 0)} plans
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {mod.is_core && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-blue-100 text-blue-700 border border-blue-300 rounded">
                            Core
                          </span>
                        )}
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setEditing(mod)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {!mod.is_core && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={() => setDeleting(mod)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        <Switch
                          checked={mod.is_active}
                          onCheckedChange={() => toggleMutation.mutate(mod)}
                          disabled={mod.is_core || toggleMutation.isPending}
                          className="scale-90"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  {mod.description && (
                    <CardContent className="pt-0 pb-3 px-4">
                      <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>
                      {(mod.industries ?? []).length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {(mod.industries ?? []).map((industry: any) => (
                            <Badge key={industry.id} variant="outline">{industry.name}</Badge>
                          ))}
                        </div>
                      ) : null}
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      <ModuleDialog open={showNew} onClose={() => setShowNew(false)} />
      {editing && <ModuleDialog open mod={editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the module definition and will break any plan or tenant activation that references it.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && deleteMutation.mutate(deleting)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Module'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
