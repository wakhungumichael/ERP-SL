/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  results: FollowUp[];
  summary: { total: number; open: number; completed: number; overdue: number };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export default function ProjectFollowUps() {
  const { token } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const followUps = useQuery<FollowUpPage>({
    queryKey: ["projects-follow-ups", page, pageSize, status, search],
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
