import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { ERPFormDialog } from '@/components/erp/forms/form-dialog';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
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

type TicketFormSchema = {
  id: number;
  name: string;
  slug: string;
  description: string;
  schema: { fields?: SchemaField[] };
  is_default: boolean;
  is_public: boolean;
  allowed_mime_types: string[];
  max_file_size_mb: number;
};

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select';

type SchemaField = {
  key: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
};

type FieldDraft = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  optionsText: string;
};

type TemplateKey = 'general' | 'partner' | 'billing';

type EditorState = {
  id: number | null;
  name: string;
  description: string;
  allowedMimeTypes: string;
  maxFileSizeMb: string;
  isDefault: boolean;
  isPublic: boolean;
  template: TemplateKey;
  fields: FieldDraft[];
};

const FORM_TEMPLATES: Record<TemplateKey, { label: string; description: string; fields: FieldDraft[] }> = {
  general: {
    label: 'General support',
    description: 'Best for websites and customer portals.',
    fields: [
      { id: '1', key: 'requester_name', label: 'Full name', type: 'text', required: true, optionsText: '' },
      { id: '2', key: 'requester_email', label: 'Email address', type: 'email', required: true, optionsText: '' },
      { id: '3', key: 'subject', label: 'Subject', type: 'text', required: true, optionsText: '' },
      { id: '4', key: 'category', label: 'Category', type: 'select', required: true, optionsText: 'billing, technical, account, general' },
      { id: '5', key: 'description', label: 'Issue details', type: 'textarea', required: true, optionsText: '' },
    ],
  },
  partner: {
    label: 'Partner escalation',
    description: 'Good for B2B escalations and service desks.',
    fields: [
      { id: '1', key: 'requester_name', label: 'Contact name', type: 'text', required: true, optionsText: '' },
      { id: '2', key: 'requester_email', label: 'Work email', type: 'email', required: true, optionsText: '' },
      { id: '3', key: 'company_name', label: 'Company', type: 'text', required: true, optionsText: '' },
      { id: '4', key: 'priority', label: 'Priority', type: 'select', required: true, optionsText: 'normal, high, urgent' },
      { id: '5', key: 'description', label: 'Escalation context', type: 'textarea', required: true, optionsText: '' },
    ],
  },
  billing: {
    label: 'Billing dispute',
    description: 'Focused on invoice and payment issues.',
    fields: [
      { id: '1', key: 'requester_name', label: 'Customer name', type: 'text', required: true, optionsText: '' },
      { id: '2', key: 'requester_email', label: 'Billing email', type: 'email', required: true, optionsText: '' },
      { id: '3', key: 'invoice_number', label: 'Invoice number', type: 'text', required: true, optionsText: '' },
      { id: '4', key: 'issue_type', label: 'Issue type', type: 'select', required: true, optionsText: 'wrong amount, wrong address, duplicate bill, tax question' },
      { id: '5', key: 'description', label: 'What needs correction?', type: 'textarea', required: true, optionsText: '' },
    ],
  },
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short answer',
  email: 'Email',
  phone: 'Phone',
  textarea: 'Long answer',
  select: 'Dropdown',
};

function cloneFields(fields: FieldDraft[]): FieldDraft[] {
  return fields.map((field, index) => ({ ...field, id: `${Date.now()}-${index}-${field.key || 'field'}` }));
}

function blankState(): EditorState {
  return {
    id: null,
    name: '',
    description: '',
    allowedMimeTypes: 'image/png, image/jpeg, application/pdf',
    maxFileSizeMb: '10',
    isDefault: false,
    isPublic: true,
    template: 'general',
    fields: cloneFields(FORM_TEMPLATES.general.fields),
  };
}

function schemaToDrafts(schema?: { fields?: SchemaField[] }): FieldDraft[] {
  const source = schema?.fields ?? [];
  if (!source.length) return cloneFields(FORM_TEMPLATES.general.fields);
  return source.map((field, index) => ({
    id: `${Date.now()}-${index}-${field.key || 'field'}`,
    key: String(field.key ?? ''),
    label: String(field.label ?? ''),
    type: (field.type as FieldType) || 'text',
    required: Boolean(field.required),
    optionsText: Array.isArray(field.options) ? field.options.join(', ') : '',
  }));
}

function buildSchema(fields: FieldDraft[]) {
  return {
    fields: fields
      .map((field) => {
        const schemaField: SchemaField = {
          key: field.key.trim(),
          label: field.label.trim(),
          type: field.type,
          required: field.required,
        };
        if (field.type === 'select') {
          schemaField.options = field.optionsText
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean);
        }
        return schemaField;
      })
      .filter((field) => field.key && field.label),
  };
}

