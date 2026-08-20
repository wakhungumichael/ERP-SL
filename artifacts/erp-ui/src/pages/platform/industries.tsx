import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Building2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

const BASE = '/api/platform';

function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    if (method === 'DELETE' && response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.detail || payload?.error || JSON.stringify(payload));
    return payload;
  });
}

const EMPTY_FORM = {
  name: '',
  slug: '',
  description: '',
  is_active: true,
};

function IndustryDialog({ open, onClose, industry }: { open: boolean; onClose: () => void; industry?: any }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = Boolean(industry);
  const [form, setForm] = useState(() => industry ? {
    name: industry.name ?? '',
    slug: industry.slug ?? '',
    description: industry.description ?? '',
    is_active: industry.is_active ?? true,
  } : EMPTY_FORM);

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api(token!, `/industries/${industry.id}/`, 'PATCH', form)
      : api(token!, '/industries/', 'POST', form),
    onSuccess: () => {
      toast({ title: isEdit ? 'Industry updated' : 'Industry created' });
      qc.invalidateQueries({ queryKey: ['platform-industries'] });
      onClose();
    },
    onError: (error: any) => toast({ title: 'Save failed', description: error.message, variant: 'destructive' }),
  });

  const update = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${industry.name}` : 'New Industry'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Industry Name</Label>
            <Input value={form.name} onChange={update('name')} placeholder="Logistics" />
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input value={form.slug} onChange={update('slug')} placeholder="logistics" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={update('description')} rows={3} placeholder="Short description of this industry segment." />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_active} onCheckedChange={(value) => setForm((current) => ({ ...current, is_active: value }))} />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name || !form.slug}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Industry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Industries() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['platform-industries'],
    queryFn: () => api(token!, '/industries/?page_size=100'),
    enabled: !!token,
  });

  const deleteMutation = useMutation({
    mutationFn: (industry: any) => api(token!, `/industries/${industry.id}/`, 'DELETE'),
    onSuccess: () => {
      toast({ title: 'Industry deleted' });
      qc.invalidateQueries({ queryKey: ['platform-industries'] });
      setDeleting(null);
    },
    onError: (error: any) => toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }),
  });

  const industries: any[] = data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Industries</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            SaaS master data for industry-specific modules, plans, and onboarding alignment.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Industry</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total</div><div className="mt-2 text-2xl font-semibold">{industries.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Active</div><div className="mt-2 text-2xl font-semibold">{industries.filter((item) => item.is_active).length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Inactive</div><div className="mt-2 text-2xl font-semibold">{industries.filter((item) => !item.is_active).length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/20 py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Industry Registry</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading industries…</p>
          ) : industries.length === 0 ? (
            <div className="space-y-3 py-14 text-center text-sm text-muted-foreground">
              <Building2 className="mx-auto h-10 w-10 opacity-20" />
              <p>No industries defined yet.</p>
            </div>
          ) : (
            <div className="divide-y">
              {industries.map((industry) => (
                <div key={industry.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm text-foreground">{industry.name}</p>
                      <Badge variant={industry.is_active ? 'secondary' : 'outline'}>
                        {industry.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      <Badge variant="outline" className="font-mono">{industry.slug}</Badge>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                      {industry.description || 'No description provided.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(industry)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setDeleting(industry)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <IndustryDialog open={showNew} onClose={() => setShowNew(false)} />
      {editing ? <IndustryDialog open={!!editing} onClose={() => setEditing(null)} industry={editing} /> : null}

      <AlertDialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete industry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{deleting?.name}</strong> from the industry master data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate(deleting)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
