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
  compact = false,
}: {
  title: string;
  description: string;
  stages: ProcessStage[];
  actions?: ProcessAction[];
  compact?: boolean;
}) {
  return (
    <Card className="shadow-sm">
      {!compact && <CardHeader className="border-b bg-muted/20 py-3">
        <CardTitle className="text-sm font-bold uppercase tracking-widest">{title}</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">{description}</p>
      </CardHeader>}
      <CardContent className="p-0">
        <div className={cn('grid', actions?.length ? 'xl:grid-cols-[minmax(0,1.25fr)_minmax(420px,1fr)]' : '')}>
        <div className={cn('flex flex-wrap items-center', compact ? 'gap-2 p-3' : 'gap-3 p-5')}>
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
                    'rounded-full border text-xs font-bold uppercase tracking-wide transition-colors',
                    compact ? 'px-2.5 py-1' : 'px-3 py-1.5',
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
          <div className="grid border-t xl:grid-cols-3 xl:border-l xl:border-t-0">
            {actions.map((action) => (
              <Link
                key={`${action.href}-${action.label}`}
                href={action.href}
                className={cn(
                  'border-b transition-colors hover:bg-muted/30 last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0',
                  compact ? 'p-3' : 'p-4',
                  actionToneClassNames[action.tone ?? 'default'],
                )}
              >
                <div className="flex items-start gap-3">
                  <div>
                    <div className={cn('inline-flex rounded-md bg-white/70 shadow-sm', compact ? 'mb-1 p-1.5' : 'mb-2 p-2')}>
                      {action.icon ?? <ArrowRight className="h-4 w-4" />}
                    </div>
                    <p className="font-semibold">{action.label}</p>
                    {action.helper ? (
                      <p className={cn('text-current/80', compact ? 'mt-0.5 text-xs leading-4' : 'mt-1 text-sm')}>{action.helper}</p>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
