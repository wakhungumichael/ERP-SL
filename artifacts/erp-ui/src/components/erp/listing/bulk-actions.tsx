import type { ReactNode } from 'react';

export function ERPBulkActions({
  visible,
  summary,
  actionSlot,
  primaryAction,
  secondaryAction,
}: {
  visible: boolean;
  summary: ReactNode;
  actionSlot?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  if (!visible) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="text-sm font-medium">{summary}</div>
      {actionSlot}
      {primaryAction}
      {secondaryAction}
    </div>
  );
}
