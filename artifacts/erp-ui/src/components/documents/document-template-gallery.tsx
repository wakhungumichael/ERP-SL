import { useState } from 'react';
import { Check, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const DOCUMENT_LAYOUT_TYPES = [
  { value: 'invoice', label: 'Invoices', field: 'invoice_template', scope: 'invoice previews, PDF downloads, and email attachments' },
  { value: 'quotation', label: 'Estimates / Quotes', field: 'estimate_template', scope: 'estimate previews, PDF downloads, and email attachments' },
  { value: 'receipt', label: 'Receipts', field: 'receipt_template', scope: 'receipt previews and printouts' },
  { value: 'statement', label: 'Statements', field: 'statement_template', scope: 'customer statement previews and PDF downloads' },
  { value: 'purchase_order', label: 'Purchase Orders', field: 'purchase_order_template', scope: 'purchase order previews and PDF downloads' },
  { value: 'report', label: 'Reports', field: 'report_template', scope: 'reports that use the shared document renderer' },
];

interface LayoutTemplate {
  id: number;
  name: string;
  document_type: string;
  tenant?: unknown;
  is_default?: boolean;
  is_active?: boolean;
  layout_key?: string;
  layout_description?: string;
}

interface Props {
  templates: LayoutTemplate[];
  settings: Record<string, any>;
  pending: boolean;
  onSelect: (template: { id: number | null; document_type: string }) => void;
  onPreview: (id: number) => void;
}

function LayoutThumbnail({ style, label }: { style: string; label: string }) {
  const modern = style === 'modern';
  const minimal = style === 'minimal';
  const compact = style === 'compact';
  const executive = style === 'executive';
  return <div aria-hidden="true" className="flex h-48 justify-center overflow-hidden rounded-t-xl border-b bg-slate-100 p-4">
    <div className={`w-36 bg-white p-3 text-slate-800 shadow-sm ${compact ? 'text-[5px]' : 'text-[6px]'}`}>
      {executive && <div className="mb-2 text-[10px] font-bold uppercase text-primary">{label}</div>}
      <div className={`mb-3 pb-2 ${modern ? 'flex flex-row-reverse justify-between border-t-4 border-primary bg-slate-800 p-2 text-white' : minimal ? 'space-y-2 text-center' : executive ? 'flex justify-between border border-l-4 border-l-primary bg-slate-50 p-2' : 'flex justify-between border-y border-slate-600 pt-2'}`}>
        <div><div className={`mb-1 inline-block h-3 w-5 ${modern ? 'bg-white/70' : 'bg-primary/50'}`} /><div className="font-bold">YOUR COMPANY</div><div className={`mt-1 h-0.5 w-10 ${modern ? 'bg-white/50' : 'bg-slate-300'}`} /></div>
        <div className={minimal ? '' : 'text-right'}>{!executive && <div className="font-bold uppercase">{label}</div>}<div className="mt-1">REF-0001</div></div>
      </div>
      <div className="mb-3 flex justify-between gap-3"><div className="h-3 w-12 bg-slate-100" /><div className="h-3 w-9 bg-slate-100" /></div>
      <div className={`h-3 border-y ${modern ? 'border-slate-800 bg-slate-800' : 'border-slate-300 bg-slate-100'}`} />
      {Array.from({length: compact ? 6 : 3}, (_, i) => <div key={i} className={`flex justify-between border-b border-slate-100 ${compact ? 'py-1' : 'py-1.5'}`}><span className="h-0.5 w-14 bg-slate-200" /><span className="h-0.5 w-6 bg-slate-200" /></div>)}
      <div className={`ml-auto mt-2 h-3 w-12 border-t ${modern ? 'bg-slate-800' : executive ? 'border-t-2 border-primary bg-slate-100' : 'border-slate-500'}`} />
    </div>
  </div>;
}

export function DocumentTemplateGallery({ templates, settings, pending, onSelect, onPreview }: Props) {
  const [type, setType] = useState('invoice');
  const document = DOCUMENT_LAYOUT_TYPES.find(item => item.value === type)!;
  const options = templates.filter(template => template.document_type === type && template.is_active !== false);
  const selected = settings[document.field]?.id;
  const automatic = options.find(template => template.tenant && template.is_default) ?? options.find(template => !template.tenant && template.is_default);
  const current = options.find(template => template.id === selected) ?? (!selected ? automatic : undefined);
  return <section aria-label="Document layouts" className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1"><h3 className="font-semibold">Document layouts</h3><p className="text-sm text-muted-foreground">Choose a layout for each document. Your organization’s logo, colors and details are included.</p></div>
      <div className="w-full shrink-0 sm:w-56"><label htmlFor="document-layout-type" className="mb-1 block text-xs font-medium">Document type</label><Select value={type} onValueChange={setType}><SelectTrigger id="document-layout-type"><SelectValue /></SelectTrigger><SelectContent>{DOCUMENT_LAYOUT_TYPES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div><p><span className="font-medium">Current layout: </span>{current?.name ?? (selected ? 'Selected organization template' : 'Automatic default')}{!selected && current ? ' (automatic)' : ''}</p><p className="mt-1 text-xs text-muted-foreground">Applies across this organization to {document.scope}. Selection saves immediately.</p></div>
      {selected && <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={pending} onClick={() => onSelect({ id: null, document_type: type })}>Use automatic default</Button>}
    </div>
    {options.length === 0 ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">No active layouts are available for this document.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {options.map(template => {
        const active = current?.id === template.id;
        return <article key={template.id} className={`min-w-0 overflow-hidden rounded-xl border ${active ? 'border-primary ring-1 ring-primary' : ''}`}>
          <LayoutThumbnail style={template.layout_key ?? 'custom'} label={document.label} />
          <div className="space-y-3 p-4"><div><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{template.name}</h4>{active && <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3 w-3" />{selected ? 'Selected' : 'Default'}</span>}</div><p className="mt-1 min-h-10 text-xs text-muted-foreground">{template.layout_description || (template.tenant ? 'Your organization’s custom layout.' : 'Shared document layout.')}</p></div>
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onPreview(template.id)}><Eye className="mr-1 h-3.5 w-3.5" />Preview</Button><Button type="button" size="sm" className="min-w-0 flex-1" disabled={pending || selected === template.id} variant={active ? 'secondary' : 'default'} onClick={() => onSelect(template)}>{selected === template.id ? 'Selected' : 'Use this layout'}</Button></div>
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
