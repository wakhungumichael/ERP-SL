import { useState } from 'react';
import { FileText, LayoutTemplate, Pencil, Plus, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DOCUMENT_LAYOUT_TYPES, DocumentTemplateGallery } from './document-template-gallery';

export const DOCUMENT_DEFAULT_FIELDS = [
  'invoice_prefix', 'default_payment_terms_days', 'footer_text', 'default_tax_name', 'default_tax_rate',
  'invoice_address', 'invoice_tax_number', 'invoice_website', 'invoice_payment_instructions', 'print_qr_codes_enabled',
] as const;

type Defaults = Record<string, any>;
interface Props {
  settings: Defaults;
  templates: any[];
  loading: boolean;
  saving: boolean;
  selecting: boolean;
  onSave: (values: Defaults) => Promise<unknown>;
  onSelect: (template: { id: number | null; document_type: string }) => void;
  onPreview: (id: number) => void;
  onCreateTemplate: () => void;
}

export function OrganizationDocumentSettings({ settings, templates, loading, saving, selecting, onSave, onSelect, onPreview, onCreateTemplate }: Props) {
  const [draft, setDraft] = useState<Defaults | null>(null);
  const [layoutType, setLayoutType] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [qrDraft, setQrDraft] = useState<boolean | null>(null);
  const [qrError, setQrError] = useState('');
  const qrEnabled = qrDraft ?? settings.print_qr_codes_enabled !== false;
  const edit = () => {
    setError('');
    setDraft(Object.fromEntries(DOCUMENT_DEFAULT_FIELDS.map(field => [field, field === 'print_qr_codes_enabled' ? qrEnabled : settings[field] ?? (field === 'invoice_prefix' ? 'INV' : field === 'default_payment_terms_days' ? 30 : field === 'default_tax_rate' ? 0 : '')])));
  };
  const field = (key: string, value: unknown) => setDraft(current => ({ ...current, [key]: value }));
  const selectedType = DOCUMENT_LAYOUT_TYPES.find(type => type.value === layoutType);
  return <div className="space-y-6">
    <Card>
      <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1"><CardTitle className="flex items-center gap-2 text-lg"><FileText className="h-5 w-5" />Document defaults</CardTitle><p className="text-sm text-muted-foreground">Issuer details and print preferences shared by your organization.</p></div>
        <Button type="button" variant="outline" className="gap-2" onClick={edit} disabled={loading}><Pencil className="h-4 w-4" />Edit defaults</Button>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading document settings...</p> : <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Invoice numbering</dt><dd className="mt-1 font-medium">{settings.invoice_prefix || 'INV'}-YYYY-0001</dd></div>
          <div><dt className="text-xs text-muted-foreground">Invoice payment terms</dt><dd className="mt-1 font-medium">{settings.default_payment_terms_days ?? 30} days</dd></div>
          <div><dt className="flex items-center gap-1 text-xs text-muted-foreground"><QrCode className="h-3.5 w-3.5" />QR codes on documents</dt><dd className="mt-1 font-medium">{settings.print_qr_codes_enabled === false ? 'Disabled' : 'Enabled'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Issuer address</dt><dd className="mt-1 whitespace-pre-line break-words text-sm">{settings.invoice_address || 'Not set'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tax ID / PIN</dt><dd className="mt-1 break-words text-sm">{settings.invoice_tax_number || 'Not set'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Default tax</dt><dd className="mt-1 text-sm">{settings.default_tax_name || 'Tax'} ({settings.default_tax_rate ?? 0}%)</dd></div>
        </dl>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-lg"><QrCode className="h-5 w-5" />QR codes on documents</CardTitle></CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3"><Switch id="document-qr-enabled" checked={qrEnabled} disabled={loading || saving} onCheckedChange={value => { setQrDraft(value); setQrError(''); }} /><div><Label htmlFor="document-qr-enabled">Include QR codes on documents</Label><p className="mt-1 text-sm text-muted-foreground">Invoices, estimates, receipts, statements, purchase orders, payslips and supported reports. Applies when a document is generated again. The platform administrator can disable QR codes for all organizations.</p></div></div>
        {qrError && <p role="alert" className="text-sm text-destructive">{qrError}</p>}
        <Button type="button" disabled={loading || saving} onClick={async () => { setQrError(''); try { await onSave({ print_qr_codes_enabled: qrEnabled }); setQrDraft(null); } catch (e) { setQrError(e instanceof Error ? e.message : 'Unable to save QR settings.'); } }}>{saving ? 'Saving...' : 'Save QR settings'}</Button>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1"><CardTitle className="flex items-center gap-2 text-lg"><LayoutTemplate className="h-5 w-5" />Document layouts</CardTitle><p className="text-sm text-muted-foreground">Each selection applies to that document type across its modules.</p></div>
        <Button type="button" variant="outline" className="gap-2" onClick={onCreateTemplate} disabled={loading}><Plus className="h-4 w-4" />New custom layout</Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="hidden grid-cols-[1fr_1fr_auto] gap-4 border-b bg-muted/30 px-6 py-3 text-xs font-medium text-muted-foreground sm:grid"><span>Document type</span><span>Current layout</span><span>Actions</span></div>
        {DOCUMENT_LAYOUT_TYPES.map(type => {
          const options = templates.filter(template => template.document_type === type.value && template.is_active !== false);
          const selected = settings[type.field]?.id;
          const automatic = options.find(template => template.tenant && template.is_default) ?? options.find(template => !template.tenant && template.is_default);
          const current = options.find(template => template.id === selected) ?? (!selected ? automatic : undefined);
          return <div key={type.value} className="grid min-w-0 gap-3 border-b p-4 last:border-0 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-4 sm:px-6">
            <span className="font-medium">{type.label}</span>
            <div className="min-w-0"><p className="break-words text-sm">{current?.name || (selected ? 'Selected custom layout' : 'Automatic default')}</p><p className="mt-1 text-xs text-muted-foreground">{selected ? 'Organization selection' : 'Automatic selection'}</p></div>
            <div className="flex flex-wrap gap-2">{current && <Button type="button" size="sm" variant="ghost" aria-label={`Preview ${type.label} layout`} onClick={() => onPreview(current.id)}>Preview</Button>}<Button type="button" size="sm" variant="outline" aria-label={`Choose ${type.label} layout`} onClick={() => setLayoutType(type.value)} disabled={loading}>Choose layout</Button></div>
          </div>;
        })}
      </CardContent>
    </Card>
    <Dialog open={draft !== null} onOpenChange={open => { if (!open && !saving) setDraft(null); }}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-4xl max-h-[90dvh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 border-b p-5 pr-12 sm:p-6"><DialogTitle>Edit document defaults</DialogTitle><DialogDescription>Applies to future previews, downloads and printouts. Invoice-specific fields are marked below.</DialogDescription></DialogHeader>
        {draft && <form className="flex flex-1 min-h-0 flex-col overflow-hidden" onSubmit={async event => { event.preventDefault(); setError(''); try { const { print_qr_codes_enabled: _qr, ...defaults } = draft; await onSave(defaults); setDraft(null); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save document settings.'); } }}>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6 sm:p-6">
            <fieldset className="space-y-4"><legend className="mb-3 font-semibold">Organization details</legend><div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="document-address">Postal / physical address</Label><Textarea id="document-address" rows={3} value={draft.invoice_address} onChange={event => field('invoice_address', event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="document-tax-id">Tax ID / PIN</Label><Input id="document-tax-id" maxLength={80} value={draft.invoice_tax_number} onChange={event => field('invoice_tax_number', event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="document-website">Website</Label><Input id="document-website" type="url" placeholder="https://example.com" value={draft.invoice_website} onChange={event => field('invoice_website', event.target.value)} /></div>
            </div></fieldset>
            <fieldset className="space-y-4 border-t pt-5"><legend className="mb-3 font-semibold">Invoice defaults</legend><div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="document-invoice-prefix">Invoice number prefix</Label><Input id="document-invoice-prefix" required maxLength={10} value={draft.invoice_prefix} onChange={event => field('invoice_prefix', event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="document-payment-terms">Payment terms (days)</Label><Input id="document-payment-terms" type="number" min={0} step={1} required value={draft.default_payment_terms_days} onChange={event => field('default_payment_terms_days', event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="document-payment-instructions">Payment instructions</Label><Textarea id="document-payment-instructions" rows={3} placeholder="Bank or mobile payment details and the payment reference to use" value={draft.invoice_payment_instructions} onChange={event => field('invoice_payment_instructions', event.target.value)} /></div>
            </div></fieldset>
            <fieldset className="space-y-4 border-t pt-5"><legend className="mb-3 font-semibold">Shared tax and print preferences</legend><div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="document-tax-name">Default tax name</Label><Input id="document-tax-name" value={draft.default_tax_name} onChange={event => field('default_tax_name', event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="document-tax-rate">Default tax rate (%)</Label><Input id="document-tax-rate" type="number" min={0} step="0.01" required value={draft.default_tax_rate} onChange={event => field('default_tax_rate', event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="document-footer">Document footer</Label><Textarea id="document-footer" rows={2} value={draft.footer_text} onChange={event => field('footer_text', event.target.value)} /></div>
            </div></fieldset>
            {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t bg-background p-4 sm:px-6"><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save document defaults'}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
    <Dialog open={layoutType !== null} onOpenChange={open => { if (!open) setLayoutType(null); }}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-5xl max-h-[90dvh] p-4 sm:p-6">
        <DialogHeader className="pr-8"><DialogTitle>{selectedType?.label} layout</DialogTitle><DialogDescription>Preview a layout, then select it for this organization. Changes save immediately.</DialogDescription></DialogHeader>
        {layoutType && <DocumentTemplateGallery documentType={layoutType} templates={templates} settings={settings} pending={selecting} onSelect={onSelect} onPreview={onPreview} />}
      </DialogContent>
    </Dialog>
  </div>;
}
