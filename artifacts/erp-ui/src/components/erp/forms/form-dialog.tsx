import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ERPFormDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  maxWidthClassName = 'max-w-2xl',
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={maxWidthClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {children}
        </div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
