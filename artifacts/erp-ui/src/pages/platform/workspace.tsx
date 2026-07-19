import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronUp, ChevronDown, RefreshCw, Save, Eye, EyeOff, Menu } from 'lucide-react';

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

function RoleAccessToggle({
  itemId, groups, access,
}: { itemId: number; groups: any[]; access: any[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const toggleAccess = useMutation({
    mutationFn: ({ groupId, canView, existingId }: { groupId: number; canView: boolean; existingId?: number }) => {
      if (existingId) {
        return api(token!, `/workspace/menu-access/${existingId}/`, 'PATCH', { can_view: canView });
      }
      return api(token!, '/workspace/menu-access/', 'POST', { group_id: groupId, menu_item_id: itemId, can_view: canView });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-access'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {groups.map(g => {
        const entry = access.find((a: any) => a.group?.id === g.id && a.menu_item?.id === itemId);
        const canView = entry?.can_view ?? false;
        return (
          <button
            key={g.id}
            onClick={() => toggleAccess.mutate({ groupId: g.id, canView: !canView, existingId: entry?.id })}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              canView
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-gray-100 text-gray-400 border-gray-300'
            }`}
          >
            {canView ? <Eye className="h-2.5 w-2.5 inline mr-0.5" /> : <EyeOff className="h-2.5 w-2.5 inline mr-0.5" />}
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

export default function Workspace() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [previewRole, setPreviewRole] = useState('');

  const { data: sectionsData, isLoading, refetch } = useQuery({
    queryKey: ['menu-sections'],
    queryFn: () => api(token!, '/workspace/menu-sections/?page_size=50'),
    enabled: !!token,
  });
  const { data: accessData } = useQuery({
    queryKey: ['menu-access'],
    queryFn: () => api(token!, '/workspace/menu-access/?page_size=500'),
    enabled: !!token,
  });
  const { data: groupsData } = useQuery({
    queryKey: ['roles-workspace'],
    queryFn: () => api(token!, '/roles/?page_size=50'),
    enabled: !!token,
  });

  const sections: any[] = sectionsData?.results ?? [];
  const access: any[] = accessData?.results ?? [];
  const groups: any[] = groupsData?.results ?? [];

  const reorderMutation = useMutation({
    mutationFn: ({ id, sort_order }: { id: number; sort_order: number }) =>
      api(token!, `/workspace/menu-items/${id}/`, 'PATCH', { sort_order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-sections'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggleItemActive = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api(token!, `/workspace/menu-items/${id}/`, 'PATCH', { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-sections'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const saveItemTitle = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api(token!, `/workspace/menu-items/${id}/`, 'PATCH', { title }),
    onSuccess: () => { toast({ title: 'Saved' }); qc.invalidateQueries({ queryKey: ['menu-sections'] }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const [editingTitle, setEditingTitle] = useState<Record<number, string>>({});

  const previewSections = previewRole
    ? sections.map(sec => ({
        ...sec,
        items: (sec.items ?? []).filter((item: any) => {
          const a = access.find((e: any) => e.menu_item?.id === item.id && e.group?.name === previewRole);
          return a?.can_view !== false && item.is_active;
        }),
      })).filter(sec => (sec.items ?? []).length > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu Builder</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Configure workspace navigation and role visibility</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor */}
        <div className="lg:col-span-2 space-y-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground font-mono text-sm py-8 animate-pulse">Loading…</p>
          ) : sections.map(section => (
            <Card key={section.id}>
              <CardHeader className="bg-muted/20 border-b py-3 px-4">
                <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <Menu className="h-3.5 w-3.5" /> {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(section.items ?? []).map((item: any, idx: number) => (
                  <div key={item.id} className={`px-4 py-3 border-b last:border-0 ${!item.is_active ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-3">
                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5 shrink-0 mt-0.5">
                        <button
                          disabled={idx === 0}
                          onClick={() => reorderMutation.mutate({ id: item.id, sort_order: item.sort_order - 1 })}
                          className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          disabled={idx === (section.items?.length ?? 1) - 1}
                          onClick={() => reorderMutation.mutate({ id: item.id, sort_order: item.sort_order + 1 })}
                          className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Title editor */}
                        <div className="flex items-center gap-2">
                          <Input
                            className="h-7 text-sm font-medium"
                            value={editingTitle[item.id] ?? item.title}
                            onChange={e => setEditingTitle(p => ({ ...p, [item.id]: e.target.value }))}
                            onBlur={() => {
                              if (editingTitle[item.id] && editingTitle[item.id] !== item.title) {
                                saveItemTitle.mutate({ id: item.id, title: editingTitle[item.id] });
                              }
                            }}
                          />
                          <Switch
                            checked={item.is_active}
                            onCheckedChange={v => toggleItemActive.mutate({ id: item.id, is_active: v })}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{item.route_path}</p>
                        {/* Role visibility */}
                        <RoleAccessToggle itemId={item.id} groups={groups} access={access} />
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Preview pane */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Preview as Role</p>
            <Select value={previewRole} onValueChange={setPreviewRole}>
              <SelectTrigger><SelectValue placeholder="Select role to preview…" /></SelectTrigger>
              <SelectContent>
                {groups.map(g => <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {previewRole && (
            <Card>
              <CardHeader className="py-3 px-3 border-b bg-muted/20">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest">
                  Nav as {previewRole}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                {previewSections.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No items visible.</p>
                ) : previewSections.map(sec => (
                  <div key={sec.id} className="mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">{sec.title}</p>
                    {(sec.items ?? []).map((item: any) => (
                      <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/50">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                        {item.title}
                      </div>
                    ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