function inferTemplate(fields: FieldDraft[]): TemplateKey {
  const keys = new Set(fields.map((field) => field.key));
  if (keys.has('invoice_number') || keys.has('issue_type')) return 'billing';
  if (keys.has('company_name')) return 'partner';
  return 'general';
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
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'internal'>('all');
  const [defaultFilter, setDefaultFilter] = useState<'all' | 'default' | 'non_default'>('all');

  const { data, isLoading } = useQuery<TicketFormSchema[]>({
    queryKey: ['ticketing-forms'],
    enabled: !!token,
    queryFn: () => authed(token!, '/api/ticketing/forms/'),
  });

  const forms = data ?? [];
  const filteredForms = useMemo(() => forms.filter((form) => {
    const text = search.trim().toLowerCase();
    const matchesSearch = !text || [form.name, form.slug, form.description].some((value) => String(value ?? '').toLowerCase().includes(text));
    const matchesVisibility = visibilityFilter === 'all' || (visibilityFilter === 'public' ? form.is_public : !form.is_public);
    const matchesDefault = defaultFilter === 'all' || (defaultFilter === 'default' ? form.is_default : !form.is_default);
    return matchesSearch && matchesVisibility && matchesDefault;
  }), [defaultFilter, forms, search, visibilityFilter]);

  const counts = useMemo(() => ({
    total: forms.length,
    public: forms.filter((form) => form.is_public).length,
    defaults: forms.filter((form) => form.is_default).length,
  }), [forms]);

  const columns: ERPTableColumn<TicketFormSchema>[] = [
    {
      key: 'name',
      label: 'Form',
      render: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">{row.slug}</div>
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Use Case',
      render: (row) => <span className="text-sm text-muted-foreground">{row.description || 'No description'}</span>,
    },
    {
      key: 'fields',
      label: 'Questions',
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {(row.schema?.fields ?? []).length} field{(row.schema?.fields ?? []).length === 1 ? '' : 's'}
        </span>
      ),
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
  ];

  function openCreate() {
    setEditor(blankState());
    setDialogOpen(true);
  }

  function openEdit(form: TicketFormSchema) {
    const draftFields = schemaToDrafts(form.schema);
    setEditor({
      id: form.id,
      name: form.name,
      description: form.description ?? '',
      allowedMimeTypes: (form.allowed_mime_types ?? []).join(', '),
      maxFileSizeMb: String(form.max_file_size_mb ?? 10),
      isDefault: form.is_default,
      isPublic: form.is_public,
      template: inferTemplate(draftFields),
      fields: draftFields,
    });
    setDialogOpen(true);
  }

  function updateField(id: string, patch: Partial<FieldDraft>) {
    setEditor((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  }

  function addField() {
    setEditor((current) => ({
      ...current,
      fields: [
        ...current.fields,
        { id: `${Date.now()}-new`, key: '', label: '', type: 'text', required: false, optionsText: '' },
      ],
    }));
  }

  function removeField(id: string) {
    setEditor((current) => ({
      ...current,
      fields: current.fields.filter((field) => field.id !== id),
    }));
  }

  function applyTemplate(template: TemplateKey) {
    setEditor((current) => ({
      ...current,
      template,
      fields: cloneFields(FORM_TEMPLATES[template].fields),
    }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editor.name.trim()) throw new Error('Form name is required.');
      const schema = buildSchema(editor.fields);
      if (!schema.fields.length) throw new Error('Add at least one form field before saving.');
      const payload = {
        name: editor.name.trim(),
        description: editor.description.trim(),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-forms'] });
      setDialogOpen(false);
      toast({ title: editor.id ? 'Form updated' : 'Form created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not save form', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ticketing/forms/${id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete form');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticketing-forms'] });
      setDialogOpen(false);
      toast({ title: 'Form deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not delete form', description: error.message, variant: 'destructive' });
    },
  });

  const fieldCount = editor.fields.length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Forms & Intake Flow</h1>
          <p className="mt-1 text-sm text-muted-foreground">Build public request forms the same way we maintain ERP master data.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          New Intake Form
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Setup Flow</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 1</div>
              <div className="mt-2 font-medium">Pick a form type</div>
              <p className="mt-1 text-sm text-muted-foreground">Start from a support, partner, or billing template.</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 2</div>
              <div className="mt-2 font-medium">Adjust the questions</div>
              <p className="mt-1 text-sm text-muted-foreground">Add only the fields your team actually needs.</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 3</div>
              <div className="mt-2 font-medium">Publish externally</div>
              <p className="mt-1 text-sm text-muted-foreground">Mark the form public and make it the default if needed.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
          <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.total}</div><div className="text-sm text-muted-foreground">Total Forms</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.public}</div><div className="text-sm text-muted-foreground">Public Forms</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.defaults}</div><div className="text-sm text-muted-foreground">Default Forms</div></CardContent></Card>
        </div>
      </div>

      <ERPFilterBar
        searchSlot={(
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by form name, slug, or purpose"
          />
        )}
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
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Default state" /></SelectTrigger>
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
          <CardTitle>Form Register</CardTitle>
        </CardHeader>
        <CardContent>
          <ERPDataTable
            columns={columns}
            rows={filteredForms}
            loading={isLoading}
            loadingLabel="Loading intake forms..."
            emptyState="No forms match the current filters."
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
        title={editor.id ? 'Edit Intake Form' : 'Create Intake Form'}
        maxWidthClassName="max-w-5xl"
        footer={(
          <div className="flex w-full justify-between gap-3">
            <div>
              {editor.id ? (
                <Button variant="destructive" onClick={() => deleteMutation.mutate(editor.id as number)} disabled={deleteMutation.isPending}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !editor.name.trim()}>
                {saveMutation.isPending ? 'Saving...' : editor.id ? 'Update Form' : 'Create Form'}
              </Button>
            </div>
          </div>
        )}
      >
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="form-name">Form name</Label>
                  <Input id="form-name" value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} placeholder="Customer Support Form" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-file-size">Max upload size (MB)</Label>
                  <Input id="max-file-size" value={editor.maxFileSizeMb} onChange={(event) => setEditor((current) => ({ ...current, maxFileSizeMb: event.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="form-description">Purpose</Label>
                <Textarea id="form-description" rows={3} value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))} placeholder="Used by customers on our public support page." />
              </div>

              <div className="space-y-2">
                <Label htmlFor="mime-types">Allowed attachments</Label>
                <Input id="mime-types" value={editor.allowedMimeTypes} onChange={(event) => setEditor((current) => ({ ...current, allowedMimeTypes: event.target.value }))} placeholder="image/png, image/jpeg, application/pdf" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <div className="font-medium">Default form</div>
                    <p className="text-sm text-muted-foreground">Use this when a channel does not pick a special form.</p>
                  </div>
                  <Switch checked={editor.isDefault} onCheckedChange={(value) => setEditor((current) => ({ ...current, isDefault: value }))} />
                </div>
                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <div className="font-medium">Public form</div>
                    <p className="text-sm text-muted-foreground">Allow websites and widgets to show this form.</p>
                  </div>
                  <Switch checked={editor.isPublic} onCheckedChange={(value) => setEditor((current) => ({ ...current, isPublic: value }))} />
                </div>
              </div>
            </div>

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Starter Template</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(Object.keys(FORM_TEMPLATES) as TemplateKey[]).map((templateKey) => {
                  const template = FORM_TEMPLATES[templateKey];
                  const active = editor.template === templateKey;
                  return (
                    <button
                      key={templateKey}
                      type="button"
                      onClick={() => applyTemplate(templateKey)}
                      className={`w-full rounded-xl border p-4 text-left transition ${active ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}
                    >
                      <div className="font-medium">{template.label}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Questions</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{fieldCount} fields in this intake flow.</p>
              </div>
              <Button variant="outline" onClick={addField}>
                <Plus className="mr-1 h-4 w-4" />
                Add Question
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {editor.fields.map((field, index) => (
                <div key={field.id} className="rounded-xl border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-medium">Question {index + 1}</div>
                    <Button variant="ghost" size="sm" onClick={() => removeField(field.id)} disabled={editor.fields.length <= 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1fr_1fr_180px]">
                    <div className="space-y-2">
                      <Label>Label</Label>
                      <Input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="Describe the question shown to the user" />
                    </div>
                    <div className="space-y-2">
                      <Label>Field key</Label>
                      <Input value={field.key} onChange={(event) => updateField(field.id, { key: event.target.value.toLowerCase().replace(/\s+/g, '_') })} placeholder="internal_key" />
                    </div>
                    <div className="space-y-2">
                      <Label>Answer type</Label>
                      <Select value={field.type} onValueChange={(value: FieldType) => updateField(field.id, { type: value })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((type) => (
                            <SelectItem key={type} value={type}>{FIELD_TYPE_LABELS[type]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {field.type === 'select' ? (
                    <div className="mt-4 space-y-2">
                      <Label>Dropdown choices</Label>
                      <Input value={field.optionsText} onChange={(event) => updateField(field.id, { optionsText: event.target.value })} placeholder="billing, technical, general" />
                    </div>
                  ) : null}
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/40 p-3">
                    <div>
                      <div className="font-medium">Required question</div>
                      <p className="text-sm text-muted-foreground">Requesters must answer this before submitting.</p>
                    </div>
                    <Switch checked={field.required} onCheckedChange={(value) => updateField(field.id, { required: value })} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </ERPFormDialog>
    </div>
  );
}
