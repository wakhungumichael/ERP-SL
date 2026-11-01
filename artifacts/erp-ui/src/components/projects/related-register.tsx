import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { useToast } from "@/hooks/use-toast";
import { useProjectSettings } from "./module-settings";
import { DocumentPreview, type DocumentRow } from "./project-registers";

export type RelatedRow = { id: number; [key: string]: any };
export type RelatedColumn = {
  label: string;
  render: (row: RelatedRow) => ReactNode;
};
const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleString() : "—";
export function RelatedRegister({
  path,
  label,
  columns,
  sorts,
  params = {},
  mobileCards = false,
}: {
  path: string;
  label: string;
  columns: RelatedColumn[];
  sorts: Array<[string, string]>;
  params?: Record<string, string>;
  mobileCards?: boolean;
}) {
  const { token, user } = useAuth();
  const settings = useProjectSettings();
  const [page, setPage] = useState(1),
    [chosenSize, setSize] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [ordering, setOrdering] = useState(sorts[0][0]);
  const pageSize = chosenSize ?? settings.data?.default_page_size ?? 25;
  const query = new URLSearchParams({
    ...params,
    page: String(page),
    page_size: String(pageSize),
    ordering,
    search,
  });
  const records = useQuery<{ count: number; results: RelatedRow[] }>({
    queryKey: [
      "project-related",
      path,
      query.toString(),
      token,
      user?.organization_id,
      user?.branch_id,
      user?.active_role_group_name,
    ],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(path + "?" + query, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) {
        if (response.status === 404 && page > 1) setPage(1);
        throw await apiErrorFromResponse(response);
      }
      return response.json();
    },
  });
  useEffect(() => {
    setPage(1);
  }, [path, pageSize]);
  return (
    <div
      className="mt-4 min-w-0 overflow-hidden rounded-lg border"
      aria-label={label}
    >
      <div className="flex flex-wrap gap-2 border-b p-3">
        <Input
          className="min-w-40 flex-1"
          aria-label={`Search ${label}`}
          placeholder={`Search ${label.toLowerCase()}`}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Select
          value={ordering}
          onValueChange={(value) => {
            setOrdering(value);
            setPage(1);
          }}
        >
          <SelectTrigger
            className="w-full sm:w-44"
            aria-label={`Sort ${label}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map(([value, title]) => (
              <SelectItem key={value} value={value}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {records.isError && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {records.error.message}
        </p>
      )}
      {mobileCards && (
        <div className="divide-y md:hidden">
          {(records.data?.results ?? []).map((row, index) => (
            <article
              key={row.id}
              className="space-y-3 p-4"
              aria-label={`${label} row ${(page - 1) * pageSize + index + 1}`}
            >
              <p className="font-mono text-xs text-muted-foreground">
                No. {(page - 1) * pageSize + index + 1}
              </p>
              <dl className="grid min-w-0 gap-3">
                {columns.map((column) => (
                  <div key={column.label} className="min-w-0">
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">
                      {column.label}
                    </dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words text-sm [&_button]:max-w-full [&>div]:flex-wrap">
                      {column.render(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
      <div
        className={
          mobileCards ? "hidden overflow-x-auto md:block" : "overflow-x-auto"
        }
      >
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-3">No.</th>
              {columns.map((column) => (
                <th className="px-3 py-3" key={column.label}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(records.data?.results ?? []).map((row, index) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-3 py-3 align-top font-mono text-xs">
                  {(page - 1) * pageSize + index + 1}
                </td>
                {columns.map((column) => (
                  <td
                    className="max-w-lg whitespace-pre-wrap break-words px-3 py-3 align-top"
                    key={column.label}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!records.isError && !records.data?.results.length && (
        <p className="p-5 text-center text-sm text-muted-foreground">
          {records.isLoading ? "Loading records…" : "No matching records."}
        </p>
      )}
      <div className="px-3">
        <ListingPagination
          wrap
          page={page}
          pageSize={pageSize}
          totalCount={records.data?.count ?? 0}
          onPage={setPage}
          onPageSize={(value) => {
            setSize(value);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
export function ProjectTeamRegister({
  projectId,
  onRemove,
  busy,
  canManage,
}: {
  projectId: string;
  onRemove: (id: number) => void;
  busy: boolean;
  canManage: boolean;
}) {
  return (
    <RelatedRegister
      path={`/api/projects/projects/${projectId}/members/`}
      label="Project team"
      sorts={[
        ["user__username", "Member name"],
        ["branch__name", "Branch"],
        ["responsibility", "Responsibility"],
      ]}
      columns={[
        { label: "Member", render: (row) => row.user_name },
        { label: "Branch", render: (row) => row.branch_name },
        { label: "Responsibility", render: (row) => row.responsibility },
        ...(canManage
          ? [
              {
                label: "Actions",
                render: (row: RelatedRow) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || row.access?.can_remove === false}
                    onClick={() => onRemove(row.id)}
                  >
                    Remove
                  </Button>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
export function TaskRelatedRegister({
  taskId,
  projectId,
  kind,
  onComplete,
  onRemove,
  busy = false,
  canRemove = false,
  onToggle,
}: {
  taskId: string;
  projectId: number;
  kind:
    | "checklist"
    | "updates"
    | "follow-ups"
    | "comments"
    | "attachments"
    | "subtasks"
    | "dependencies";
  onComplete?: (id: number) => void;
  onToggle?: (row: RelatedRow) => void;
  onRemove?: (id: number) => void;
  busy?: boolean;
  canRemove?: boolean;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const structured = kind === "subtasks" || kind === "dependencies";
  let columns: RelatedColumn[], sorts: Array<[string, string]>, label: string;
  const download = async (row: RelatedRow) => {
    try {
      const response = await fetch(
        `/api/projects/projects/${projectId}/document-preview/task/${row.id}/?download=1`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = row.original_name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({
        title: "Download failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };
  if (kind === "checklist") {
    label = "Deliverables";
    sorts = [
      ["created_at", "Created first"],
      ["title", "Title"],
      ["is_completed", "Completion"],
    ];
    columns = [
      {
        label: "Done",
        render: (row) => (
          <input
            type="checkbox"
            aria-label={`Complete ${row.title}`}
            checked={row.is_completed}
            disabled={busy || !onToggle}
            onChange={() => onToggle?.(row)}
          />
        ),
      },
      { label: "Deliverable", render: (row) => row.title },
      { label: "Completed by", render: (row) => row.completed_by_name || "—" },
    ];
  } else if (kind === "updates") {
    label = "Activity";
    sorts = [
      ["-created_at", "Newest first"],
      ["created_at", "Oldest first"],
      ["progress_percentage", "Progress"],
    ];
    columns = [
      { label: "Date", render: (r) => formatDate(r.created_at) },
      { label: "By", render: (r) => r.updated_by_name },
      { label: "Update", render: (r) => r.update_description },
      { label: "Progress", render: (r) => `${r.progress_percentage}%` },
      { label: "Hours", render: (r) => r.time_spent_hours },
    ];
  } else if (kind === "follow-ups") {
    label = "Follow-ups";
    sorts = [
      ["follow_up_date", "Date: earliest"],
      ["-follow_up_date", "Date: latest"],
      ["status", "Status"],
    ];
    columns = [
      { label: "Date", render: (r) => r.follow_up_date },
      { label: "Reminder", render: (r) => r.notes },
      { label: "Owner", render: (r) => r.owner_name },
      {
        label: "Status",
        render: (r) => <Badge variant="outline">{r.status}</Badge>,
      },
      {
        label: "Actions",
        render: (r) =>
          !!onComplete &&
          !["completed", "cancelled"].includes(r.status) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onComplete?.(r.id)}
            >
              Complete follow-up
            </Button>
          ),
      },
    ];
  } else if (kind === "comments") {
    label = "Discussion";
    sorts = [
      ["-created_at", "Newest first"],
      ["created_at", "Oldest first"],
    ];
    columns = [
      { label: "Date", render: (r) => formatDate(r.created_at) },
      { label: "Author", render: (r) => r.author_name },
      { label: "Comment", render: (r) => r.body },
      {
        label: "Notified",
        render: (r) => (r.mention_names ?? []).join(", ") || "—",
      },
    ];
  } else if (kind === "attachments") {
    label = "Files";
    sorts = [
      ["-created_at", "Newest first"],
      ["original_name", "File name"],
      ["-size_bytes", "Largest first"],
    ];
    columns = [
      { label: "File", render: (r) => r.original_name },
      { label: "Uploaded by", render: (r) => r.uploaded_by_name },
      { label: "Date", render: (r) => formatDate(r.created_at) },
      {
        label: "Size",
        render: (r) => `${Math.ceil((r.size_bytes ?? 0) / 1024)} KB`,
      },
      { label: "Evidence", render: (r) => (r.is_evidence ? "Yes" : "No") },
      {
        label: "Actions",
        render: (r) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPreview({ ...r, source: "task" } as DocumentRow)
              }
            >
              Preview
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void download(r)}
            >
              Download
            </Button>
            {canRemove && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove ${r.original_name}?`))
                    onRemove?.(r.id);
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ),
      },
    ];
  } else {
    label = kind === "subtasks" ? "Subtasks" : "Dependencies";
    sorts = [
      ["number", "Task number"],
      ["title", "Task title"],
      ["status", "Status"],
      ["due_date", "Due date"],
    ];
    columns = [
      {
        label: "Number",
        render: (r) => (
          <Link
            className="whitespace-nowrap font-mono text-primary underline"
            href={`/projects/tasks/${r.id}`}
          >
            {r.number}
          </Link>
        ),
      },
      {
        label: "Task",
        render: (r) => (
          <Link
            className="text-primary underline"
            href={`/projects/tasks/${r.id}`}
          >
            {r.title}
          </Link>
        ),
      },
      { label: "Assigned to", render: (r) => r.assignee_name || "Unassigned" },
      { label: "Due date", render: (r) => r.due_date || "—" },
      {
        label: "Status",
        render: (r) => (
          <Badge variant="outline">
            {r.is_active === false ? "Inactive · " : ""}
            {r.status?.replaceAll("_", " ")}
          </Badge>
        ),
      },
    ];
  }
  return (
    <>
      <RelatedRegister
        path={`/api/projects/tasks/${taskId}/${structured ? "structure" : kind}/`}
        label={label}
        columns={columns}
        sorts={sorts}
        mobileCards
        params={structured ? { kind } : undefined}
      />
      <DocumentPreview
        projectId={String(projectId)}
        file={preview}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
