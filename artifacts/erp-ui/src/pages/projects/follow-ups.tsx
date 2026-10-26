/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ListingPagination } from "@/components/erp/listing/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";

type FollowUp = {
  id: number;
  task_id: number;
  task_number: string;
  task_title: string;
  follow_up_date: string;
  notes: string;
  status: string;
  owner: string;
};
type FollowUpPage = {
  count: number;
  can_create: boolean;
  results: FollowUp[];
  summary: { total: number; open: number; completed: number; overdue: number };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export default function ProjectFollowUps() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskId, setTaskId] = useState('');
  const [followDate, setFollowDate] = useState('');
  const [notes, setNotes] = useState('');
  const options = useQuery<{ results: Array<{ id: number; number: string; title: string }> }>({
    queryKey: ['project-followup-task-options', token, (user as any)?.organization_id, (user as any)?.branch_id, (user as any)?.active_role_group_name, taskSearch],
    enabled: createOpen && !!token,
    queryFn: async () => {
      const response = await fetch(`/api/projects/tasks/?page_size=100&search=${encodeURIComponent(taskSearch)}`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, 'Tasks could not be loaded.');
      return response.json();
    },
  });
  const createFollowUp = useMutation({
    mutationFn: async () => {
      if (!taskId || !followDate || !notes.trim()) throw new Error('Select a task, follow-up date, and notes.');
      const response = await fetch('/api/projects/follow-ups/', { method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ task: Number(taskId), follow_up_date: followDate, notes: notes.trim() }) });
      if (!response.ok) throw await apiErrorFromResponse(response, 'Follow-up could not be created.');
      return response.json();
    },
    onSuccess: () => { setCreateOpen(false); setNotes(''); setTaskId(''); client.invalidateQueries({ queryKey: ['project-followups'] }); client.invalidateQueries({ queryKey: ['projects-follow-ups'] }); client.invalidateQueries({ queryKey: ['project-task-alerts'] }); toast({ title: 'Follow-up scheduled' }); },
    onError: (error: Error) => toast({ title: 'Follow-up could not be created', description: error.message, variant: 'destructive' }),
  });
  const exportRegister = async () => {
    try {
      const query = new URLSearchParams();
      if (status !== "all") query.set("status", status);
      if (search.trim()) query.set("search", search.trim());
      const response = await fetch(
        `/api/projects/follow-ups/export/?${query.toString()}`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Follow-up export could not be prepared.",
        );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "project-follow-ups.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Follow-up CSV downloaded" });
    } catch (error) {
      toast({
        title: "Could not export follow-ups",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };
  const followUps = useQuery<FollowUpPage>({
    queryKey: ["projects-follow-ups", token, (user as any)?.organization_id, (user as any)?.branch_id, (user as any)?.active_role_group_name, page, pageSize, status, search],
    enabled: !!token,
    queryFn: async () => {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (status !== "all") query.set("status", status);
      if (search.trim()) query.set("search", search.trim());
      const response = await fetch(`/api/projects/follow-ups/?${query}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Follow-ups could not be loaded.",
        );
      return response.json();
    },
  });
  const complete = useMutation({
    mutationFn: async (followUp: FollowUp) => {
      const response = await fetch(
        `/api/projects/tasks/${followUp.task_id}/follow-ups/${followUp.id}/complete/`,
        { method: "POST", headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Follow-up could not be completed.",
        );
      return response.json();
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects-follow-ups"] });
      toast({ title: "Follow-up completed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not complete follow-up",
        description: error.message,
        variant: "destructive",
      }),
  });
  const list = followUps.data?.results ?? [];
  const summary = followUps.data?.summary;

  return (
    <ERPWorkspacePage
      title="Project Follow-ups"
      description="Scheduled actions across tasks in your active branch."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Open follow-ups" value={summary?.open ?? 0} />
        <Metric
          label="Overdue"
          value={summary?.overdue ?? 0}
          accent="text-red-600"
        />
        <Metric label="Completed" value={summary?.completed ?? 0} />
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search task, owner, or follow-up notes"
          className="sm:max-w-md"
        />
        <div className="flex gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)} disabled={!followUps.data?.can_create}><Plus className="mr-2 h-4 w-4" />New follow-up</Button>
          <Button variant="outline" onClick={exportRegister}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Task</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr className="border-b last:border-0" key={item.id}>
                <td className="px-4 py-3">{formatDate(item.follow_up_date)}</td>
                <td className="px-4 py-3">
                  <Link href={`/projects/tasks/${item.task_id}`}>
                    <span className="cursor-pointer font-medium hover:underline">
                      {item.task_number} - {item.task_title}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.notes || "-"}
                </td>
                <td className="px-4 py-3">{item.owner}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{item.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {!["completed", "cancelled"].includes(item.status) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={complete.isPending}
                      onClick={() => complete.mutate(item)}
                    >
                      Complete
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No follow-ups are scheduled in this branch.
          </div>
        )}
        <ListingPagination
          page={page}
          pageSize={pageSize}
          totalCount={followUps.data?.count ?? 0}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Schedule follow-up</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Input aria-label="Search tasks for follow-up" placeholder="Search accessible tasks" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} />
          <Select value={taskId} onValueChange={setTaskId}><SelectTrigger aria-label="Follow-up task"><SelectValue placeholder="Select a task" /></SelectTrigger><SelectContent>{(options.data?.results ?? []).map(task => <SelectItem key={task.id} value={String(task.id)}>{task.number} · {task.title}</SelectItem>)}</SelectContent></Select>
          {options.isError && <p role="alert" className="text-sm text-destructive">{options.error.message}</p>}
          <label className="block text-sm">Follow-up date<Input type="date" value={followDate} onChange={event => setFollowDate(event.target.value)} /></label>
          <label className="block text-sm">Notes<Textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="What needs to be checked or discussed?" /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={createFollowUp.isPending} onClick={() => createFollowUp.mutate()}>{createFollowUp.isPending ? 'Saving…' : 'Schedule follow-up'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </ERPWorkspacePage>
  );
}

function Metric({
  label,
  value,
  accent = "",
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-3 text-3xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
