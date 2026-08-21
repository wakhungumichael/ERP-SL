import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  ShieldCheck, Plus, Trash2, RefreshCw, UserMinus, Save, ChevronRight,
  Shield, Users, Pencil, Check,
} from 'lucide-react';
import { ERPPageHeader } from '@/components/erp/workspace/workspace-ui';

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

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContentType { id: number; app_label: string; model: string; }
interface Perm { id: number; name: string; codename: string; content_type: ContentType; }
interface Role {
  id: number;
  name: string;
  display_name?: string;
  scope?: 'system' | 'tenant';
  is_system?: boolean;
  is_editable?: boolean;
  is_assignable?: boolean;
  permissions: Perm[];
}

// ── Config ────────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  SL_Weighbridge: 'Weighbridge',
  SL_CRM: 'CRM',
  SL_HR: 'HR & Payroll',
  SL_Procurement: 'Procurement',
  SL_Sales: 'Sales',
  SL_Inventory: 'Inventory',
  SL_Budgeting: 'Budgeting & Commitments',
  SL_Ticketing: 'Ticketing',
  Platform_Core: 'Platform Admin',
  auth: 'User Management',
};
const MODULE_ORDER = [
  'SL_Weighbridge',
  'SL_CRM',
  'SL_HR',
  'SL_Procurement',
  'SL_Sales',
  'SL_Inventory',
  'SL_Budgeting',
  'SL_Ticketing',
  'Platform_Core',
  'auth',
];
const HIDDEN_APPS = new Set(['admin', 'authtoken', 'sessions', 'contenttypes']);

// Action permissions that don't fit the add/change/delete/view CRUD pattern
const ACTION_CODENAMES: Record<string, string> = {
  can_access_weighment_entry: 'Weighment Entry',
  can_capture_first_weight: 'First Weight',
  can_capture_second_weight: 'Second Weight',
  can_view_live_weight: 'Live Weight',
  can_manage_weighbridge_reports: 'Reports',
  can_manage_weighbridge_settings: 'Settings',
  can_manage_vehicle_presence: 'Vehicle Presence',
  can_review_weighbridge_discrepancies: 'Discrepancies',
  can_approve_pending_transactions: 'Approve',
  can_recall_completed_transactions: 'Recall',
  can_export_transaction: 'Export',
};

