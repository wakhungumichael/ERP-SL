/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorFromResponse } from '@/lib/api-errors';

function useProjectApi<T>(path: string, token: string | null) {
  return useQuery<T>({ queryKey: ['project-detail', path], enabled: !!token, queryFn: async () => { const r = await fetch(path, { headers: { Authorization: `Token ${token}` } }); if (!r.ok) throw await apiErrorFromResponse(r, 'Task details could not be loaded.'); return r.json() as Promise<T>; } });
}

export default function TaskDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const task = useProjectApi<any>(`/api/projects/tasks/${id}/`, token);
  const updates = useProjectApi<any[]>(`/api/projects/tasks/${id}/updates/`, token);
  const followUps = useProjectApi<any[]>(`/api/projects/tasks/${id}/follow-ups/`, token);
  const [progress, setProgress] = useState(''); const [note, setNote] = useState(''); const client = useQueryClient();
  const addUpdate = useMutation({ mutationFn: async () => { const r = await fetch(`/api/projects/tasks/${id}/updates/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` }, body: JSON.stringify({ progress_percentage: Number(progress), update_description: note }) }); if (!r.ok) throw await apiErrorFromResponse(r, 'Progress update could not be saved.'); return r.json(); }, onSuccess: () => { setProgress(''); setNote(''); void client.invalidateQueries({ queryKey: ['project-detail', `/api/projects/tasks/${id}/`] }); void client.invalidateQueries({ queryKey: ['project-detail', `/api/projects/tasks/${id}/updates/`] }); } });
  const record = task.data;
  return <ERPWorkspacePage title={record ? `${record.number} - ${record.title}` : 'Task'} description="Assignment, progress updates, and follow-up history for this task.">
    {!record ? <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">Loading task details...</div> : <div className="grid gap-5 lg:grid-cols-3"><section className="rounded-lg border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Task Assignment</h2><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{record.description || 'No task description provided.'}</p></section><aside className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Current state</h2><Badge className="mt-3" variant="outline">{String(record.status).replaceAll('_', ' ')}</Badge><div className="mt-5 text-3xl font-bold">{record.progress_percentage}%</div></aside><section className="rounded-lg border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Progress Updates</h2><div className="mt-3 flex gap-2"><Input type="number" min="0" max="100" value={progress} onChange={e=>setProgress(e.target.value)} placeholder="Progress %"/><Textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Meaningful update note"/><Button disabled={!progress || !note || addUpdate.isPending} onClick={()=>addUpdate.mutate()}>Add update</Button></div><div className="mt-4 space-y-3">{(updates.data ?? []).map((update) => <div className="rounded border p-3 text-sm" key={update.id}><div className="font-medium">{update.progress_percentage}% progress</div><p className="mt-1 text-muted-foreground">{update.update_description}</p></div>)}</div></section></div>}
  </ERPWorkspacePage>;
}
