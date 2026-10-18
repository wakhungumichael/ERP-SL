import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
  Shield, Users, Pencil, Check, KeyRound,
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
  Platform_Core: 'Core',
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
  can_view_workspace_dashboard: 'Workspace Dashboard',
  can_access_finance_workspace: 'Finance Workspace',
  can_view_erp_reports: 'ERP Reports',
  can_view_weighbridge_overview: 'Weighbridge Overview',
  can_view_sales_overview: 'Sales Overview',
  can_view_inventory_overview: 'Inventory Overview',
  can_view_finance_overview: 'Finance Overview',
  can_view_crm_overview: 'CRM Overview',
  can_view_ticketing_overview: 'Ticketing Overview',
  can_view_manufacturing_overview: 'Manufacturing Overview',
  can_view_retail_overview: 'Retail Overview',
  can_view_services_overview: 'Services Overview',
  can_view_procurement_overview: 'Procurement Overview',
  can_view_budgeting_overview: 'Budgeting Overview',
  can_view_hr_overview: 'HR Overview',
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
  can_reprint_recent_weighbridge_receipts: 'Receipt Reprint',
  can_view_customer_statements: 'Customer Statements',
  publish_workflowdefinition: 'Publish Workflow',
  archive_workflowdefinition: 'Archive Workflow',
  duplicate_workflowdefinition: 'Create Workflow Revision',
  manage_workflow_nodes: 'Manage Approval Steps',
  manage_workflow_transitions: 'Manage Workflow Routes',
  manage_workflow_conditions: 'Manage Workflow Conditions',
  manage_workflow_assignments: 'Manage Workflow Assignments',
  forward_workflow: 'Forward for Approval',
  approve_workflow: 'Review & Approve Workflows',
  view_tenant_audit_logs: 'View Organization Audit Logs',
  view_global_audit_logs: 'View Global Audit Logs',
  export_audit_logs: 'Export Audit Logs',
  view_tenant_access_logs: 'View Organization Access Logs',
  view_global_access_logs: 'View Global Access Logs',
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
  if (perm.content_type.app_label === 'SL_Weighbridge' && perm.content_type.model === 'customer') {
    return 'Weighbridge Customers';
  }
  if (perm.content_type.app_label === 'SL_Sales' && perm.content_type.model === 'salescustomer') {
    return 'Sales Customers';
  }
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
      } else {
        // Keep every custom permission visible. Core workflow and audit rights
        // must not disappear simply because they are outside CRUD naming.
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
  const [permissionSearch, setPermissionSearch] = useState('');

  // Reset when role changes
  useEffect(() => {
    // The API only returns modules included in this organization's plan. Do
    // not retain legacy or inactive-module permissions when saving a role.
    const allowedIds = new Set(allPerms.map((permission) => permission.id));
    setSelected(new Set(role.permissions.filter((permission) => allowedIds.has(permission.id)).map((permission) => permission.id)));
    setDirty(false);
  }, [role.id, allPerms]);

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

  const enablePermissionCodes = (section: ModuleSection, codes: string[]) => {
    const enabledIds = [
      ...section.models.flatMap(group => [...Object.values(group.perms), ...group.actions]),
      ...section.standaloneActions,
    ].filter(permission => codes.includes(permission.codename)).map(permission => permission.id);
    setSelected(prev => new Set([...prev, ...enabledIds]));
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
      <div className="rounded-xl border bg-muted/10 p-4">
        <p className="font-semibold text-sm">Search permissions</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Open a module to manage its record and workflow permissions.</p>
        <Input value={permissionSearch} onChange={event => setPermissionSearch(event.target.value)} className="mt-3 max-w-xl" placeholder="Search all permissions..." />
      </div>
      <Accordion type="multiple" defaultValue={sections.length ? [sections[0].appLabel] : []} className="rounded-xl border bg-card px-4">
        {sections.map(section => {
        const sectionIds: number[] = [];
        section.models.forEach(g => {
          Object.values(g.perms).forEach(p => sectionIds.push(p.id));
          g.actions.forEach(p => sectionIds.push(p.id));
        });
        section.standaloneActions.forEach(p => sectionIds.push(p.id));
        const sectionAllOn = sectionIds.length > 0 && sectionIds.every(id => selected.has(id));
        const searchTerm = permissionSearch.trim().toLowerCase();
        const matchesSearch = (group: ModelGroup) => !searchTerm || [
          group.display,
          ...Object.values(group.perms).map(permission => permission.name),
          ...group.actions.map(permission => ACTION_CODENAMES[permission.codename] ?? permission.name),
        ].join(' ').toLowerCase().includes(searchTerm);
        const visibleModels = section.models.filter(matchesSearch);
        const visibleStandalone = section.standaloneActions.filter(permission => !searchTerm || `${ACTION_CODENAMES[permission.codename] ?? permission.name} ${permission.codename}`.toLowerCase().includes(searchTerm));

        return (
            <AccordionItem key={section.appLabel} value={section.appLabel} className="border-border">
              <AccordionTrigger className="py-4 hover:no-underline">
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{section.label}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {sectionIds.filter(id => selected.has(id)).length}/{sectionIds.length} enabled
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="rounded-xl border bg-muted/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">{section.label} access</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Choose what this role can do. Select a whole record type for full access, then refine individual capabilities.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{sectionIds.filter(id => selected.has(id)).length}/{sectionIds.length} enabled</span>
                  <Button size="sm" variant="outline" disabled={!editable} onClick={() => toggleModule(section)}>
                    {sectionAllOn ? 'Clear module' : 'Enable module'}
                  </Button>
                </div>
              </div>
            </div>

                {section.appLabel === 'Platform_Core' && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <p className="text-sm font-semibold">Core access shortcuts</p>
              <p className="mt-0.5 text-xs text-muted-foreground">These add the common governance rights. You can still refine any individual permission below.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!editable} onClick={() => enablePermissionCodes(section, ['approve_workflow', 'view_workflowinboxitem', 'view_workflowentitybinding'])}>Enable workflow reviewer</Button>
                <Button size="sm" variant="outline" disabled={!editable} onClick={() => enablePermissionCodes(section, ['view_workflowdefinition', 'add_workflowdefinition', 'change_workflowdefinition', 'publish_workflowdefinition', 'manage_workflow_nodes', 'manage_workflow_transitions', 'manage_workflow_conditions', 'manage_workflow_assignments', 'manage_workflow_steps', 'manage_workflow_routes'])}>Enable workflow designer</Button>
                <Button size="sm" variant="outline" disabled={!editable} onClick={() => enablePermissionCodes(section, ['view_tenant_audit_logs', 'view_tenant_access_logs', 'export_audit_logs'])}>Enable audit reviewer</Button>
              </div>
            </div>}

                {visibleStandalone.length > 0 && <section className="mt-3 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold">Workspace & special access</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleStandalone.map(permission => <label key={permission.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/30">
                  <Checkbox checked={selected.has(permission.id)} onCheckedChange={() => editable && toggle(permission.id)} disabled={!editable} className="border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500" />
                  {ACTION_CODENAMES[permission.codename] ?? permission.name}
                </label>)}
              </div>
            </section>}

                <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visibleModels.map(group => {
                const permissions = [...Object.values(group.perms), ...group.actions];
                const rowIds = permissions.map(permission => permission.id);
                const rowAllOn = rowIds.length > 0 && rowIds.every(id => selected.has(id));
                const rowSomeOn = rowIds.some(id => selected.has(id));
                return <section key={group.model} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => editable && toggleModel(group)} disabled={!editable} className="flex min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed">
                      <Checkbox checked={rowAllOn} data-state={rowSomeOn && !rowAllOn ? 'indeterminate' : rowAllOn ? 'checked' : 'unchecked'} className="pointer-events-none" onCheckedChange={() => {}} />
                      <span className="font-semibold text-sm leading-tight">{group.display}</span>
                    </button>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{rowIds.filter(id => selected.has(id)).length}/{rowIds.length}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t pt-3">
                    {permissions.map(permission => <label key={permission.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                      <Checkbox checked={selected.has(permission.id)} onCheckedChange={() => editable && toggle(permission.id)} disabled={!editable} className={group.actions.includes(permission) ? 'border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500' : ''} />
                      {CRUD_LABELS[extractCrudAction(permission.codename) as keyof typeof CRUD_LABELS] ?? ACTION_CODENAMES[permission.codename] ?? permission.name}
                    </label>)}
                  </div>
                </section>;
              })}
            </div>
                {visibleModels.length === 0 && visibleStandalone.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No permissions match this search.</div>}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

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
  const [editorTab, setEditorTab] = useState<'overview' | 'permissions' | 'members'>('overview');

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
      <div className="w-72 shrink-0 border-r flex flex-col bg-card">
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

        <div className="flex-1 space-y-4 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Select role</Label>
            <Select value={selectedId ? String(selectedId) : ''} onValueChange={(value) => { setSelectedId(Number(value)); setEditorTab('overview'); }} disabled={rolesLoading || roles.length === 0}>
              <SelectTrigger><SelectValue placeholder={rolesLoading ? 'Loading roles...' : 'Choose a role...'} /></SelectTrigger>
              <SelectContent className="max-h-80">
                {roles.map(role => (
                  <SelectItem key={role.id} value={String(role.id)}>
                    {roleLabel(role)} ({memberCount(role)} {memberCount(role) === 1 ? 'member' : 'members'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRole ? (
            <div className="rounded-xl border bg-muted/10 p-4">
              {renaming === selectedRole.id ? (
                <form className="flex items-center gap-2" onSubmit={event => {
                  event.preventDefault();
                  if (renameValue.trim()) renameRole.mutate({ id: selectedRole.id, name: renameValue.trim() });
                }}>
                  <Input autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => event.key === 'Escape' && setRenaming(null)} />
                  <Button size="sm" type="submit" disabled={!renameValue.trim() || renameRole.isPending}><Check className="h-3.5 w-3.5" /></Button>
                </form>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{roleLabel(selectedRole)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{memberCount(selectedRole)} assigned {memberCount(selectedRole) === 1 ? 'user' : 'users'}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={selectedRole.is_editable === false} onClick={() => { setRenaming(selectedRole.id); setRenameValue(roleLabel(selectedRole)); }}><Pencil className="h-3.5 w-3.5" /> Rename</Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive" disabled={selectedRole.is_editable === false} onClick={() => setDeleteTarget(selectedRole)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Create a role or select one from the list to manage it.</p>
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
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setEditorTab('permissions')}>
                  <KeyRound className="h-3.5 w-3.5" /> Permissions
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditorTab('members')}>
                  View Users
                </Button>
              </div>
            </div>

            {editorTab === 'overview' ? (
              <div className="rounded-xl border bg-muted/10 p-6">
                <ShieldCheck className="h-8 w-8 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">Manage {roleLabel(selectedRole)}</h3>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Open permissions to configure module access, workflow rights, and record actions. Users assigned to this role inherit those permissions immediately after they sign in again.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border bg-background p-4">
                    <p className="text-2xl font-semibold">{selectedRole.permissions.length}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Permissions currently assigned</p>
                  </div>
                  <div className="rounded-lg border bg-background p-4">
                    <p className="text-2xl font-semibold">{memberCount(selectedRole)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Users assigned to this role</p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button className="gap-1.5" onClick={() => setEditorTab('permissions')}>
                    <KeyRound className="h-4 w-4" /> Manage Permissions
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={() => setEditorTab('members')}>
                    <Users className="h-4 w-4" /> Manage Users
                  </Button>
                </div>
              </div>
            ) : editorTab === 'members' ? (
              <div className="space-y-4">
                <Button size="sm" variant="ghost" className="px-0 text-xs text-primary hover:bg-transparent hover:text-primary" onClick={() => setEditorTab('overview')}>
                  ← Back to role overview
                </Button>
                <MembersPanel role={selectedRole} allUsers={allUsers} />
              </div>
            ) : permsLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading permissions…</p>
            ) : (
              <div className="space-y-4">
                <Button size="sm" variant="ghost" className="px-0 text-xs text-primary hover:bg-transparent hover:text-primary" onClick={() => setEditorTab('overview')}>
                  ← Back to role overview
                </Button>
                <PermissionMatrix
                  key={selectedRole.id}
                  role={selectedRole}
                  allPerms={allPerms}
                  onSaved={() => qc.invalidateQueries({ queryKey: ['roles'] })}
                />
              </div>
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
