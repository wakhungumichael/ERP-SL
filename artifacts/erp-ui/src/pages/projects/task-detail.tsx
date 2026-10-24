/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiErrorFromResponse } from '@/lib/api-errors';

type Task = { number: string; title: string; description: string; status: string; progress_percentage: number; project_name: string; branch_name: string; assignee_name: string; due_date: string | null; workflow_stage: string };
type Update = { id: number; progress_percentage: number; update_description: string; created_at: string };
type FollowUp = { id: number; follow_up_date: string; notes: string; status: string; owner_name: string };
type Comment = { id: number; body: string; author_name: string; created_at: string };

function useProjectApi<T>(path: string, token: string | null) {
  return useQuery<T>({ queryKey: ['project-detail', path], enabled: !!token, queryFn: async () => { const response = await fetch(path, { headers: { Authorization: `Token ${token}` } }); if (!response.ok) throw await apiErrorFromResponse(response, 'Task details could not be loaded.'); return response.json() as Promise<T>; } });
}

function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Not set'; }

export default function TaskDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const taskPath = `/api/projects/tasks/${id}/`;
  const updatesPath = `${taskPath}updates/`;
  const followUpsPath = `${taskPath}follow-ups/`;
  const commentsPath = `${taskPath}comments/`;
  const task = useProjectApi<Task>(taskPath, token);
  const updates = useProjectApi<Update[]>(updatesPath, token);
  const followUps = useProjectApi<FollowUp[]>(followUpsPath, token);
  const comments = useProjectApi<Comment[]>(commentsPath, token);
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [comment, setComment] = useState('');
  const refresh = (paths: string[]) => paths.forEach((path) => void client.invalidateQueries({ queryKey: ['project-detail', path] }));
  const addUpdate = useMutation({ mutationFn: async () => { const value = Number(progress); if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Progress must be a whole number between 0 and 100.'); const response = await fetch(updatesPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` }, body: JSON.stringify({ progress_percentage: value, update_description: note }) }); if (!response.ok) throw await apiErrorFromResponse(response, 'Progress update could not be saved.'); return response.json(); }, onSuccess: () => { setProgress(''); setNote(''); refresh([taskPath, updatesPath]); toast({ title: 'Progress update saved' }); }, onError: (error: Error) => toast({ title: 'Could not save progress update', description: error.message, variant: 'destructive' }) });
  const addFollowUp = useMutation({ mutationFn: async () => { const response = await fetch(followUpsPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` }, body: JSON.stringify({ follow_up_date: followUpDate, notes: followUpNotes }) }); if (!response.ok) throw await apiErrorFromResponse(response, 'Follow-up could not be scheduled.'); return response.json(); }, onSuccess: () => { setFollowUpDate(''); setFollowUpNotes(''); refresh([followUpsPath]); toast({ title: 'Follow-up scheduled' }); }, onError: (error: Error) => toast({ title: 'Could not schedule follow-up', description: error.message, variant: 'destructive' }) });
  const addComment = useMutation({ mutationFn: async () => { const response = await fetch(commentsPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` }, body: JSON.stringify({ body: comment }) }); if (!response.ok) throw await apiErrorFromResponse(response, 'Comment could not be saved.'); return response.json(); }, onSuccess: () => { setComment(''); refresh([commentsPath]); toast({ title: 'Comment added' }); }, onError: (error: Error) => toast({ title: 'Could not add comment', description: error.message, variant: 'destructive' }) });
  const record = task.data;
  return <ERPWorkspacePage title={record ? `${record.number} - ${record.title}` : 'Task'} description="Assignment, progress, follow-ups, and discussion for this task.">
    {!record ? <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">Loading task details...</div> : <div className="grid gap-5 lg:grid-cols-3">
      <section className="rounded-lg border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Task Summary</h2><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{record.description || 'No task description provided.'}</p><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Project</dt><dd className="font-medium">{record.project_name || 'Standalone task'}</dd></div><div><dt className="text-muted-foreground">Assigned to</dt><dd className="font-medium">{record.assignee_name || 'Unassigned'}</dd></div><div><dt className="text-muted-foreground">Branch</dt><dd className="font-medium">{record.branch_name}</dd></div><div><dt className="text-muted-foreground">Due date</dt><dd className="font-medium">{formatDate(record.due_date)}</dd></div></dl></section>
      <aside className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Current State</h2><Badge className="mt-3" variant="outline">{record.status.replaceAll('_', ' ')}</Badge><div className="mt-5 text-3xl font-bold">{record.progress_percentage}%</div><p className="mt-1 text-sm text-muted-foreground">{record.workflow_stage ? `Approval stage: ${record.workflow_stage}` : 'No approval stage active.'}</p></aside>
      <section className="rounded-lg border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Progress Updates</h2><div className="mt-3 grid gap-2 sm:grid-cols-[9rem_1fr_auto]"><Input type="number" min="0" max="100" value={progress} onChange={(event) => setProgress(event.target.value)} placeholder="Progress %" /><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe completed work, blockers, or next action" /><Button disabled={!progress || !note.trim() || addUpdate.isPending} onClick={() => addUpdate.mutate()}>Add update</Button></div><div className="mt-4 space-y-3">{(updates.data ?? []).map((update) => <div className="rounded border p-3 text-sm" key={update.id}><div className="flex justify-between gap-3"><span className="font-medium">{update.progress_percentage}% progress</span><span className="text-muted-foreground">{formatDate(update.created_at)}</span></div><p className="mt-1 text-muted-foreground">{update.update_description}</p></div>)}{!updates.data?.length && <p className="text-sm text-muted-foreground">No progress updates recorded yet.</p>}</div></section>
      <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Follow-ups</h2><div className="mt-3 space-y-2"><Input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /><Textarea value={followUpNotes} onChange={(event) => setFollowUpNotes(event.target.value)} placeholder="What needs to happen?" /><Button className="w-full" variant="outline" disabled={!followUpDate || addFollowUp.isPending} onClick={() => addFollowUp.mutate()}>Schedule follow-up</Button></div><div className="mt-4 space-y-2">{(followUps.data ?? []).map((followUp) => <div className="rounded border p-3 text-sm" key={followUp.id}><div className="flex justify-between gap-2"><span className="font-medium">{formatDate(followUp.follow_up_date)}</span><Badge variant="outline">{followUp.status}</Badge></div><p className="mt-1 text-muted-foreground">{followUp.notes || 'No notes'}</p><p className="mt-1 text-xs text-muted-foreground">Owner: {followUp.owner_name}</p></div>)}</div></section>
      <section className="rounded-lg border bg-card p-5 lg:col-span-3"><h2 className="font-semibold">Discussion</h2><div className="mt-3 flex gap-2"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a task comment" /><Button disabled={!comment.trim() || addComment.isPending} onClick={() => addComment.mutate()}>Comment</Button></div><div className="mt-4 space-y-3">{(comments.data ?? []).map((entry) => <div className="rounded border p-3 text-sm" key={entry.id}><div className="flex justify-between gap-3"><span className="font-medium">{entry.author_name}</span><span className="text-muted-foreground">{formatDate(entry.created_at)}</span></div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{entry.body}</p></div>)}{!comments.data?.length && <p className="text-sm text-muted-foreground">No discussion entries yet.</p>}</div></section>
    </div>}
  </ERPWorkspacePage>;
}
