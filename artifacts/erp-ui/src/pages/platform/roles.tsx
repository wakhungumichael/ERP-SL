import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ShieldCheck, ChevronDown, ChevronRight, UserMinus, Plus, RefreshCw } from 'lucide-react';

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

const ROLE_COLOR: Record<string, string> = {
  'Super Admin':    'bg-red-100 text-red-800 border-red-300',
  'Tenant Admin':   'bg-blue-100 text-blue-800 border-blue-300',
  'Finance':        'bg-emerald-100 text-emerald-800 border-emerald-300',
  'Operator':       'bg-orange-100 text-orange-800 border-orange-300',
};

function AssignRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [groupId, setGroupId] = useState('');

  const { data: usersData } = useQuery({
    queryKey: ['users-assign'],
    queryFn: () => api(token!, '/users/?page_size=200'),
    enabled: open,
  });
  const { data: rolesData } = useQuery({
    queryKey: ['roles-assign'],
    queryFn: () => api(token!, '/roles/?page_size=50'),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => api(token!, `/users/${userId}/assign-roles/`, 'POST', {
      group_ids: [Number(groupId)],
      replace_existing: false,
    }),
    onSuccess: () => {
      toast({ title: 'Role assigned' });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign Role to User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">User</label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Select user…" /></SelectTrigger>
              <SelectContent>
                {(usersData?.results ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue placeholder="Select role…" /></SelectTrigger>
              <SelectContent>
                {(rolesData?.results ?? []).map((g: any) => (
                  <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!userId || !groupId || mutation.isPending}>
            {mutation.isPending ? 'Assigning…' : 'Assign Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Roles() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showAssign, setShowAssign] = useState(false);

  const { data: rolesData, isLoading, refetch } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api(token!, '/roles/?page_size=50'),
    enabled: !!token,
  });
  const { data: usersData } = useQuery({
    queryKey: ['users-for-roles'],
    queryFn: () => api(token!, '/users/?page_size=200'),
    enabled: !!token,
  });

  const roles: any[] = rolesData?.results ?? [];
  const allUsers: any[] = usersData?.results ?? [];

  const removeFromRole = useMutation({
    mutationFn: ({ userId, groupId }: { userId: number; groupId: number }) => {
      const u = allUsers.find(u => u.id === userId)!;
      const remaining = (u.groups ?? []).filter((g: any) => g.id !== groupId).map((g: any) => g.id);
      return api(token!, `/users/${userId}/assign-roles/`, 'POST', { group_ids: remaining, replace_existing: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users-for-roles'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggle = (id: number) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Platform role groups and user assignments</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowAssign(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Assign Role
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground text-sm py-12 font-mono animate-pulse">Loading…</p>
      ) : (
        <div className="space-y-3">
          {roles.map(role => {
            const members = allUsers.filter((u: any) =>
              (u.groups ?? []).some((g: any) => g.id === role.id || g.name === role.name)
            );
            const isOpen = expanded.has(role.id);
            return (
              <Card key={role.id}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors rounded-t-lg"
                  onClick={() => toggle(role.id)}
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border ${ROLE_COLOR[role.name] ?? 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                        {role.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</span>
                  </div>
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
                {isOpen && (
                  <CardContent className="pt-0 pb-3 px-4 border-t">
                    {members.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-3 text-center">No users in this role.</p>
                    ) : (
                      <div className="divide-y">
                        {members.map((u: any) => (
                          <div key={u.id} className="flex items-center justify-between py-2">
                            <div>
                              <p className="text-sm font-medium">
                                {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}
                              </p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                              onClick={() => removeFromRole.mutate({ userId: u.id, groupId: role.id })}
                            >
                              <UserMinus className="h-3.5 w-3.5" /> Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <AssignRoleDialog open={showAssign} onClose={() => setShowAssign(false)} />
    </div>
  );
}
