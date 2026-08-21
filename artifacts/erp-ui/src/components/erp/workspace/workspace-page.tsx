import type { ReactNode } from 'react';
import { ERPPageHeader } from '@/components/erp/workspace/workspace-ui';

export function ERPWorkspacePage({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <ERPPageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}
