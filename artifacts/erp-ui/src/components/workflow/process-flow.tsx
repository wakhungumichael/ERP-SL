import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type ProcessStage = {
  label: string;
  active?: boolean;
  current?: boolean;
  muted?: boolean;
};

export type ProcessAction = {
  label: string;
  href: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning';
  helper?: string;
};

const stageClassNames = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  current: 'border-primary/30 bg-primary/10 text-primary',
  pending: 'border-border bg-muted/20 text-muted-foreground',
};

const actionToneClassNames = {
  default: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
};

export function ProcessFlow({
  title,
  description,
  stages,
  actions,
}: {
  title: string;
  description: string;
  stages: ProcessStage[];
  actions?: ProcessAction[];
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b bg-muted/20 py-3">
        <CardTitle className="text-sm font-bold uppercase tracking-widest">{title}</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {stages.map((stage, index) => {
            const tone = stage.current
              ? stageClassNames.current
              : stage.active
                ? stageClassNames.done
                : stageClassNames.pending;

            return (
              <div key={stage.label} className="flex items-center gap-2">
                <div
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors',
                    tone,
                    stage.muted ? 'opacity-70' : '',
                  )}
                >
                  {stage.label}
                </div>
                {index < stages.length - 1 ? (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                ) : null}
              </div>
            );
          })}
        </div>

        {actions?.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {actions.map((action) => (
              <Link
                key={`${action.href}-${action.label}`}
                href={action.href}
                className={cn(
                  'rounded-xl border p-4 transition-colors hover:bg-muted/30',
                  actionToneClassNames[action.tone ?? 'default'],
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-2 inline-flex rounded-full bg-white/70 p-2 shadow-sm">
                      {action.icon ?? <ArrowRight className="h-4 w-4" />}
                    </div>
                    <p className="font-semibold">{action.label}</p>
                    {action.helper ? (
                      <p className="mt-1 text-sm text-current/80">{action.helper}</p>
                    ) : null}
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-70" />
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
