import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuthLogin } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Scale } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/use-auth';
import { ROLE_LABELS } from '@/lib/roles';

const ROLE_DESCRIPTIONS = [
  { role: 'Operator', desc: 'Weighbridge transactions & live weight' },
  { role: 'Finance', desc: 'Invoices, payments & financial reports' },
  { role: 'Tenant Admin', desc: 'Users, roles & workspace configuration' },
  { role: 'Super Admin', desc: 'Full platform access & tenant management' },
];

export default function Login() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthLogin();
  const { toast } = useToast();
  const { setToken, token } = useAuth();

  // Redirect if already logged in
  useEffect(() => {
    if (token) setLocation('/dashboard');
  }, [token, setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { data: { username, password } },
      {
        onSuccess: (raw) => {
          // Platform API wraps responses: {success, data: {token, user}}
          const payload = (raw as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
          const token = (payload?.token ?? (raw as Record<string, unknown>)?.token) as string | undefined;
          if (token) {
            setToken(token);
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
      }
    );
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Left panel — branding + role info */}
      <div className="hidden lg:flex lg:w-[480px] bg-sidebar text-sidebar-foreground flex-col justify-between p-12 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <Scale className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight">SL-ERP</div>
            <div className="text-[10px] font-medium text-sidebar-foreground/50 uppercase tracking-widest">Operations Platform</div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">Built for precision.</h2>
            <p className="text-sidebar-foreground/60 text-sm leading-relaxed">
              Commercial weighbridge management for operations teams that cannot afford errors. 
              Real-time weight capture, multi-tenant billing, and full audit trails.
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-sidebar-foreground/40">
              Role-based access
            </div>
            {ROLE_DESCRIPTIONS.map(r => (
              <div key={r.role} className="flex items-start gap-3">
                <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                <div>
                  <div className="text-sm font-semibold">{r.role}</div>
                  <div className="text-xs text-sidebar-foreground/50">{r.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-sidebar-foreground/30">
          © 2025 Siakora Labs Limited · SL-ERP Platform
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Scale className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <div className="font-bold text-xl tracking-tight">SL-ERP</div>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your credentials to access the platform</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Username</label>
              <Input
                required
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. operator01"
                className="h-11 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Password</label>
              <Input
                required
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 font-mono"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 font-bold tracking-wide uppercase"
              disabled={login.isPending}
            >
              {login.isPending ? 'Authenticating…' : 'Sign In'}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center">
            Access is role-restricted. Contact your administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}
