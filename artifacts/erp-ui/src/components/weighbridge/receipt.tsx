import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Printer, Mail, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/use-auth';

export interface ReceiptTransaction {
  id: number;
  branch_name?: string;
  customer_name?: string;
  customer_email?: string;
  vehicle_plate?: string;
  vehicle_type_name?: string;
  operator?: string;
  item_name?: string;
  weight_type?: string;
  gross_weight?: number | null;
  tare_weight?: number | null;
  net_weight?: number | null;
  charge?: number | string | null;
  destination?: string;
  payment_mode?: string;
  payment_status?: string;
  status?: string;
  approval_status?: boolean;
  gross_weight_date?: string | null;
  tare_weight_date?: string | null;
  created_at?: string;
  updated_at?: string;
  manual_weight_capture?: boolean;
  weight_reason?: string;
  discounted?: boolean;
  camera_image_url?: string | null;
}

interface ReceiptDialogProps {
  transaction: ReceiptTransaction | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token?: string | null;
}

type ReceiptBranding = {
  logo_url?: string;
  primary_color?: string;
  footer_text?: string;
};

function fmt(dt?: string | null) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function kg(v?: number | null) {
  if (v == null || v === 0) return '—';
  return `${Number(v).toLocaleString()} kg`;
}

function kes(v?: number | string | null) {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export function ReceiptDialog({ transaction: t, open, onOpenChange, token }: ReceiptDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const tenantId = (user as any)?.tenant_id;
  const { data: settingsData } = useQuery({
    queryKey: ['receipt-tenant-settings', tenantId],
    enabled: open && !!token && !!tenantId,
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/settings/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  // Email state
  const [emailOpen, setEmailOpen]     = useState(false);
  const [emailAddr, setEmailAddr]     = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handlePrint = () => {
    if (!t || !token || !canPrintReceipt) return;
    fetch(`/api/commercial-weighbridge/transactions/${t.id}/receipt/`, {
      headers: { Authorization: `Token ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Failed to open receipt (${res.status})`);
        }
        const html = await res.text();
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        if (!win) throw new Error('Popup was blocked by the browser');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch((error: Error) => {
        // Do not bypass server-side teller receipt restrictions with a local print.
        if (error.message.includes('does not allow receipt reprints') || error.message.includes('outside your allowed teller receipt window')) {
          setEmailResult({ ok: false, msg: error.message });
          return;
        }
        if (!printRef.current) return;
        const content = printRef.current.innerHTML;
        const win = window.open('', '_blank', 'width=720,height=900');
        if (!win) return;
        win.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Weighbridge Receipt — TX${String(t?.id ?? '').padStart(5, '0')}</title>
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; background: #fff; padding: 20px; }
                .receipt { max-width: 400px; margin: 0 auto; border: 2px solid #000; padding: 16px; }
                .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
                .header h1 { font-size: 18px; font-weight: bold; letter-spacing: 2px; }
                .header h2 { font-size: 13px; font-weight: normal; margin-top: 2px; }
                .txid { font-size: 22px; font-weight: bold; text-align: center; margin: 8px 0; letter-spacing: 4px; }
                .section { margin-bottom: 10px; }
                .section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #000; margin-bottom: 6px; padding-bottom: 2px; }
                .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
                .label { color: #444; }
                .value { font-weight: bold; text-align: right; max-width: 55%; word-break: break-word; }
                .weights { background: #f5f5f5; border: 1px solid #000; padding: 8px; margin: 10px 0; }
                .net-weight { font-size: 20px; font-weight: bold; text-align: center; margin: 4px 0; }
                .net-label { font-size: 10px; text-align: center; text-transform: uppercase; letter-spacing: 2px; }
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                .footer { text-align: center; font-size: 10px; margin-top: 10px; color: #555; }
                .charge-row { font-size: 14px; font-weight: bold; border-top: 2px solid #000; padding-top: 6px; margin-top: 6px; display: flex; justify-content: space-between; }
                .manual-note { background: #fff3cd; border: 1px solid #ffc107; padding: 4px 6px; font-size: 10px; margin-top: 4px; }
                @media print { body { padding: 0; } }
              </style>
            </head>
            <body>${content}</body>
          </html>
        `);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); win.close(); }, 300);
      });
  };

  const openEmail = () => {
    setEmailAddr(t?.customer_email ?? '');
    setEmailResult(null);
    setEmailOpen(true);
  };

  const handleSendEmail = async () => {
    if (!t || !token) return;
    setEmailSending(true);
    setEmailResult(null);
    try {
      const res = await fetch(
        `/api/commercial-weighbridge/transactions/${t.id}/email-receipt/`,
        {
          method: 'POST',
          headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailAddr.trim() }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      setEmailResult({ ok: true, msg: body.message ?? 'Receipt sent.' });
    } catch (err: any) {
      setEmailResult({ ok: false, msg: err?.message ?? 'Failed to send email.' });
    } finally {
      setEmailSending(false);
    }
  };

  if (!t) return null;

  const canPrintReceipt = t.payment_status === 'Paid' || t.payment_mode === 'Debt';
  const receiptStatusLabel = t.payment_status || 'Pending';
  const txNum = String(t.id).padStart(5, '0');
  const settings = settingsData?.data ?? settingsData ?? {};
  const tenantCompanyName = (user as any)?.tenant_name || 'SL-ERP';
  const branding: ReceiptBranding = {
    logo_url: settings.logo_url || '',
    primary_color: settings.primary_color || '#E85D26',
    footer_text: settings.footer_text || '',
  };
  const footerText = branding.footer_text || tenantCompanyName;

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) { setEmailOpen(false); setEmailResult(null); } }}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono font-bold tracking-widest">WEIGHBRIDGE RECEIPT</DialogTitle>
        </DialogHeader>

        {/* Action buttons */}
        <div className="flex gap-2 mb-3">
          <Button size="sm" onClick={handlePrint} className="gap-2 flex-1 font-bold uppercase tracking-wide">
            <Printer className="h-4 w-4" /> Print Receipt
          </Button>
          {token && (
            <Button
              size="sm" variant="outline"
              onClick={emailOpen ? undefined : openEmail}
            className="gap-2 font-bold uppercase tracking-wide"
            disabled={!canPrintReceipt}
          >
              <Mail className="h-4 w-4" /> Email Receipt
            </Button>
          )}
        </div>

      {!canPrintReceipt && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Receipt printing is locked until payment is received. Debt transactions can still print with a payment pending mark.
        </div>
      )}

        {/* Email panel */}
        {emailOpen && (
          <div className="rounded-md border border-border bg-muted/40 p-3 mb-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Send receipt by email
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="customer@example.com"
                value={emailAddr}
                onChange={e => { setEmailAddr(e.target.value); setEmailResult(null); }}
                className="h-8 text-sm flex-1 font-mono"
                disabled={emailSending}
              />
              <Button
                size="sm" className="gap-1.5 font-bold uppercase tracking-wide"
                onClick={handleSendEmail}
                disabled={emailSending || !emailAddr.trim()}
              >
                {emailSending
                  ? <span className="h-3 w-3 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin inline-block" />
                  : <Send className="h-3.5 w-3.5" />}
                Send
              </Button>
            </div>
            {emailResult && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${emailResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                {emailResult.ok && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                {emailResult.msg}
              </div>
            )}
          </div>
        )}

        {/* Receipt preview */}
        <div ref={printRef}>
          <div className="receipt" style={{ fontFamily: "'Courier New', monospace", border: `2px solid ${branding.primary_color}`, padding: 16, fontSize: 12, color: '#000', background: '#fff' }}>
            {/* Header */}
            <div className="header" style={{ textAlign: 'center', borderBottom: `2px dashed ${branding.primary_color}`, paddingBottom: 10, marginBottom: 10 }}>
              {branding.logo_url && (
                <div style={{ marginBottom: 8 }}>
                  <img src={branding.logo_url} alt="Tenant logo" style={{ maxWidth: 88, maxHeight: 72, objectFit: 'contain', margin: '0 auto' }} />
                </div>
              )}
              <div style={{ fontSize: 18, fontWeight: 'bold', letterSpacing: 2 }}>{t.branch_name ?? 'SL-ERP'}</div>
              <div style={{ fontSize: 13 }}>WEIGHBRIDGE TICKET</div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{t.branch_name ?? ''}</div>
            </div>

            <div className="txid" style={{ fontSize: 22, fontWeight: 'bold', textAlign: 'center', letterSpacing: 4, margin: '8px 0' }}>
              #{txNum}
            </div>

            {/* Status badge */}
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <span style={{
                display: 'inline-block', padding: '2px 12px',
                border: `2px solid ${t.payment_status === 'Paid' ? '#16a34a' : '#d97706'}`,
                color: t.payment_status === 'Paid' ? '#16a34a' : '#d97706',
                fontWeight: 'bold', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
              }}>
                {receiptStatusLabel}
              </span>
            </div>

            {/* Vehicle & customer */}
            <div className="section" style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, borderBottom: '1px solid #000', marginBottom: 6, paddingBottom: 2 }}>Vehicle & Customer</div>
              {([
                ['Plate Number', t.vehicle_plate],
                ['Vehicle Type', t.vehicle_type_name],
                ['Customer', t.customer_name],
                ['Item / Commodity', t.item_name],
                ['Destination', t.destination],
                ['Operator', t.operator],
              ] as [string, string | undefined][]).map(([label, value]) => value ? (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: '#444' }}>{label}</span>
                  <span style={{ fontWeight: 'bold', textAlign: 'right', maxWidth: '55%' }}>{value}</span>
                </div>
              ) : null)}
            </div>

            {t.camera_image_url && (
              <div style={{ margin: '10px 0', breakInside: 'avoid' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, borderBottom: '1px solid #000', marginBottom: 6, paddingBottom: 2 }}>Captured Vehicle Image</div>
                <img src={t.camera_image_url} alt="Captured vehicle" style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'contain', border: '1px solid #000' }} />
              </div>
            )}

            {/* Weights */}
            <div style={{ background: '#f5f5f5', border: '1px solid #000', padding: 8, margin: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#555' }}>Gross</div>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>{kg(t.gross_weight)}</div>
                  <div style={{ fontSize: 9, color: '#777' }}>{fmt(t.gross_weight_date)}</div>
                </div>
                <div style={{ padding: '0 8px', display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 'bold' }}>−</div>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#555' }}>Tare</div>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>{kg(t.tare_weight)}</div>
                  <div style={{ fontSize: 9, color: '#777' }}>{fmt(t.tare_weight_date)}</div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid #000', paddingTop: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: '#555' }}>NET WEIGHT</div>
                <div style={{ fontSize: 22, fontWeight: 'bold' }}>{kg(t.net_weight)}</div>
              </div>
            </div>

            {/* Payment */}
            <div className="section" style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, borderBottom: '1px solid #000', marginBottom: 6, paddingBottom: 2 }}>Payment</div>
              {([
                ['Payment Mode', t.payment_mode],
                ['Payment Status', t.payment_status],
                ['Discounted', t.discounted ? 'YES' : undefined],
              ] as [string, string | undefined][]).map(([label, value]) => value ? (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: '#444' }}>{label}</span>
                  <span style={{ fontWeight: 'bold' }}>{value}</span>
                </div>
              ) : null)}
              <div style={{ fontSize: 14, fontWeight: 'bold', borderTop: '2px solid #000', paddingTop: 6, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>CHARGE</span>
                <span>{kes(t.charge)}</span>
              </div>
              {t.payment_status !== 'Paid' && (
                <div style={{ marginTop: 6, padding: '6px 8px', border: '1px solid #d97706', background: '#fff7ed', color: '#b45309', fontSize: 10, fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 }}>
                  PAYMENT PENDING
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div style={{ borderTop: '1px dashed #000', paddingTop: 8, marginTop: 8, fontSize: 10, color: '#555' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>First Weight:</span><span>{fmt(t.gross_weight_date ?? t.created_at)}</span>
              </div>
              {t.tare_weight_date && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Second Weight:</span><span>{fmt(t.tare_weight_date)}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ textAlign: 'center', fontSize: 10, marginTop: 12, color: '#555', borderTop: `1px dashed ${branding.primary_color}`, paddingTop: 8 }}>
              <div>{footerText}</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
