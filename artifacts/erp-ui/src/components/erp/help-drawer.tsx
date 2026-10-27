import { useState } from 'react';
import { Link } from 'wouter';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type HelpLink = { label: string; href: string; description: string };
type HelpTopic = { title: string; description: string; stages?: string[]; links?: HelpLink[] };

function topicFor(location: string): HelpTopic {
  if (location.startsWith('/payments/invoices')) {
    return {
      title: 'Invoice help',
      description: 'Move billing from its source document through issue, collection, statements, and accounting control.',
      stages: ['Source document', 'Draft', 'Issued', 'Collection', 'Statement / aging', 'Accounting'],
      links: [
        { label: 'Sales orders', href: '/sales/orders', description: 'Trace invoices back to customer orders and completed work.' },
        { label: 'Customer statements', href: '/sales/statements', description: 'Review balances, collections, and overdue amounts.' },
        { label: 'Posting rules', href: '/accounting/posting-rules', description: 'Keep issued invoices aligned with financial controls.' },
      ],
    };
  }
  if (location.startsWith('/sales/orders')) {
    return {
      title: 'Sales order help',
      description: 'A sales order records the customer commitment and operational work. It is not an invoice and does not post accounting entries.',
      stages: ['Quote accepted', 'Sales order', 'Fulfilment', 'Invoice', 'Collection'],
      links: [
        { label: 'Estimates', href: '/sales/estimates', description: 'Start from an accepted quote when one exists.' },
        { label: 'Invoices', href: '/payments/invoices', description: 'Create the receivable when billing is ready.' },
      ],
    };
  }
  return {
    title: 'Workspace help',
    description: 'Use this panel for guidance about the screen you are working on. Additional module-specific guides will appear here.',
  };
}

export function ERPHelpDrawer({ location }: { location: string }) {
  const [open, setOpen] = useState(false);
  const topic = topicFor(location);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} className="text-muted-foreground hover:text-foreground" aria-label="Open help" title="Help for this screen">
        <HelpCircle className="h-5 w-5" />
      </Button>
      <SheetContent side="left" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle>{topic.title}</SheetTitle>
          <SheetDescription>{topic.description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {topic.stages?.length ? (
            <section>
              <h3 className="text-sm font-semibold">Process</h3>
              <ol className="mt-3 space-y-2">
                {topic.stages.map((stage, index) => (
                  <li key={stage} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span>
                    {stage}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {topic.links?.length ? (
            <section>
              <h3 className="text-sm font-semibold">Related screens</h3>
              <div className="mt-3 space-y-2">
                {topic.links.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="block rounded-lg border p-3 transition-colors hover:bg-accent">
                    <span className="text-sm font-semibold text-primary">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
