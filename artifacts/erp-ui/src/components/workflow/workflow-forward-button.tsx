/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  context?: Record<string, unknown>;
  disabled?: boolean;
  onForwarded?: () => void;
};

/** A module-neutral action backed by the workflow binding configured by an administrator. */
export function WorkflowForwardButton({
  moduleSlug, entityType, entityId, reference, title, detail, triggerEvent = 'submit', context, disabled = false, onForwarded,
}: WorkflowForwardButtonProps) {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isForwarding, setIsForwarding] = useState(false);
  const [hasForwarded, setHasForwarded] = useState(false);
  const requirement = useQuery({
    queryKey: ['workflow-requirement', moduleSlug, entityType, entityId, triggerEvent, token],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams({ module_slug: moduleSlug, entity_type: entityType, entity_id: String(entityId), trigger_event: triggerEvent });
      const response = await fetch(`/api/platform/workflows/requirement/?${params}`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) return { required: false };
      const body = await response.json();
      return body?.data ?? body;
    },
  });

  const forward = async () => {
    setIsForwarding(true);
    try {
      const response = await fetch('/api/platform/workflows/forward/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_slug: moduleSlug, entity_type: entityType, entity_id: entityId,
          reference, title, detail, trigger_event: triggerEvent, metadata: context ? { context } : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail || body?.error || 'The record could not be forwarded.');
      setHasForwarded(true);
      await queryClient.invalidateQueries({
        queryKey: ['workflow-requirement', moduleSlug, entityType, entityId, triggerEvent, token],
      });
      toast({ title: body?.message || 'Forwarded for approval', description: 'The configured approver can now act from their workflow inbox.' });
      onForwarded?.();
    } catch (error: any) {
      toast({ title: 'Could not forward for approval', description: error?.message, variant: 'destructive' });
    } finally {
      setIsForwarding(false);
    }
  };

  if (requirement.isSuccess && (!requirement.data?.required || requirement.data?.can_forward === false)) return null;

  const inProgress = hasForwarded || requirement.data?.in_progress;
  const stage = requirement.data?.current_stage;
  const role = requirement.data?.current_role;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" className="gap-2" onClick={forward} disabled={disabled || inProgress || isForwarding || !token}>
        <Send className="h-3.5 w-3.5" />
        {isForwarding ? 'Forwarding...' : inProgress ? 'Awaiting approval' : 'Forward for approval'}
      </Button>
      {inProgress && (stage || role) ? (
        <span className="text-xs text-muted-foreground">
          In progress: {stage || 'Workflow review'}{role ? ` · ${role}` : ''}
        </span>
      ) : null}
    </div>
  );
}
