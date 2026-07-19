import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Layers, Globe, Zap, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  core:        <Layers className="h-5 w-5 text-blue-600" />,
  shared:      <Globe className="h-5 w-5 text-emerald-600" />,
  vertical:    <Zap className="h-5 w-5 text-amber-600" />,
  integration: <Link2 className="h-5 w-5 text-purple-600" />,
};
const CATEGORY_STYLE: Record<string, string> = {
  core:        'border-blue-200 bg-blue-50/50 dark:bg-blue-950/10 dark:border-blue-900',
  shared:      'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10 dark:border-emerald-900',
  vertical:    'border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 dark:border-amber-900',
  integration: 'border-purple-200 bg-purple-50/50 dark:bg-purple-950/10 dark:border-purple-900',
};

export default function Modules() {
  const { token, role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['modules'],
    queryFn: () => api(token!, '/modules/?page_size=100'),
    enabled: !!token,
  });

  const toggleMutation = useMutation({
    mutationFn: (mod: any) => api(token!, `/modules/${mod.id}/`, 'PATCH', { is_active: !mod.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modules'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const modules: any[] = data?.results ?? [];

  const grouped: Record<string, any[]> = {};
  for (const m of modules) {
    (grouped[m.category] ??= []).push(m);
  }
  const categories = ['core', 'shared', 'vertical', 'integration'].filter(c => grouped[c]?.length);

  const CATEGORY_LABEL: Record<string, string> = {
    core: 'Core', shared: 'Shared', vertical: 'Industry Vertical', integration: 'Integration',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Modules</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Platform module registry</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground text-sm py-12 font-mono animate-pulse">Loading…</p>
      ) : (
        categories.map(cat => (
          <div key={cat} className="space-y-3">
            <div className="flex items-center gap-2">
              {CATEGORY_ICON[cat]}
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{CATEGORY_LABEL[cat]}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {grouped[cat].map(mod => (
                <Card key={mod.id} className={`border ${CATEGORY_STYLE[cat] ?? ''} ${!mod.is_active ? 'opacity-60' : ''}`}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{mod.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{mod.slug}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {mod.is_core && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-blue-100 text-blue-700 border border-blue-300 rounded">
                            Core
                          </span>
                        )}
                        {role === 'superadmin' && (
                          <Switch
                            checked={mod.is_active}
                            onCheckedChange={() => toggleMutation.mutate(mod)}
                            disabled={mod.is_core}
                          />
                        )}
                        {role !== 'superadmin' && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${mod.is_active ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                            {mod.is_active ? 'Active' : 'Inactive'}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  {mod.description && (
                    <CardContent className="pt-0 pb-4 px-4">
                      <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
