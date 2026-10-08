import { CircleAlert } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { FormValidationErrors } from '@/lib/api-errors';
import { cn } from '@/lib/utils';

export function InlineFormError({ messages, className, ...props }: ComponentProps<'div'> & { messages?: string[] }) {
  if (!messages?.length) return null;

  return (
    <div role="alert" className={cn('space-y-1 text-xs font-medium text-destructive', className)} {...props}>
      {messages.map((message) => <p key={message}>{message}</p>)}
    </div>
  );
}

export function FormErrorSummary({ errors, title = 'Please review this form' }: { errors: FormValidationErrors; title?: string }) {
  if (errors.form.length === 0) return null;

  return (
    <div role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <div className="flex items-center gap-2 font-semibold"><CircleAlert className="h-4 w-4 shrink-0" />{title}</div>
      <div className="mt-1 space-y-1 pl-6">
        {errors.form.map((message) => <p key={message}>{message}</p>)}
      </div>
    </div>
  );
}
