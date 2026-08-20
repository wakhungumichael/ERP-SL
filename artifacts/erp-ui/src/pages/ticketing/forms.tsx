import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPFormDialog } from '@/components/erp/forms/form-dialog';

type TicketFormSchema = {
  id: number;
  name: string;
  slug: string;
  description: string;
  schema: Record<string, unknown>;
  is_default: boolean;
  is_public: boolean;
  allowed_mime_types: string[];
  max_file_size_mb: number;
};

type EditorState = {
  id: number | null;
  name: string;
  description: string;
  schemaText: string;
  allowedMimeTypes: string;
  maxFileSizeMb: string;
  isDefault: boolean;
  isPublic: boolean;
};

const DEFAULT_SCHEMA = {
  fields: [
    { key: 'requester_name', type: 'text', label: 'Name', required: true },
    { key: 'requester_email', type: 'email', label: 'Email', required: true },
    { key: 'subject', type: 'text', label: 'Subject', required: true },
    { key: 'category', type: 'select', label: 'Category', options: ['billing', 'technical', 'general'] },
    { key: 'description', type: 'textarea', label: 'Issue details', required: true },
  ],
};

function blankState(): EditorState {
  return {
    id: null,
    name: '',
    description: '',
    schemaText: JSON.stringify(DEFAULT_SCHEMA, null, 2),
    allowedMimeTypes: 'image/png, image/jpeg, application/pdf',
    maxFileSizeMb: '10',
    isDefault: false,
    isPublic: true,
  };
}

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