const CRUD_ACTIONS = ['view', 'add', 'change', 'delete'] as const;
const CRUD_LABELS: Record<string, string> = {
  view: 'View', add: 'Add', change: 'Edit', delete: 'Delete',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCrudAction(codename: string): string | null {
  for (const a of CRUD_ACTIONS) if (codename.startsWith(`${a}_`)) return a;
  return null;
}

function modelDisplayFromPerm(perm: Perm): string {
  // "Can view vehicle type" → "Vehicle type" → capitalise first
  const match = perm.name.match(/^Can (?:add|change|delete|view) (.+)$/i);
  const raw = match ? match[1] : perm.content_type.model;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

interface ModelGroup {
  model: string;
  display: string;
  perms: Record<string, Perm>; // action → Perm
  actions: Perm[];             // action permissions (approve/recall/export)
}

interface ModuleSection {
  appLabel: string;
  label: string;
  models: ModelGroup[];
  standaloneActions: Perm[]; // action perms not tied to a model group
}

function buildSections(allPerms: Perm[]): ModuleSection[] {
  const byApp: Record<string, Perm[]> = {};
  for (const p of allPerms) {
    const app = p.content_type.app_label;
    if (HIDDEN_APPS.has(app)) continue;
    if (!byApp[app]) byApp[app] = [];
    byApp[app].push(p);
  }

  const sections: ModuleSection[] = [];
  const orderedApps = [
    ...MODULE_ORDER.filter(a => byApp[a]),
    ...Object.keys(byApp).filter(a => !MODULE_ORDER.includes(a)),
  ];

  for (const appLabel of orderedApps) {
    const perms = byApp[appLabel] ?? [];
    const modelMap: Record<string, ModelGroup> = {};
    const standaloneActions: Perm[] = [];

    for (const p of perms) {
      const action = extractCrudAction(p.codename);
      if (action) {
        const model = p.content_type.model;
        if (!modelMap[model]) {
          modelMap[model] = {
            model,
            display: modelDisplayFromPerm(p),
            perms: {},
            actions: [],
          };
        }
        modelMap[model].perms[action] = p;
        // Fix display from the first CRUD perm encountered
        modelMap[model].display = modelDisplayFromPerm(p);
      } else if (ACTION_CODENAMES[p.codename]) {
        // Attach to the related model group if possible
        const model = p.content_type.model;
        if (modelMap[model]) {
          modelMap[model].actions.push(p);
        } else {
          standaloneActions.push(p);
        }
      }
    }

    // After building modelMap, attach standalone action perms that share a model
    for (const p of standaloneActions) {
      const model = p.content_type.model;
      if (modelMap[model]) {
        modelMap[model].actions.push(p);
      }
    }
    const filteredStandalone = standaloneActions.filter(p => !modelMap[p.content_type.model]);

    sections.push({
      appLabel,
      label: MODULE_LABELS[appLabel] ?? appLabel,
      models: Object.values(modelMap).sort((a, b) => a.display.localeCompare(b.display)),
      standaloneActions: filteredStandalone,
    });
  }

  return sections;
}

function roleLabel(role: Role) {
  return role.display_name || role.name;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CreateRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => api(token!, '/roles/', 'POST', { name }),
    onSuccess: () => {
      toast({ title: 'Role created' });
      qc.invalidateQueries({ queryKey: ['roles'] });
      setName('');
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Create New Role</DialogTitle></DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label>Role name</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Cashier, Supervisor…"
            onKeyDown={e => e.key === 'Enter' && name.trim() && mutation.mutate()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({
  role, open, onClose,
}: { role: Role; open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');

  const { data: usersData } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api(token!, '/users/?page_size=200'),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => api(token!, `/users/${userId}/assign-roles/`, 'POST', {
      group_ids: [role.id],
      replace_existing: false,
    }),
    onSuccess: () => {
      toast({ title: `User added to ${roleLabel(role)}` });
      qc.invalidateQueries({ queryKey: ['users-for-roles'] });
      setUserId('');
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Member to {roleLabel(role)}</DialogTitle></DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label>User</Label>
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!userId || mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add Member'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Permission Matrix ─────────────────────────────────────────────────────────

function PermissionMatrix({
  role, allPerms, onSaved,
}: { role: Role; allPerms: Perm[]; onSaved: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const editable = role.is_editable !== false;

  const sections = useMemo(() => buildSections(allPerms), [allPerms]);

  // Track selected permission IDs as a Set (local state, save on demand)
  const [selected, setSelected] = useState<Set<number>>(new Set(role.permissions.map(p => p.id)));
  const [dirty, setDirty] = useState(false);
  const [activeSection, setActiveSection] = useState('');

  // Reset when role changes
  useEffect(() => {
    // The API only returns modules included in this organization's plan. Do
    // not retain legacy or inactive-module permissions when saving a role.
    const allowedIds = new Set(allPerms.map((permission) => permission.id));
    setSelected(new Set(role.permissions.filter((permission) => allowedIds.has(permission.id)).map((permission) => permission.id)));
    setDirty(false);
  }, [role.id, allPerms]);

  useEffect(() => {
    if (!sections.some((section) => section.appLabel === activeSection)) {
      setActiveSection(sections[0]?.appLabel ?? '');
    }
  }, [activeSection, sections]);

  const toggle = (id: number) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setDirty(true);
  };

  // Toggle all CRUD for a model row
  const toggleModel = (group: ModelGroup) => {
    const ids = [
      ...Object.values(group.perms).map(p => p.id),
      ...group.actions.map(p => p.id),
    ];
    const allOn = ids.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allOn) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
    setDirty(true);
  };

  // Toggle all for a module section
  const toggleModule = (section: ModuleSection) => {
    const ids: number[] = [];
    section.models.forEach(g => {
      Object.values(g.perms).forEach(p => ids.push(p.id));
      g.actions.forEach(p => ids.push(p.id));
    });
    section.standaloneActions.forEach(p => ids.push(p.id));
    const allOn = ids.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allOn) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => api(token!, `/roles/${role.id}/`, 'PATCH', {
      permission_ids: Array.from(selected),
    }),
    onSuccess: () => {
      toast({ title: 'Permissions saved' });
      setDirty(false);
      onSaved();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      {!editable && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This shared role can be assigned inside the tenant, but only a super admin can change its permissions.
        </div>
      )}
      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <TabsList className="h-auto w-full justify-start gap-5 overflow-x-auto rounded-none border-b bg-transparent p-0">
          {sections.map((section) => (
            <TabsTrigger
              key={section.appLabel}
              value={section.appLabel}
              className="shrink-0 rounded-none border-b-2 border-transparent px-1 pb-2 pt-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {section.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.filter((section) => section.appLabel === activeSection).map(section => {
        const sectionIds: number[] = [];
        section.models.forEach(g => {
          Object.values(g.perms).forEach(p => sectionIds.push(p.id));
          g.actions.forEach(p => sectionIds.push(p.id));
        });
        section.standaloneActions.forEach(p => sectionIds.push(p.id));
        const sectionAllOn = sectionIds.length > 0 && sectionIds.every(id => selected.has(id));
        const sectionSomeOn = !sectionAllOn && sectionIds.some(id => selected.has(id));

        // Collect action columns for this section (approve/recall/export etc.)
        const actionCols = Array.from(
          new Set(
            section.models.flatMap(g => g.actions.map(p => p.codename))
          )
        );

        return (
          <TabsContent key={section.appLabel} value={section.appLabel} className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => editable && toggleModule(section)}
                className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                <Checkbox
                  checked={sectionAllOn}
                  // indeterminate via data attribute
                  data-state={sectionSomeOn ? 'indeterminate' : sectionAllOn ? 'checked' : 'unchecked'}
                  className="h-3.5 w-3.5 pointer-events-none"
                  onCheckedChange={() => {}}
                />
                {section.label}
              </button>
              <div className="flex-1 border-t border-dashed" />
              <span className="text-[10px] text-muted-foreground">
                {sectionIds.filter(id => selected.has(id)).length}/{sectionIds.length}
              </span>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground w-48 min-w-[160px]">Object</th>
                    {CRUD_ACTIONS.map(a => (
                      <th key={a} className="text-center px-2 py-2 font-medium text-xs text-muted-foreground w-16">
                        {CRUD_LABELS[a]}
                      </th>
                    ))}
                    {actionCols.map(code => (
                      <th key={code} className="text-center px-2 py-2 font-medium text-xs text-amber-600 w-20">
                        {ACTION_CODENAMES[code] ?? code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {section.standaloneActions.length > 0 && (
                    <tr className="hover:bg-muted/20">
                      <td className="px-3 py-2 text-xs text-muted-foreground italic">Actions</td>
                      {CRUD_ACTIONS.map(a => <td key={a} />)}
                      {section.standaloneActions.map(p => (
                        <td key={p.id} className="text-center px-2 py-2">
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => editable && toggle(p.id)}
                            className="h-4 w-4"
                            disabled={!editable}
                          />
                        </td>
                      ))}
                    </tr>
                  )}
                  {section.models.map(group => {
                    const rowIds = [
                      ...Object.values(group.perms).map(p => p.id),
                      ...group.actions.map(p => p.id),
                    ];
                    const rowAllOn = rowIds.length > 0 && rowIds.every(id => selected.has(id));
                    return (
                      <tr key={group.model} className="hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => editable && toggleModel(group)}
                            className="flex items-center gap-1.5 text-left hover:text-primary transition-colors"
                          >
                            <Checkbox
                              checked={rowAllOn}
                              data-state={
                                rowIds.some(id => selected.has(id)) && !rowAllOn
                                  ? 'indeterminate'
                                  : rowAllOn ? 'checked' : 'unchecked'
                              }
                              className="h-3.5 w-3.5 pointer-events-none"
                              onCheckedChange={() => {}}
                            />
                            <span className="text-xs font-medium">{group.display}</span>
                          </button>
                        </td>
                        {CRUD_ACTIONS.map(a => {
                          const perm = group.perms[a];
                          return (
                            <td key={a} className="text-center px-2 py-2">
                              {perm ? (
                                <Checkbox
                                  checked={selected.has(perm.id)}
                                  onCheckedChange={() => editable && toggle(perm.id)}
                                  className="h-4 w-4"
                                  disabled={!editable}
                                />
                              ) : (
                                <span className="text-muted-foreground/30 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                        {actionCols.map(code => {
                          const perm = group.actions.find(p => p.codename === code);
                          return (
                            <td key={code} className="text-center px-2 py-2">
                              {perm ? (
                                <Checkbox
                                  checked={selected.has(perm.id)}
                                  onCheckedChange={() => editable && toggle(perm.id)}
                                  className="h-4 w-4 border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                                  disabled={!editable}
                                />
                              ) : (
                                <span className="text-muted-foreground/30 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>
        );
      })}
      </Tabs>

      {/* Sticky save bar */}
      <div className={`sticky bottom-0 bg-background border-t pt-3 pb-1 flex items-center justify-between gap-3 transition-opacity ${dirty ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <p className="text-xs text-muted-foreground">
          {selected.size} permission{selected.size !== 1 ? 's' : ''} selected
          {dirty && <span className="ml-1.5 text-amber-600 font-medium">· unsaved changes</span>}
        </p>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => saveMutation.mutate()}
          disabled={!editable || !dirty || saveMutation.isPending}
        >
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? 'Saving…' : 'Save Permissions'}
        </Button>
      </div>
    </div>
  );
}

// ── Members Panel ─────────────────────────────────────────────────────────────

function MembersPanel({ role, allUsers }: { role: Role; allUsers: any[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const assignable = role.is_assignable !== false;

  const members = allUsers.filter(u =>
    (u.groups ?? []).some((g: any) => g.id === role.id || g.name === role.name)
  );

  const removeFromRole = useMutation({
    mutationFn: (userId: number) => {
      const u = allUsers.find(u => u.id === userId)!;
      const remaining = (u.groups ?? [])
        .filter((g: any) => g.id !== role.id)
        .map((g: any) => g.id);
      return api(token!, `/users/${userId}/assign-roles/`, 'POST', {
        group_ids: remaining, replace_existing: true,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users-for-roles'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length !== 1 ? 's' : ''} in this role
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAdd(true)} disabled={!assignable}>
          <Plus className="h-3.5 w-3.5" /> Add Member
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
          <Users className="h-8 w-8 opacity-30" />
          <p className="text-sm">No users in this role yet.</p>
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {members.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}
                </p>
                <p className="text-xs text-muted-foreground">{u.email || u.username}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => removeFromRole.mutate(u.id)}
                disabled={!assignable || removeFromRole.isPending}
              >
                <UserMinus className="h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddMemberDialog role={role} open={showAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Roles() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editorTab, setEditorTab] = useState<'permissions' | 'members'>('permissions');

  const { data: rolesRaw, isLoading: rolesLoading, refetch } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api(token!, '/roles/?page_size=100'),
    enabled: !!token,
  });
  const { data: usersData } = useQuery({
    queryKey: ['users-for-roles'],
    queryFn: () => api(token!, '/users/?page_size=200'),
    enabled: !!token,
  });
  const { data: permsData, isLoading: permsLoading } = useQuery({
    queryKey: ['all-permissions'],
    queryFn: () => api(token!, '/permissions/'),
    enabled: !!token,
  });

  const roles: Role[] = rolesRaw?.results ?? [];
  const allUsers: any[] = usersData?.results ?? [];
  // Permissions API is now unpaginated, returns array directly
  const allPerms: Perm[] = Array.isArray(permsData)
    ? permsData
    : (permsData?.results ?? []);

  const selectedRole = roles.find(r => r.id === selectedId) ?? null;

  // Auto-select first role when list loads
  useEffect(() => {
    if (!selectedId && roles.length > 0) setSelectedId(roles[0].id);
  }, [roles.length]);

  const deleteRole = useMutation({
    mutationFn: (id: number) => api(token!, `/roles/${id}/`, 'DELETE'),
    onSuccess: () => {
      toast({ title: 'Role deleted' });
      setSelectedId(null);
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const renameRole = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api(token!, `/roles/${id}/`, 'PATCH', { name }),
    onSuccess: () => {
      toast({ title: 'Role renamed' });
      setRenaming(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const memberCount = (role: Role) =>
    allUsers.filter(u =>
      (u.groups ?? []).some((g: any) => g != null && (g.id === role.id || g.name === role.name))
    ).length;

  return (
    <div className="space-y-5">
      <ERPPageHeader
        title="Roles & Permissions"
        description="Manage access to your organization’s data and workflows."
      />
      <div className="flex min-h-[calc(100vh-15rem)] overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      {/* ── Left sidebar: role list ─────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r flex flex-col bg-card">
        <div className="px-4 py-3 border-b bg-muted/15">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Roles</span>
            </div>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setShowCreate(true)}>
              <Plus className="h-3 w-3" /> New
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain py-2">
          {rolesLoading ? (
            <p className="text-xs text-muted-foreground text-center py-6 animate-pulse">Loading…</p>
          ) : (
            roles.map(role => {
              const count = memberCount(role);
              const isSelected = role.id === selectedId;
              return (
                <div
                  key={role.id}
                  className={`group flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-l-2 border-primary bg-primary/10'
                      : 'hover:bg-muted/40'
                  }`}
                  onClick={() => setSelectedId(role.id)}
                >
                  {renaming === role.id ? (
                    <form
                      className="flex items-center gap-1 flex-1"
                      onSubmit={e => {
                        e.preventDefault();
                        if (renameValue.trim()) renameRole.mutate({ id: role.id, name: renameValue.trim() });
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        className="h-6 text-xs px-1.5 flex-1"
                        onBlur={() => setRenaming(null)}
                        onKeyDown={e => e.key === 'Escape' && setRenaming(null)}
                      />
                      <button type="submit" className="text-primary hover:text-primary/80">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{roleLabel(role)}</p>
                          <p className="text-[10px] text-muted-foreground">{count} member{count !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          title="Rename"
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                          onClick={e => {
                            e.stopPropagation();
                            setRenaming(role.id);
                            setRenameValue(roleLabel(role));
                          }}
                          disabled={role.is_editable === false}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          title="Delete"
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          onClick={e => { e.stopPropagation(); setDeleteTarget(role); }}
                          disabled={role.is_editable === false}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t px-3 py-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {/* ── Right panel: editor ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 lg:p-6">
        {!selectedRole ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 min-h-[300px]">
            <Shield className="h-12 w-12 opacity-20" />
            <p className="text-sm">Select a role to manage its permissions and members.</p>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Create your first role
            </Button>
          </div>
        ) : (
          <div className="w-full max-w-none space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b">
              <div>
                <h2 className="text-sm font-semibold">{roleLabel(selectedRole)}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selectedRole.scope === 'tenant' ? 'Organization role' : 'Shared system role'} · {memberCount(selectedRole)} user{memberCount(selectedRole) !== 1 ? 's' : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setEditorTab('members')}
              >
                View Users
              </Button>
            </div>

            {editorTab === 'members' ? (
              <div className="space-y-4">
                <Button size="sm" variant="ghost" className="px-0 text-xs text-primary hover:bg-transparent hover:text-primary" onClick={() => setEditorTab('permissions')}>
                  ← Back to permissions
                </Button>
                <MembersPanel role={selectedRole} allUsers={allUsers} />
              </div>
            ) : permsLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading permissions…</p>
            ) : (
              <PermissionMatrix
                key={selectedRole.id}
                role={selectedRole}
                allPerms={allPerms}
                onSaved={() => qc.invalidateQueries({ queryKey: ['roles'] })}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <CreateRoleDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget ? roleLabel(deleteTarget) : ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the role and revoke it from all {deleteTarget ? memberCount(deleteTarget) : 0} member{deleteTarget && memberCount(deleteTarget) !== 1 ? 's' : ''}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteRole.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}
