import { useEffect, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuthLogin } from '@workspace/api-client-react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/use-auth';
import { DEFAULT_PUBLIC_SITE, fetchPublicSiteConfig } from '@/lib/public-site';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const BASE = '/api/platform';

function setupApi(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || payload?.detail || payload?.error || 'Request failed.');
    }
    return payload;
  });
}

function recommendPlanForIndustry(plans: any[], industryId?: number | null) {
  const activePlans = plans.filter((plan) => plan.is_active);
  if (!activePlans.length) return null;
  if (!industryId) return [...activePlans].sort((a, b) => Number(a.price) - Number(b.price))[0];

  const scored = activePlans.map((plan) => {
    const modules = Array.isArray(plan.modules) ? plan.modules : [];
    const recommendedCount = modules.filter((entry: any) => {
      const module = entry.module;
      const industries = Array.isArray(module?.industries) ? module.industries : [];
      return module?.is_core || industries.some((industry: any) => industry.id === industryId);
    }).length;
    return { plan, recommendedCount, price: Number(plan.price ?? 0), totalModules: modules.length };
  });

  scored.sort((a, b) => {
    if (b.recommendedCount !== a.recommendedCount) return b.recommendedCount - a.recommendedCount;
    if (a.price !== b.price) return a.price - b.price;
    return a.totalModules - b.totalModules;
  });

  return scored[0]?.plan ?? null;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/login/:tenantCode');
  const rememberedTenantCode = typeof window !== 'undefined'
    ? window.localStorage.getItem('sl-erp-tenant-code')
    : null;
  const tenantCode = params?.tenantCode ?? rememberedTenantCode ?? undefined;
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const requestedIntent = searchParams?.get('intent');
  const requestedPlanId = searchParams?.get('plan') ?? '';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerStep, setRegisterStep] = useState<1 | 2 | 3>(1);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [organizationSubmitting, setOrganizationSubmitting] = useState(false);
  const [createdWorkspace, setCreatedWorkspace] = useState(false);
  const [preferredPlanId, setPreferredPlanId] = useState(requestedPlanId);
  const [pendingAuth, setPendingAuth] = useState<{ token: string; user: Record<string, unknown> | null } | null>(null);
  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [organizationForm, setOrganizationForm] = useState({
    name: '',
    legal_name: '',
    contact_email: '',
    contact_phone: '',
    industry_id: '',
  });
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const login = useAuthLogin();
  const { toast } = useToast();
  const { setToken, token } = useAuth();
  const { data } = useQuery({
    queryKey: ['public-site-config', tenantCode ?? 'owner'],
    queryFn: () => fetchPublicSiteConfig(tenantCode),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const { data: industriesData } = useQuery({
    queryKey: ['onboarding-industries', pendingAuth?.token ?? 'none'],
    queryFn: () => setupApi(pendingAuth!.token, '/industries/?page_size=100'),
    enabled: registerOpen && !!pendingAuth?.token,
    staleTime: 5 * 60_000,
  });
  const { data: plansData } = useQuery({
    queryKey: ['onboarding-plans', pendingAuth?.token ?? 'none'],
    queryFn: () => setupApi(pendingAuth!.token, '/plans/?page_size=100'),
    enabled: registerOpen && !!pendingAuth?.token,
    staleTime: 5 * 60_000,
  });

  const site = data ?? DEFAULT_PUBLIC_SITE;
  const industries: any[] = industriesData?.results ?? industriesData?.data?.results ?? [];
  const plans: any[] = plansData?.results ?? plansData?.data?.results ?? [];
  const brand = site.branding.primary_color ?? '#E85D26';
  const privacyHref = tenantCode ? `/landing/${tenantCode}/privacy` : '/privacy';
  const trimmedName = registerForm.name.trim();
  const trimmedEmail = registerForm.email.trim();
  const accountNameParts = trimmedName.split(/\s+/).filter(Boolean);
  const passwordLongEnough = registerForm.password.length >= 8;
  const emailLooksValid = /\S+@\S+\.\S+/.test(trimmedEmail);
  const accountStepReady = Boolean(trimmedName && emailLooksValid && passwordLongEnough);
  const organizationStepReady = Boolean(organizationForm.name.trim());
  const accountPreviewName = accountNameParts[0] ?? 'Workspace';
  const organizationPreviewName = organizationForm.name.trim() || `${accountPreviewName} Organization`;
  const selectedIndustryId = organizationForm.industry_id ? Number(organizationForm.industry_id) : null;
  const recommendedPlan = recommendPlanForIndustry(plans, selectedIndustryId);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [startWithDemo, setStartWithDemo] = useState(true);
  const selectedPlan = plans.find((plan: any) => String(plan.id) === selectedPlanId) ?? recommendedPlan ?? null;
  const logoUrl = site.branding.logo_url?.trim();
  const landingPageEnabled = site.landing_page.enabled !== false;
  const showLandingPageLink = landingPageEnabled && site.login_page.show_landing_page_link !== false;
  const showPublicRegistration = site.login_page.show_public_registration !== false;
  const showPricingCard = showLandingPageLink && site.login_page.show_pricing_card !== false;
  useEffect(() => {
    if (token) setLocation('/dashboard');
  }, [token, setLocation]);

  useEffect(() => {
    const nextPlanId = recommendedPlan?.id ? String(recommendedPlan.id) : '';
    setSelectedPlanId((current) => current || preferredPlanId || nextPlanId);
    setStartWithDemo(Boolean((recommendedPlan?.trial_days ?? 0) > 0));
  }, [preferredPlanId, recommendedPlan?.id, recommendedPlan?.trial_days]);

  useEffect(() => {
    if (requestedIntent === 'register') {
      setRegisterOpen(true);
    }
    if (requestedPlanId) {
      setPreferredPlanId(requestedPlanId);
      setSelectedPlanId(requestedPlanId);
    }
  }, [requestedIntent, requestedPlanId]);

  const resetRegisterFlow = () => {
    setRegisterOpen(false);
    setRegisterStep(1);
    setRegisterSubmitting(false);
    setOrganizationSubmitting(false);
    setCreatedWorkspace(false);
    setPendingAuth(null);
    setRegisterForm({ name: '', email: '', password: '' });
    setOrganizationForm({ name: '', legal_name: '', contact_email: '', contact_phone: '', industry_id: '' });
    setSelectedPlanId('');
    setStartWithDemo(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { data: { username, password } },
      {
        onSuccess: (raw) => {
          const payload = (raw as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
          const authToken = (payload?.token ?? (raw as Record<string, unknown>)?.token) as string | undefined;
          const user = (payload?.user ?? (raw as Record<string, unknown>)?.user) as Record<string, unknown> | undefined;
          if (authToken) {
            setToken(authToken, user ?? null);
            setLocation('/dashboard');
          }
        },
        onError: () => {
          toast({
            title: 'Authentication failed',
            description: 'Invalid credentials. Check your username and password.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleAccountRegistration = async () => {
    if (!trimmedName || !trimmedEmail || !registerForm.password) {
      toast({
        title: 'Missing account details',
        description: 'Name, email, and password are required.',
        variant: 'destructive',
      });
      return;
    }
    if (!emailLooksValid) {
      toast({
        title: 'Check the email address',
        description: 'Use a valid business email address to continue.',
        variant: 'destructive',
      });
      return;
    }
    if (!passwordLongEnough) {
      toast({
        title: 'Password too short',
        description: 'Use at least 8 characters for your password.',
        variant: 'destructive',
      });
      return;
    }

    setRegisterSubmitting(true);
    try {
      const response = await fetch('/api/platform/auth/register/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password: registerForm.password,
          tenant_code: tenantCode,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.detail || payload?.error || 'Registration failed.');
      }

      const data = payload?.data ?? payload;
      setPendingAuth({
        token: data.token,
        user: (data.user as Record<string, unknown> | undefined) ?? null,
      });
      setOrganizationForm({
        name: organizationPreviewName,
        legal_name: organizationPreviewName,
        contact_email: trimmedEmail,
        contact_phone: '',
        industry_id: '',
      });
      setRegisterStep(2);
    } catch (error: any) {
      toast({
        title: 'Account creation failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const handleOrganizationCreation = async () => {
    if (!pendingAuth?.token) return;
    if (!organizationForm.name.trim()) {
      toast({
        title: 'Organization name required',
        description: 'Add at least one organization now, or skip this step.',
        variant: 'destructive',
      });
      return;
    }

    setOrganizationSubmitting(true);
    try {
      await setupApi(pendingAuth.token, '/tenants/', 'POST', {
        name: organizationForm.name.trim(),
        legal_name: organizationForm.legal_name.trim(),
        contact_email: organizationForm.contact_email.trim(),
        contact_phone: organizationForm.contact_phone.trim(),
        industry_id: organizationForm.industry_id ? Number(organizationForm.industry_id) : undefined,
        plan_id: selectedPlanId ? Number(selectedPlanId) : undefined,
        demo_days: startWithDemo ? Number(selectedPlan?.trial_days ?? 0) : 0,
        start_with_demo: startWithDemo,
        status: 'active',
        is_active: true,
      });
      setCreatedWorkspace(true);
      setRegisterStep(3);
    } catch (error: any) {
      toast({
        title: 'Organization setup failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setOrganizationSubmitting(false);
    }
  };

  const finishRegistration = () => {
    if (!pendingAuth?.token) return;
    setToken(pendingAuth.token, pendingAuth.user);
    setRegisterOpen(false);
    setLocation(createdWorkspace ? '/platform/organization-settings' : '/dashboard');
  };

  const handleForgotPassword = async () => {
    if (!forgotIdentifier.trim()) {
      toast({
        title: 'Missing account details',
        description: 'Enter your email address or username first.',
        variant: 'destructive',
      });
      return;
    }

    setForgotSubmitting(true);
    try {
      const response = await fetch('/api/platform/auth/forgot-password/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: forgotIdentifier.trim(),
          tenant_code: tenantCode ?? undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.detail || payload?.error || 'Password reset failed.');
      }
      toast({
        title: 'Password reset sent',
        description: payload?.message || 'If the account exists, a reset email has been sent.',
      });
      setForgotPasswordOpen(false);
      setForgotIdentifier('');
    } catch (error: any) {
      toast({
        title: 'Password reset failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setForgotSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(232,93,38,0.26),_transparent_30%),linear-gradient(180deg,#1c1917_0%,#292524_100%)] text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[1.08fr_0.92fr]">
        <div className="flex flex-col justify-between px-8 py-10 sm:px-12 lg:px-14">
          <div className="flex items-center">
            <div className="flex items-center">
              <div className="flex h-36 w-96 max-w-full items-center justify-start overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt={`${site.tenant?.name ?? 'Organization'} logo`} className="h-full w-full object-contain object-left" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-black tracking-[0.2em] text-white" style={{ backgroundColor: brand }}>
                    SL
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-8 py-10 lg:max-w-2xl">
            <div className="space-y-5">
              <h1 className="max-w-2xl font-serif text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
                {site.login_page.title}
              </h1>
              <p className="max-w-2xl text-xl font-medium leading-8 text-white/74">
                {site.login_page.subtitle}
              </p>
              {site.login_page.description ? (
                <p className="max-w-xl text-base leading-7 text-white/60">
                  {site.login_page.description}
                </p>
              ) : null}
            </div>

            {showLandingPageLink ? <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setLocation(tenantCode ? `/landing/${tenantCode}` : '/landing')}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white shadow-[0_18px_40px_rgba(232,93,38,0.24)] transition hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                View Landing Page
                <ArrowRight className="h-4 w-4" />
              </button>
            </div> : null}
          </div>

          <footer className="space-y-3 border-t border-white/10 pt-5">
            <div className="flex flex-wrap gap-4 text-sm text-white/70">
              {site.footer_menu.map((item) => (
                <a key={`${item.label}-${item.href}`} href={item.href} className="transition hover:text-white">
                  {item.label}
                </a>
              ))}
            </div>
          </footer>
        </div>

        <div className="flex items-center justify-center px-8 py-10 sm:px-12 lg:px-14">
          <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-white p-8 text-slate-950 shadow-[0_35px_120px_rgba(0,0,0,0.35)]">
            <div className="space-y-5">
              <div className="flex h-24 w-full items-center justify-start overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt={`${site.tenant?.name ?? 'Organization'} logo`} className="h-full w-full object-contain object-left" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl text-lg font-black tracking-[0.2em] text-white" style={{ backgroundColor: brand }}>
                    SL
                  </div>
                )}
              </div>
              <h2 className="text-2xl font-black leading-none tracking-tight">Sign in</h2>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Username</label>
                <Input
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder=""
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Password</label>
                <Input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=""
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-mono"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setForgotIdentifier(username);
                    setForgotPasswordOpen(true);
                  }}
                  className="text-sm font-semibold transition hover:opacity-80"
                  style={{ color: brand }}
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                disabled={login.isPending}
                className="h-12 w-full rounded-full text-sm font-bold uppercase tracking-[0.22em] text-white"
                style={{ backgroundColor: brand }}
              >
                {login.isPending ? 'Authenticating…' : 'Sign In'}
              </Button>
            </form>

            {showPublicRegistration ? <div className="mt-5 flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-500">No account yet?</span>
              <button
                type="button"
                onClick={() => setRegisterOpen(true)}
                className="font-semibold transition hover:opacity-80"
                style={{ color: brand }}
              >
                Create your workspace
              </button>
            </div> : null}

            {requestedIntent === 'subscribe' ? (
              <div className="mt-4 rounded-2xl border border-[#f1d7c8] bg-[#fff8f3] p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Continue with your subscription</p>
                <p className="mt-1 leading-6">
                  Sign in, then open Organization Settings to continue with plan selection and subscription setup.
                </p>
              </div>
            ) : null}

            {showPricingCard ? <div className="mt-6 rounded-3xl bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-900">Need product pricing first?</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Review the public subscription plans and billing packages before you enter the workspace.
              </p>
              <button
                type="button"
                onClick={() => setLocation(tenantCode ? `/landing/${tenantCode}` : '/landing')}
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold"
                style={{ color: brand }}
              >
                Open Landing Page
                <ArrowRight className="h-4 w-4" />
              </button>
            </div> : null}
          </div>
        </div>
      </div>

      <Dialog open={registerOpen} onOpenChange={(open) => { if (!open) resetRegisterFlow(); else setRegisterOpen(true); }}>
        <DialogContent className="h-[100dvh] max-h-[100dvh] max-w-5xl overflow-hidden rounded-none border-0 p-0 md:h-auto md:max-h-[90vh] md:rounded-[32px]">
          <div className="grid h-full gap-0 overflow-hidden md:grid-cols-[0.82fr_1.18fr]">
            <div className="bg-slate-950 px-5 py-4 text-white sm:px-8 md:px-10 md:py-10">
              <p className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: brand }}>Workspace Setup</p>
              <h3 className="mt-3 max-w-sm text-2xl font-bold leading-tight tracking-tight md:mt-5 md:text-4xl">Create your account, then launch your first organization.</h3>
              <p className="mt-3 hidden max-w-sm text-base leading-8 text-white/70 md:mt-5 md:block">
                Built for multi-industry operators who want a calm, structured start.
              </p>

              <div className="mt-4 flex items-center gap-3 text-sm text-white/72 md:mt-10">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white md:h-10 md:w-10"
                  style={{ backgroundColor: registerStep >= 1 ? brand : 'rgba(255,255,255,0.12)' }}
                >
                  {registerStep > 1 ? <CheckCircle2 className="h-4 w-4" /> : '1'}
                </div>
                <div className="h-px flex-1 bg-white/10" />
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white md:h-10 md:w-10"
                  style={{ backgroundColor: registerStep >= 2 ? brand : 'rgba(255,255,255,0.12)' }}
                >
                  {registerStep > 2 ? <CheckCircle2 className="h-4 w-4" /> : '2'}
                </div>
                <div className="h-px flex-1 bg-white/10" />
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white md:h-10 md:w-10"
                  style={{ backgroundColor: registerStep >= 3 ? brand : 'rgba(255,255,255,0.12)' }}
                >
                  3
                </div>
              </div>

              <div className="mt-4 space-y-1 text-xs text-white/58 md:mt-8 md:space-y-2 md:text-sm">
                <p>{registerStep === 1 ? 'Account details' : registerStep === 2 ? 'Organization details' : 'Plan and launch'}</p>
                <p className="hidden md:block">{registerStep === 2 ? 'Choose an industry to align modules, plans, and subscriptions.' : 'Review the suggested setup, then continue into the workspace.'}</p>
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-white px-5 py-5 text-slate-950 sm:px-8 md:px-10 md:py-10">
              <DialogHeader className="shrink-0 pr-8 text-left">
                <DialogTitle className="text-xl font-black tracking-tight md:text-2xl">
                  {registerStep === 1 ? 'Create your account' : registerStep === 2 ? 'Add your first organization' : createdWorkspace ? 'Setup complete' : 'Review subscription setup'}
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-slate-600">
                  {registerStep === 1
                    ? 'Set up the administrator account that will own the initial workspace.'
                    : registerStep === 2
                      ? 'Create the first organization now. Additional organizations can be added later.'
                      : createdWorkspace
                        ? 'Your account and first organization are ready.'
                        : 'Choose a subscription plan now or continue and manage it later from Organization Settings.'}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 md:mt-6">
              {registerStep === 1 ? (
                <div className="space-y-4 pb-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Name</label>
                    <Input
                      required
                      value={registerForm.name}
                      onChange={(e) => setRegisterForm((current) => ({ ...current, name: e.target.value }))}
                      placeholder="John Doe"
                      className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    />
                    <p className="text-xs text-slate-500">This will be used for the initial administrator profile.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Email</label>
                    <Input
                      required
                      type="email"
                      value={registerForm.email}
                      onChange={(e) => setRegisterForm((current) => ({ ...current, email: e.target.value }))}
                      placeholder="name@company.com"
                      className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    />
                    {!trimmedEmail || emailLooksValid ? null : (
                      <p className="text-xs text-amber-700">Enter a valid email address to continue.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Password</label>
                    <Input
                      required
                      type="password"
                      minLength={8}
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm((current) => ({ ...current, password: e.target.value }))}
                      placeholder="••••••••"
                      className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    />
                    <p className={`text-xs ${passwordLongEnough ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {passwordLongEnough ? 'Password strength requirement met.' : 'Use at least 8 characters.'}
                    </p>
                  </div>
                  <p className="text-xs leading-6 text-slate-500">
                    Your personal data will be handled as outlined in our{' '}
                    <a href={privacyHref} className="font-semibold underline underline-offset-4" style={{ color: brand }}>
                      Privacy Policy
                    </a>
                    .
                  </p>
                </div>
              ) : null}

              {registerStep === 2 ? (
                <div className="space-y-4 pb-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Organization Name</label>
                    <Input
                      required
                      value={organizationForm.name}
                      onChange={(e) => setOrganizationForm((current) => ({ ...current, name: e.target.value }))}
                      placeholder="Acme Logistics"
                      className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    />
                    <p className="text-xs text-slate-500">This becomes your first operating organization inside the platform.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Legal Name</label>
                    <Input
                      value={organizationForm.legal_name}
                      onChange={(e) => setOrganizationForm((current) => ({ ...current, legal_name: e.target.value }))}
                      placeholder="John Doe Holdings Limited"
                      className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Contact Email</label>
                      <Input
                        type="email"
                        value={organizationForm.contact_email}
                        onChange={(e) => setOrganizationForm((current) => ({ ...current, contact_email: e.target.value }))}
                        placeholder="admin@company.com"
                        className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Phone</label>
                      <Input
                        value={organizationForm.contact_phone}
                        onChange={(e) => setOrganizationForm((current) => ({ ...current, contact_phone: e.target.value }))}
                        placeholder="+254..."
                        className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Industry</label>
                    <Select
                      value={organizationForm.industry_id}
                      onValueChange={(value) => setOrganizationForm((current) => ({ ...current, industry_id: value }))}
                    >
                      <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-slate-50">
                        <SelectValue placeholder="Select an industry" />
                      </SelectTrigger>
                      <SelectContent>
                        {industries.map((industry: any) => (
                          <SelectItem key={industry.id} value={String(industry.id)}>
                            {industry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      Industries are maintained by the SaaS administrator and help control default module fit, plan packaging, and subscription alignment.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">{organizationPreviewName}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {industries.find((industry: any) => String(industry.id) === organizationForm.industry_id)?.name ?? 'Choose an industry to continue with better alignment.'}
                    </p>
                  </div>
                </div>
              ) : null}

              {registerStep === 3 ? (
                createdWorkspace ? (
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-center gap-3 text-emerald-800">
                      <CheckCircle2 className="h-5 w-5" />
                      <p className="text-base font-semibold">Your account is ready.</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-emerald-900/80">
                      We created your first organization and made you its System Administrator.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5 pb-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Suggested Plan</label>
                      <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                        <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Select a plan" />
                        </SelectTrigger>
                        <SelectContent>
                          {plans.map((plan: any) => (
                            <SelectItem key={plan.id} value={String(plan.id)}>
                              {plan.name} - {plan.currency} {Number(plan.price).toLocaleString()}/{plan.billing_period}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {recommendedPlan && (
                        <p className="text-xs text-slate-500">
                          Current plan: <span className="font-semibold text-slate-900">{recommendedPlan.name}</span>
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Start with demo workspace</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            Begin on the trial period first, then upgrade, downgrade, or continue billing later.
                          </p>
                        </div>
                        <Switch checked={startWithDemo} onCheckedChange={setStartWithDemo} />
                      </div>
                    </div>

                  </div>
                )
              ) : null}
              </div>

              <DialogFooter className="mt-4 shrink-0 gap-2 border-t border-slate-100 pt-3 sm:justify-between md:mt-6 md:pt-4">
                <div className="text-xs text-slate-500">
                  {registerStep === 2 ? 'You can skip this step and continue later.' : registerStep === 3 && !createdWorkspace ? 'You can still adjust subscription and billing later inside Organization Settings.' : ' '}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {registerStep === 1 ? (
                    <Button variant="outline" onClick={resetRegisterFlow}>Cancel</Button>
                  ) : null}
                  {registerStep === 2 ? (
                    <>
                      <Button variant="outline" onClick={() => setRegisterStep(1)} disabled={organizationSubmitting}>Back</Button>
                      <Button variant="outline" onClick={finishRegistration} disabled={organizationSubmitting}>Skip for now</Button>
                    </>
                  ) : null}
                  {registerStep === 1 ? (
                    <Button onClick={handleAccountRegistration} disabled={registerSubmitting || !accountStepReady} style={{ backgroundColor: brand }}>
                      {registerSubmitting ? 'Creating account…' : 'Continue'}
                    </Button>
                  ) : null}
                  {registerStep === 2 ? (
                    <Button onClick={() => setRegisterStep(3)} disabled={!organizationStepReady} style={{ backgroundColor: brand }}>
                      Continue
                    </Button>
                  ) : null}
                  {registerStep === 3 ? (
                    createdWorkspace ? (
                      <Button onClick={finishRegistration} style={{ backgroundColor: brand }}>
                        Open workspace
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" onClick={() => setRegisterStep(2)} disabled={organizationSubmitting}>Back</Button>
                        <Button onClick={handleOrganizationCreation} disabled={organizationSubmitting} style={{ backgroundColor: brand }}>
                          {organizationSubmitting ? 'Creating workspace…' : 'Create workspace'}
                        </Button>
                      </>
                    )
                  ) : null}
                </div>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Enter your username or email address. We will send a temporary password using this organization&apos;s email settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Username or Email</label>
            <Input
              required
              value={forgotIdentifier}
              onChange={(event) => setForgotIdentifier(event.target.value)}
              placeholder="name@company.com or username"
              className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-mono"
            />
            {tenantCode && (
              <p className="text-xs text-muted-foreground">
                Reset will use the email settings for organization code <span className="font-mono">{tenantCode}</span>.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForgotPasswordOpen(false)}>Cancel</Button>
            <Button
              onClick={handleForgotPassword}
              disabled={forgotSubmitting || !forgotIdentifier.trim()}
              style={{ backgroundColor: brand }}
            >
              {forgotSubmitting ? 'Sending…' : 'Send Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