export default function TicketingForms() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(blankState());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'internal'>('all');
  const [defaultFilter, setDefaultFilter] = useState<'all' | 'default' | 'non_default'>('all');

  const { data, isLoading } = useQuery<TicketFormSchema[]>({
    queryKey: ['ticketing-forms'],
    enabled: !!token,
    queryFn: () => authed(token!, '/api/ticketing/forms/'),
  });

  const forms = data ?? [];
  const filteredForms = useMemo(() => {
    return forms.filter((form) => {
      const matchesSearch = !search.trim() || [
        form.name,
        form.slug,
        form.description,
      ].some((value) => String(value ?? '').toLowerCase().includes(search.trim().toLowerCase()));

      const matchesVisibility =
        visibilityFilter === 'all' ||
        (visibilityFilter === 'public' ? form.is_public : !form.is_public);

      const matchesDefault =
        defaultFilter === 'all' ||
        (defaultFilter === 'default' ? form.is_default : !form.is_default);

      return matchesSearch && matchesVisibility && matchesDefault;
    });
  }, [defaultFilter, forms, search, visibilityFilter]);

  const counts = useMemo(() => ({
    total: forms.length,
    public: forms.filter((form) => form.is_public).length,
    defaults: forms.filter((form) => form.is_default).length,
  }), [forms]);

  const columns: ERPTableColumn<TicketFormSchema>[] = [
    {
      key: 'name',
      label: 'Schema',
      render: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">{row.slug}</div>
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (row) => <span className="text-sm text-muted-foreground">{row.description || 'No description'}</span>,
    },
    {
      key: 'visibility',
      label: 'Visibility',
      render: (row) => (
        <div className="flex gap-2">
          {row.is_default ? <Badge variant="secondary">Default</Badge> : null}
          <Badge variant={row.is_public ? 'outline' : 'secondary'}>{row.is_public ? 'Public' : 'Internal'}</Badge>
        </div>
      ),
    },
    {
      key: 'attachments',
      label: 'Attachments',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {(row.allowed_mime_types ?? []).length} types • {row.max_file_size_mb} MB
        </span>
      ),
    },
  ];

  function openCreate() {
    setEditor(blankState());
    setDialogOpen(true);
    setJsonError('');
  }

  function openEdit(form: TicketFormSchema) {
    setEditor({
      id: form.id,
      name: form.name,
      description: form.description ?? '',
      schemaText: JSON.stringify(form.schema ?? DEFAULT_SCHEMA, null, 2),
      allowedMimeTypes: (form.allowed_mime_types ?? []).join(', '),
      maxFileSizeMb: String(form.max_file_size_mb ?? 10),
      isDefault: form.is_default,
      isPublic: form.is_public,
    });
    setDialogOpen(true);
    setJsonError('');
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      let schema: Record<string, unknown>;
      try {
        schema = JSON.parse(editor.schemaText);
        setJsonError('');
      } catch {
        setJsonError('Schema JSON must be valid before saving.');
        throw new Error('Invalid schema JSON.');
      }
      const payload = {
        name: editor.name,
        description: editor.description,
        schema,
        is_default: editor.isDefault,
        is_public: editor.isPublic,
        allowed_mime_types: editor.allowedMimeTypes.split(',').map((item) => item.trim()).filter(Boolean),
        max_file_size_mb: Number(editor.maxFileSizeMb || 10),
      };
      if (editor.id) {
        return authed(token!, `/api/ticketing/forms/${editor.id}/`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
      return authed(token!, '/api/ticketing/forms/', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['ticketing-forms'] });
      if (saved?.id) {
        setDialogOpen(false);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ticketing/forms/${id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete schema');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-forms'] });
      setDialogOpen(false);
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Forms & Schema</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage public intake forms the same way we manage other ERP master data.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          New Form Schema
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.total}</div><div className="text-sm text-muted-foreground">Total Schemas</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.public}</div><div className="text-sm text-muted-foreground">Public Schemas</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.defaults}</div><div className="text-sm text-muted-foreground">Default Schemas</div></CardContent></Card>
      </div>

      <ERPFilterBar
        searchSlot={
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by schema name, slug, or description"
          />
        }
        filterSlot={(
          <div className="flex flex-wrap items-center gap-3">
            <Select value={visibilityFilter} onValueChange={(value: 'all' | 'public' | 'internal') => setVisibilityFilter(value)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Visibility" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Visibility</SelectItem>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={defaultFilter} onValueChange={(value: 'all' | 'default' | 'non_default') => setDefaultFilter(value)}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Default Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Default States</SelectItem>
                <SelectItem value="default">Default Only</SelectItem>
                <SelectItem value="non_default">Non-default</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle>Schema Register</CardTitle>
        </CardHeader>
        <CardContent>
          <ERPDataTable
            columns={columns}
            rows={filteredForms}
            loading={isLoading}
            loadingLabel="Loading ticket form schemas…"
            emptyState="No form schemas match the current filters."
            onRowClick={openEdit}
            rowActions={(row) => (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(row.id)} disabled={deleteMutation.isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <ERPFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editor.id ? 'Edit Form Schema' : 'Create Form Schema'}
        maxWidthClassName="max-w-4xl"
        footer={(
          <div className="flex w-full justify-between gap-3">
            <div>
              {editor.id ? (
                <Button variant="destructive" onClick={() => deleteMutation.mutate(editor.id as number)} disabled={deleteMutation.isPending}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!editor.name.trim() || saveMutation.isPending}>
                <Pencil className="mr-1 h-4 w-4" />
                {saveMutation.isPending ? 'Saving…' : editor.id ? 'Update Schema' : 'Create Schema'}
              </Button>
            </div>
          </div>
        )}
      >
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schema-name">Name</Label>
              <Input id="schema-name" value={editor.name} onChange={(e) => setEditor((current) => ({ ...current, name: e.target.value }))} placeholder="Billing Support Form" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schema-max-file">Max File Size (MB)</Label>
              <Input id="schema-max-file" value={editor.maxFileSizeMb} onChange={(e) => setEditor((current) => ({ ...current, maxFileSizeMb: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schema-description">Description</Label>
            <Input id="schema-description" value={editor.description} onChange={(e) => setEditor((current) => ({ ...current, description: e.target.value }))} placeholder="Used by the public support center." />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schema-mime-types">Allowed MIME Types</Label>
            <Input id="schema-mime-types" value={editor.allowedMimeTypes} onChange={(e) => setEditor((current) => ({ ...current, allowedMimeTypes: e.target.value }))} placeholder="image/png, image/jpeg, application/pdf" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium">Default Schema</div>
                <div className="text-sm text-muted-foreground">Use this as the fallback form for new tenant integrations.</div>
              </div>
              <Switch checked={editor.isDefault} onCheckedChange={(value) => setEditor((current) => ({ ...current, isDefault: value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium">Publicly Accessible</div>
                <div className="text-sm text-muted-foreground">Allow external widgets and websites to request this schema.</div>
              </div>
              <Switch checked={editor.isPublic} onCheckedChange={(value) => setEditor((current) => ({ ...current, isPublic: value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schema-json">Schema JSON</Label>
            <Textarea
              id="schema-json"
              value={editor.schemaText}
              onChange={(e) => setEditor((current) => ({ ...current, schemaText: e.target.value }))}
              rows={18}
              className="font-mono text-xs"
            />
            {jsonError ? <p className="text-sm text-destructive">{jsonError}</p> : null}
          </div>
        </div>
      </ERPFormDialog>
    </div>
  );
}
