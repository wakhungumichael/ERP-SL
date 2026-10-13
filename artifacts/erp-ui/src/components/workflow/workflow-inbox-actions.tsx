import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export function WorkflowInboxActions({ itemId }: { itemId: number }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<string | null>(null);

  const act = async (value: 'approve' | 'reject') => {
    setDecision(value);
    try {
      const response = await fetch(`/api/platform/workflows/inbox/${itemId}/action/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: value }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail || body?.error || 'Workflow action failed.');
      toast({ title: body?.message || 'Workflow updated' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-widget-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-widget-workflow'] });
    } catch (error: any) {
      toast({ title: 'Workflow action failed', description: error?.message, variant: 'destructive' });
    } finally {
      setDecision(null);
    }
  };

  return <div className="flex gap-2">
    <Button size="sm" className="gap-1" onClick={() => act('approve')} disabled={!!decision}><Check className="h-3.5 w-3.5" />{decision === 'approve' ? 'Approving...' : 'Approve'}</Button>
    <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => act('reject')} disabled={!!decision}><X className="h-3.5 w-3.5" />Reject</Button>
  </div>;
}
