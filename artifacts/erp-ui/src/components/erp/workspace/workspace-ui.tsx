import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ERPPageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function ERPMetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="min-w-0 border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className="mt-2 truncate text-2xl font-bold tracking-tight text-foreground">{value}</p>
            {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
          </div>
          {icon ? <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ERPPanel({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`overflow-hidden border-border/70 shadow-sm ${className ?? ''}`}>
      <CardHeader className="flex-row items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      {children}
    </Card>
  );
}
