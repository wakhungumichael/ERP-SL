import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Search, Send } from 'lucide-react';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

type TimelineItem = {
  kind?: string;
  author_name?: string;
  author_type?: string;
  message?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

type TicketTrackResponse = {
  ticket_id?: string;
  subject?: string;
  category?: string;
  priority?: string;
  status?: string;
  timeline?: TimelineItem[];
};

type CreateResponse = {
  ticket_id?: string;
  status?: string;
  tracking_token?: string;
};

type SupportFieldConfig = {
  key?: string;
  label?: string;
  type?: 'text' | 'email' | 'tel' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  enabled?: boolean;
  options?: string[];
};

const DEFAULT_SUPPORT_FIELDS: SupportFieldConfig[] = [
  { key: 'requester_name', label: 'Full name', type: 'text', placeholder: 'Your full name', required: false, enabled: true },
  { key: 'requester_email', label: 'Email address', type: 'email', placeholder: 'you@example.com', required: true, enabled: true },
  { key: 'requester_phone', label: 'Phone', type: 'tel', placeholder: '+254700000000', required: false, enabled: true },
  { key: 'category', label: 'Category', type: 'select', required: false, enabled: true, options: ['General help', 'Technical issue', 'Billing or invoice', 'Account access'] },
  { key: 'priority', label: 'Priority', type: 'select', required: false, enabled: true, options: ['Standard', 'High', 'Urgent', 'Low'] },
  { key: 'subject', label: 'Subject', type: 'text', placeholder: 'A short summary of your request', required: true, enabled: true },
  { key: 'description', label: 'Issue details', type: 'textarea', placeholder: 'Tell us what happened and what help you need.', required: true, enabled: true },
];

const CORE_FIELD_KEYS = new Set(['requester_name', 'requester_email', 'requester_phone', 'category', 'priority', 'subject', 'description']);

function normalizeSupportFields(raw: SupportFieldConfig[] | undefined): SupportFieldConfig[] {
  const configured = Array.isArray(raw) ? raw.filter((field) => field && field.key) : [];
  const merged = DEFAULT_SUPPORT_FIELDS.map((base) => {
    const override = configured.find((field) => field.key === base.key);
    return {
      ...base,
      ...override,
      key: base.key,
      enabled: base.key === 'requester_email' || base.key === 'subject' || base.key === 'description'
        ? true
        : override?.enabled ?? base.enabled ?? true,
      required: base.key === 'requester_email' || base.key === 'subject' || base.key === 'description'
        ? true
        : override?.required ?? base.required ?? false,
    };
  });
  const extras = configured
    .filter((field) => field.key && !CORE_FIELD_KEYS.has(field.key))
    .map((field) => ({
      key: field.key,
      label: field.label || field.key,
      type: field.type || 'text',
      placeholder: field.placeholder || '',
      required: Boolean(field.required),
      enabled: field.enabled !== false,
      options: Array.isArray(field.options) ? field.options : [],
    }));
  return [...merged, ...extras];
}

function endpoint(path: string) {
  return path;
}

function formatDate(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function MarketingSupportPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const resolvedTenantCode = tenantCode ?? site.tenant?.code ?? 'demo-metrix';
  const organizationName = site.tenant?.name ?? 'our team';
  const supportEmail = site.branding.support_email ?? '';
  const supportPage = site.support_page ?? {};
  const supportFields = useMemo(() => normalizeSupportFields(supportPage.form_fields), [supportPage.form_fields]);
  const visibleSupportFields = supportFields.filter((field) => field.enabled !== false);

  const [publicKey] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>({
    requester_name: '',
    requester_email: '',
    requester_phone: '',
    category: 'general',
    priority: 'normal',
    subject: '',
    description: '',
  });
  const [createStatus, setCreateStatus] = useState<{ tone: 'idle' | 'error' | 'success'; text: string }>({ tone: 'idle', text: '' });
  const [createdTicket, setCreatedTicket] = useState<CreateResponse | null>(null);

  const [trackTicketId, setTrackTicketId] = useState('');
  const [trackEmail, setTrackEmail] = useState('');
  const [trackStatus, setTrackStatus] = useState<{ tone: 'idle' | 'error' | 'success'; text: string }>({ tone: 'idle', text: '' });
  const [trackedTicket, setTrackedTicket] = useState<TicketTrackResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  useEffect(() => {
    setFormValues((current) => {
      const next = { ...current };
      for (const field of supportFields) {
        if (!(field.key! in next)) {
          if (field.key === 'category') {
            next[field.key!] = 'general';
          } else if (field.key === 'priority') {
            next[field.key!] = 'normal';
          } else {
            next[field.key!] = '';
          }
        }
      }
      return next;
    });
  }, [supportFields]);

  function setFieldValue(key: string, value: string) {
    setFormValues((current) => ({ ...current, [key]: value }));
  }

  function getFieldValue(key: string) {
    return formValues[key] ?? '';
  }

  function categoryApiValue(value: string) {
    switch (value) {
      case 'Technical issue':
      case 'technical':
        return 'technical';
      case 'Billing or invoice':
      case 'billing':
        return 'billing';
      case 'Account access':
      case 'account':
        return 'account';
      default:
        return 'general';
    }
  }

  function priorityApiValue(value: string) {
    switch (value) {
      case 'High':
      case 'high':
        return 'high';
      case 'Urgent':
      case 'urgent':
        return 'urgent';
      case 'Low':
      case 'low':
        return 'low';
      default:
        return 'normal';
    }
  }

  const missingRequiredField = visibleSupportFields.find((field) => field.required && !getFieldValue(field.key ?? '').trim());

  async function createTicket(event: React.FormEvent) {
    event.preventDefault();
    if (missingRequiredField) {
      setCreateStatus({ tone: 'error', text: `${missingRequiredField.label || 'This field'} is required.` });
      return;
    }
    setLoadingCreate(true);
    setCreateStatus({ tone: 'idle', text: 'Submitting ticket...' });
    setCreatedTicket(null);
    try {
      const customFields = Object.fromEntries(
        supportFields
          .filter((field) => field.key && !CORE_FIELD_KEYS.has(field.key) && getFieldValue(field.key).trim())
          .map((field) => [field.key!, getFieldValue(field.key!)]),
      );
      const response = await fetch(endpoint('/api/ticketing/v1/tickets/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': resolvedTenantCode,
          ...(publicKey.trim() ? { Authorization: `Bearer ${publicKey.trim()}` } : {}),
        },
        body: JSON.stringify({
          requester_name: getFieldValue('requester_name').trim(),
          requester_email: getFieldValue('requester_email').trim(),
          requester_phone: getFieldValue('requester_phone').trim(),
          subject: getFieldValue('subject').trim(),
          description: getFieldValue('description').trim(),
          category: categoryApiValue(getFieldValue('category')),
          priority: priorityApiValue(getFieldValue('priority')),
          source_page: `/landing/${resolvedTenantCode}/support`,
          source_channel: 'widget',
          custom_fields: {
            submitted_from: 'marketing-support-page',
            ...customFields,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || 'Ticket submission failed.');
      }
      setCreatedTicket(payload);
      setTrackTicketId(payload.ticket_id ?? '');
      setTrackEmail(getFieldValue('requester_email').trim());
      setCreateStatus({ tone: 'success', text: 'Ticket submitted successfully.' });
    } catch (error) {
      setCreateStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Ticket submission failed.' });
    } finally {
      setLoadingCreate(false);
    }
  }

  function renderSupportField(field: SupportFieldConfig) {
    const key = field.key ?? '';
    const label = field.label || key;
    const type = field.type || 'text';
    const placeholder = field.placeholder || '';
    const value = getFieldValue(key);
    const defaultOptions = key === 'category'
      ? ['General help', 'Technical issue', 'Billing or invoice', 'Account access']
      : key === 'priority'
        ? ['Standard', 'High', 'Urgent', 'Low']
        : [];
    const options = Array.isArray(field.options) && field.options.length ? field.options : defaultOptions;

    if (type === 'textarea') {
      return (
        <div key={key}>
          <label className="mb-2 block text-sm font-semibold text-[#111827]">{label}</label>
          <textarea className="min-h-[150px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm" value={value} onChange={(e) => setFieldValue(key, e.target.value)} placeholder={placeholder} />
        </div>
      );
    }

    if (type === 'select') {
      return (
        <div key={key}>
          <label className="mb-2 block text-sm font-semibold text-[#111827]">{label}</label>
          <select className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm" value={value} onChange={(e) => setFieldValue(key, e.target.value)}>
            {options.map((option) => (
              <option key={`${key}-${option}`} value={option}>{option}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={key}>
        <label className="mb-2 block text-sm font-semibold text-[#111827]">{label}</label>
        <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm" type={type} value={value} onChange={(e) => setFieldValue(key, e.target.value)} placeholder={placeholder} />
      </div>
    );
  }

  async function loadStatus() {
    if (!trackTicketId.trim() || !trackEmail.trim()) {
      setTrackStatus({ tone: 'error', text: 'Enter both the ticket ID and requester email.' });
      return;
    }
    setLoadingTrack(true);
    setTrackStatus({ tone: 'idle', text: 'Checking ticket status...' });
    setTrackedTicket(null);
    try {
      const response = await fetch(endpoint(`/api/ticketing/v1/tickets/track/?ticket_id=${encodeURIComponent(trackTicketId.trim())}&email=${encodeURIComponent(trackEmail.trim())}`));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || 'Could not load ticket status.');
      }
      setTrackedTicket(payload);
      setTrackStatus({ tone: 'success', text: 'Ticket status loaded.' });
    } catch (error) {
      setTrackStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load ticket status.' });
    } finally {
      setLoadingTrack(false);
    }
  }

  async function loadTimeline() {
    if (!trackTicketId.trim() || !trackEmail.trim()) {
      setTrackStatus({ tone: 'error', text: 'Enter both the ticket ID and requester email.' });
      return;
    }
    setLoadingTimeline(true);
    setTrackStatus({ tone: 'idle', text: 'Loading ticket timeline...' });
    setTimeline([]);
    try {
      const response = await fetch(endpoint(`/api/ticketing/v1/tickets/${encodeURIComponent(trackTicketId.trim())}/timeline/?email=${encodeURIComponent(trackEmail.trim())}`));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || 'Could not load ticket timeline.');
      }
      setTimeline(Array.isArray(payload?.timeline) ? payload.timeline : []);
      setTrackStatus({ tone: 'success', text: 'Ticket timeline loaded.' });
    } catch (error) {
      setTrackStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load ticket timeline.' });
    } finally {
      setLoadingTimeline(false);
    }
  }

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="support">
      <section className="mx-auto max-w-7xl px-6 pb-10 pt-12 sm:px-8 lg:px-10">
        <div
          className="rounded-[42px] border border-black/5 p-8 shadow-[0_20px_60px_rgba(232,93,38,0.1)] backdrop-blur md:p-10"
          style={{
            background: `linear-gradient(135deg, ${brand}12 0%, rgba(255,250,245,0.97) 30%, rgba(255,255,255,0.94) 100%)`,
          }}
        >
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div>
              <h1 className="max-w-4xl text-[3rem] font-semibold leading-[0.96] tracking-[-0.05em] text-[#111827] sm:text-[4.5rem]">
                {supportPage.headline ?? 'How can we help today?'}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[#4b5563]">
                {supportPage.subheadline ?? `Contact ${organizationName} for support, billing, account, or service questions.`}
              </p>
              <p className="mt-4 max-w-2xl text-base leading-8 text-[#4b5563]">
                {supportPage.description ?? 'Share the details below and our team will guide your request to the right people.'}
              </p>
              {supportEmail ? (
                <p className="mt-4 text-sm leading-7 text-[#4b5563]">
                  Prefer email? You can also reach us at <span className="font-semibold text-[#111827]">{supportEmail}</span>.
                </p>
              ) : null}
              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="#support-request"
                  className="inline-flex items-center rounded-full px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ backgroundColor: brand }}
                >
                  {supportPage.primary_cta_label ?? 'Send Request'}
                </a>
                <a
                  href="#ticket-tracking"
                  className="inline-flex items-center rounded-full border border-black/10 bg-white px-6 py-3.5 text-sm font-semibold text-[#111827] transition hover:border-black/20"
                >
                  {supportPage.secondary_cta_label ?? 'Check Request Status'}
                </a>
              </div>
            </div>

            <div className="rounded-[34px] p-6 text-white shadow-[0_16px_46px_rgba(232,93,38,0.14)]" style={{ background: 'linear-gradient(180deg, #2d211b 0%, #1b1614 100%)' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/45">Support from {organizationName}</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">Clear updates, every step of the way</h2>
              <p className="mt-3 text-sm leading-7 text-white/70">
                Once your request is submitted, you can check progress at any time using your ticket number and email address.
              </p>
              <div className="mt-5 grid gap-3">
                {(supportPage.highlights ?? [
                  'Reach the right team faster',
                  'Receive clear status updates',
                  'Stay within your branded support experience',
                ]).slice(0, 3).map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/78">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
        <div className="space-y-6" id="support-request">
          <div className="rounded-[34px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <div
              className="mb-6 rounded-[24px] px-5 py-4"
              style={{ background: `linear-gradient(135deg, ${brand}14 0%, rgba(255,249,244,0.96) 100%)` }}
            >
              <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">{supportPage.form_title ?? 'Send us a request'}</h2>
              <p className="mt-2 text-sm leading-7 text-[#4b5563]">
                {supportPage.form_description ?? 'Tell us what you need and we will route it to the best team to help you.'}
              </p>
            </div>

            <form className="mt-6 space-y-4" onSubmit={createTicket}>
              <div className="grid gap-4 md:grid-cols-2">
                {visibleSupportFields
                  .filter((field) => ['requester_name', 'requester_email'].includes(field.key ?? ''))
                  .map(renderSupportField)}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {visibleSupportFields
                  .filter((field) => ['requester_phone', 'category', 'priority'].includes(field.key ?? ''))
                  .map(renderSupportField)}
              </div>

              {visibleSupportFields
                .filter((field) => !['requester_name', 'requester_email', 'requester_phone', 'category', 'priority'].includes(field.key ?? ''))
                .map(renderSupportField)}

              <button
                type="submit"
                disabled={loadingCreate || Boolean(missingRequiredField)}
                className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: brand }}
              >
                <Send className="h-4 w-4" />
                {loadingCreate ? 'Sending...' : (supportPage.primary_cta_label ?? 'Send Request')}
              </button>

              {createStatus.text ? (
                <div className={`text-sm ${createStatus.tone === 'error' ? 'text-[#b42318]' : createStatus.tone === 'success' ? 'text-[#117a4a]' : 'text-[#4b5563]'}`}>
                  {createStatus.text}
                </div>
              ) : null}
            </form>
          </div>

          {createdTicket ? (
            <div className="rounded-[30px] border border-black/5 bg-white p-6 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5" style={{ color: brand }} />
                <div>
                  <h3 className="text-lg font-semibold text-[#111827]">{supportPage.success_title ?? 'Request received'}</h3>
                  <p className="mt-2 text-sm leading-7 text-[#4b5563]">
                    Your request number: <span className="font-semibold text-[#111827]">{createdTicket.ticket_id}</span>
                  </p>
                  <p className="text-sm leading-7 text-[#4b5563]">
                    {supportPage.success_description ?? 'Please keep this number for future follow-up.'}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-6" id="ticket-tracking">
          <div className="rounded-[34px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <div
              className="mb-6 rounded-[24px] px-5 py-4"
              style={{ background: `linear-gradient(135deg, ${brand}12 0%, rgba(255,249,244,0.96) 100%)` }}
            >
              <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">{supportPage.tracking_title ?? 'Check your request status'}</h2>
              <p className="mt-2 text-sm leading-7 text-[#4b5563]">
                {supportPage.tracking_description ?? 'Enter your request number and email address to see the latest progress.'}
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[#111827]">Request number</label>
                <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm" value={trackTicketId} onChange={(e) => setTrackTicketId(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[#111827]">Requester email</label>
                <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm" type="email" value={trackEmail} onChange={(e) => setTrackEmail(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={loadStatus}
                  disabled={loadingTrack}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                  style={{ backgroundColor: brand }}
                >
                  <Search className="h-4 w-4" />
                  {loadingTrack ? 'Checking...' : 'Check Status'}
                </button>
                <button
                  type="button"
                  onClick={loadTimeline}
                  disabled={loadingTimeline}
                  className="inline-flex items-center rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-[#111827] transition hover:border-black/20 disabled:opacity-60"
                >
                  {loadingTimeline ? 'Loading...' : 'Load Timeline'}
                </button>
              </div>

              {trackStatus.text ? (
                <div className={`text-sm ${trackStatus.tone === 'error' ? 'text-[#b42318]' : trackStatus.tone === 'success' ? 'text-[#117a4a]' : 'text-[#4b5563]'}`}>
                  {trackStatus.text}
                </div>
              ) : null}
            </div>
          </div>

          {trackedTicket ? (
            <div className="rounded-[30px] border border-black/5 bg-white p-6 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
              <h3 className="text-lg font-semibold text-[#111827]">{supportPage.status_title ?? 'Current update'}</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-[#fff4e8] px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: brand }}>
                  {trackedTicket.status ?? 'unknown'}
                </span>
                <span className="rounded-full border border-black/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[#4b5563]">
                  {trackedTicket.priority ?? 'normal'}
                </span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-[#4b5563]">
                <div><span className="font-semibold text-[#111827]">Subject:</span> {trackedTicket.subject}</div>
                <div><span className="font-semibold text-[#111827]">Category:</span> {trackedTicket.category}</div>
              </div>
            </div>
          ) : null}

          {timeline.length ? (
            <div className="rounded-[30px] border border-black/5 bg-white p-6 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
              <h3 className="text-lg font-semibold text-[#111827]">Timeline</h3>
              <div className="mt-4 space-y-4">
                {timeline.map((item, index) => (
                  <div key={`${item.created_at ?? 'event'}-${index}`} className="rounded-2xl border border-black/5 bg-[#fff8f1] p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: brand }}>
                      {item.kind ?? 'event'}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-[#111827]">
                      {item.kind === 'message'
                        ? item.author_name || item.author_type || 'Message'
                        : item.summary || 'Ticket update'}
                    </div>
                    <div className="mt-2 text-sm leading-7 text-[#4b5563]">
                      {item.kind === 'message'
                        ? item.message
                        : JSON.stringify(item.payload ?? {})}
                    </div>
                    <div className="mt-3 text-xs text-[#6b7280]">{formatDate(item.created_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

        </div>
      </section>
    </MarketingSiteShell>
  );
}
