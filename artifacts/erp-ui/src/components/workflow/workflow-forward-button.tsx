import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';

type WorkflowForwardButtonProps = {
  moduleSlug: string;
  entityType: string;
  entityId: number;
  reference?: string;
  title?: string;
  detail?: string;
  triggerEvent?: string;
  disabled?: boolean;
  onForwarded?: () => void;
};

/** A module-neutral action backed by the workflow binding configured by an administrator. */
export function WorkflowForwardButton({
  moduleSlug, entityType, entityId, reference, title, detail, triggerEvent = 'submit', disabled = false, onForwarded,
}: WorkflowForwardButtonProps) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [isForwarding, setIsForwarding] = useState(false);

  const forward = async () => {
    setIsForwarding(true);
    try {
      const response = await fetch('/api/platform/workflows/forward/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_slug: moduleSlug, entity_type: entityType, entity_id: entityId,
          reference, title, detail, trigger_event: triggerEvent,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail || body?.error || 'The record could not be forwarded.');
      toast({ title: body?.message || 'Forwarded for approval', description: 'The configured approver can now act from their workflow inbox.' });
      onForwarded?.();
    } catch (error: any) {
      toast({ title: 'Could not forward for approval', description: error?.message, variant: 'destructive' });
    } finally {
      setIsForwarding(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={forward} disabled={disabled || isForwarding || !token}>
      <Send className="h-3.5 w-3.5" />
      {isForwarding ? 'Forwarding...' : 'Forward for approval'}
    </Button>
  );
}
