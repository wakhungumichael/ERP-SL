import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { Table } from "@/components/ui/table";
import { ERPListingScope } from "@/components/erp/listing/listing-scope";
import { useProjectSettings } from "./module-settings";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { apiErrorFromResponse } from "@/lib/api-errors";
import {
  EMPTY_TASK_FILTERS,
  TaskFilterFields,
  taskFilterParams,
} from "./task-fields";

type Page<T> = { count: number; results: T[] };
type TaskRow = {
  is_active?: boolean;
  id: number;
  number: string;
  title: string;
  project_name?: string;
  source_ticket_reference?: string;
  assignee_name?: string;
  priority: string;
  due_date: string | null;
  progress_percentage: number;
  status: string;
};
export type MilestoneRow = {
  id: number;
  name: string;
  description: string;
  due_date: string | null;
  status: string;
  progress_percentage: number;
};
export type DocumentRow = {
  id: number;
  source: "project" | "task";
  original_name: string;
  uploaded_by_name: string;
  size_bytes: number;
  created_at: string;
  task_number?: string;
  task_title?: string;
  is_evidence: boolean;
};
const date = (value: string | null) =>
  value ? new Date(value + "T00:00:00").toLocaleDateString() : "—";
const text = (value: string) => value.replaceAll("_", " ");
const cell = "px-4 py-3 align-top text-sm";
const head =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function useRegister<T>(
  path: string,
  extra: Record<string, string>,
  initialOrder = "-created_at",
) {
  const { token, user } = useAuth();
  const settings = useProjectSettings();
  const [page, setPage] = useState(1),
    [chosenPageSize, setPageSize] = useState<number | null>(null),
    [search, rawSearch] = useState(""),
    [ordering, rawOrder] = useState(initialOrder);
  const pageSize = chosenPageSize ?? settings.data?.default_page_size ?? 25;
  const params = new URLSearchParams({
    ...extra,
    page: String(page),
    page_size: String(pageSize),
    ordering,
  });
  if (search.trim()) params.set("search", search.trim());
  const query = useQuery<Page<T>>({
    queryKey: [
      "project-record",
      path,
      params.toString(),
      token,
      user?.organization_id,
      user?.branch_id,
      user?.active_role_group_name,
    ],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(path + "?" + params, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      return response.json();
    },
  });
  return {
    query,
    rows: query.data?.results ?? [],
    count: query.data?.count ?? 0,
    page,
    setPage,
    pageSize,
    setPageSize,
    search,
    ordering,
    setSearch: (value: string) => {
      setPage(1);
      rawSearch(value);
    },
    setOrdering: (value: string) => {
      setPage(1);
      rawOrder(value);
    },
  };
}
type RegisterState = ReturnType<typeof useRegister>;
function Controls({ state, sorts, children, filterToggle = false }: {
  state: RegisterState; sorts: Array<[string, string]>; children?: React.ReactNode; filterToggle?: boolean;
}) {
  const sorting = <Select value={state.ordering} onValueChange={state.setOrdering}>
    <SelectTrigger aria-label="Sort records" className="w-full sm:w-48"><SelectValue /></SelectTrigger>
    <SelectContent>{sorts.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
  </Select>;
  return <ERPFilterBar searchSlot={<Input aria-label="Search records" className="min-w-40 flex-1" placeholder="Search records..." value={state.search} onChange={event => state.setSearch(event.target.value)} />}
    filterControl={filterToggle ? children : undefined} filterSlot={filterToggle ? undefined : <>{sorting}{children}</>} toolsSlot={filterToggle ? sorting : undefined} />;
}
function Pager({ state }: { state: RegisterState }) {
  return (
    <div className="overflow-x-auto px-3">
      <ListingPagination
        page={state.page}
        pageSize={state.pageSize}
        totalCount={state.count}
        onPage={state.setPage}
        onPageSize={state.setPageSize}
      />
    </div>
  );
}
function Empty({ state }: { state: RegisterState }) {
  return state.query.isError ? (
    <p role="alert" className="p-4 text-sm text-destructive">
      {state.query.error.message}
    </p>
  ) : !state.rows.length ? (
    <p className="p-6 text-center text-sm text-muted-foreground">
      {state.query.isLoading ? "Loading records…" : "No matching records."}
    </p>
  ) : null;
}

export function ProjectTaskRegister({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState({ ...EMPTY_TASK_FILTERS }),
    [open, setOpen] = useState(false),
    [status, setStatus] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const state = useRegister<TaskRow>(
    "/api/projects/tasks/",
    {
      ...taskFilterParams(filters),
      project: projectId,
      status,
      ...(from ? { date_from: from } : {}),
      ...(to ? { date_to: to } : {}),
    },
    "due_date",
  );
  return <ERPListingScope>{(
    <div className="rounded-lg border">
      <Controls
        filterToggle
        state={state}
        sorts={[
          ["due_date", "Due date · earliest"],
          ["-due_date", "Due date · latest"],
          ["number", "Number"],
          ["title", "Task title"],
          ["priority", "Priority"],
          ["status", "Status"],
          ["progress_percentage", "Progress"],
        ]}
      >
        <Button variant="outline" onClick={() => setOpen(!open)}>
          Filters
        </Button>
      </Controls>
      {open && (
        <div className="space-y-4 border-b bg-muted/20 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  state.setPage(1);
                }}
              >
                <SelectTrigger aria-label="Task status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "all",
                    "draft",
                    "todo",
                    "in_progress",
                    "blocked",
                    "reopened",
                    "in_review",
                    "completed",
                    "cancelled",
                  ].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v === "all" ? "All statuses" : text(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due from</Label>
              <Input
                type="date"
                aria-label="Due from"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  state.setPage(1);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Due to</Label>
              <Input
                type="date"
                aria-label="Due to"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  state.setPage(1);
                }}
              />
            </div>
          </div>
          <TaskFilterFields
            value={filters}
            projectId={projectId}
            onChange={(next) => {
              setFilters(next);
              state.setPage(1);
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilters({ ...EMPTY_TASK_FILTERS });
              setStatus("all");
              setFrom("");
              setTo("");
              state.setPage(1);
              state.setSearch("");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table className="w-full min-w-[1000px]">
          <thead className="border-b bg-muted/30">
            <tr>
              {[
                "#",
                "Number",
                "Task",
                "Project",
                "Source ticket",
                "Assigned to",
                "Priority",
                "Due date",
                "Progress",
                "Status",
              ].map((label) => (
                <th className={head} key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, index) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className={cell}>
                  {(state.page - 1) * state.pageSize + index + 1}
                </td>
                <td className={cell}>
                  <Link
                    href={`/projects/tasks/${row.id}`}
                    className="font-mono underline"
                  >
                    {row.number}
                  </Link>
                </td>
                <td className={cell}>
                  <Link
                    href={`/projects/tasks/${row.id}`}
                    className="font-medium hover:underline"
                  >
                    {row.title}
                  </Link>
                </td>
                <td className={cell}>{row.project_name || "—"}</td>
                <td className={cell}>{row.source_ticket_reference || "—"}</td>
                <td className={cell}>{row.assignee_name || "Unassigned"}</td>
                <td className={cell}>{text(row.priority)}</td>
                <td className={cell}>{date(row.due_date)}</td>
                <td className={cell}>{row.progress_percentage}%</td>
                <td className={cell}>
                  <Badge variant="outline">
                    {row.is_active === false ? "Inactive · " : ""}
                    {text(row.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Empty state={state} />
      <Pager state={state} />
    </div>
  )}</ERPListingScope>;
}

export function ProjectMilestoneRegister({
  projectId,
  onEdit,
  onComplete,
  onRemove,
  canEdit,
  canRemove = false,
  busy,
}: {
  projectId: string;
  onEdit: (row: MilestoneRow) => void;
  onComplete: (id: number) => void;
  onRemove: (id: number) => void;
  canEdit: boolean;
  canRemove?: boolean;
  busy: boolean;
}) {
  const [status, setStatus] = useState("all");
  const state = useRegister<MilestoneRow>(
    `/api/projects/projects/${projectId}/milestones/`,
    { status },
    "due_date",
  );
  return <ERPListingScope>{(
    <div className="rounded-lg border">
      <Controls
        state={state}
        sorts={[
          ["due_date", "Due date · earliest"],
          ["-due_date", "Due date · latest"],
          ["name", "Milestone name"],
          ["status", "Status"],
          ["progress_percentage", "Progress"],
        ]}
      >
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            state.setPage(1);
          }}
        >
          <SelectTrigger
            aria-label="Milestone status"
            className="w-full sm:w-40"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["all", "draft", "open", "completed", "cancelled"].map((v) => (
              <SelectItem value={v} key={v}>
                {v === "all" ? "All statuses" : text(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Controls>
      <div className="overflow-x-auto">
        <Table className="w-full min-w-[700px]">
          <thead className="border-b bg-muted/30">
            <tr>
              {[
                "#",
                "Milestone",
                "Due date",
                "Progress",
                "Status",
                "Actions",
              ].map((label) => (
                <th className={head} key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, index) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className={cell}>
                  {(state.page - 1) * state.pageSize + index + 1}
                </td>
                <td className={cell}>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.description}
                  </p>
                </td>
                <td className={cell}>{date(row.due_date)}</td>
                <td className={cell}>{row.progress_percentage}%</td>
                <td className={cell}>
                  <Badge variant="outline">{row.status}</Badge>
                </td>
                <td className={cell}>
                  {(canEdit || canRemove) && (
                    <div className="flex gap-2">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onEdit(row)}
                        >
                          Edit
                        </Button>
                      )}
                      {canEdit && row.status !== "completed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onComplete(row.id)}
                        >
                          Complete
                        </Button>
                      )}
                      {canRemove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(`Remove milestone “${row.name}”?`)
                            ) {
                              state.setPage(1);
                              onRemove(row.id);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Empty state={state} />
      <Pager state={state} />
    </div>
  )}</ERPListingScope>;
}

export function DocumentPreview({
  projectId,
  file,
  onClose,
}: {
  projectId: string;
  file: DocumentRow | null;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const [content, setContent] = useState<{
    url?: string;
    type?: string;
    text?: string;
    note?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!file) return;
    let url = "";
    const controller = new AbortController();
    setContent(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/projects/projects/${projectId}/document-preview/${file.source}/${file.id}/`,
          {
            headers: { Authorization: `Token ${token}` },
            signal: controller.signal,
            cache: "no-store",
          },
        );
        if (!response.ok) throw await apiErrorFromResponse(response);
        if (
          response.headers.get("content-type")?.includes("application/json")
        ) {
          const data = await response.json();
          if (!controller.signal.aborted)
            setContent({ text: data.text, note: data.note });
        } else {
          const blob = await response.blob();
          url = URL.createObjectURL(blob);
          if (!controller.signal.aborted) setContent({ url, type: blob.type });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setContent({
            error:
              error instanceof Error
                ? error.message
                : "Preview could not be loaded.",
          });
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, projectId, token]);
  return (
    <Dialog
      open={!!file}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw_-_2rem)] max-w-6xl flex-col overflow-hidden">
        <DialogHeader className="pr-6">
          <DialogTitle className="break-all">{file?.original_name}</DialogTitle>
          <DialogDescription>Document preview</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {!content ? (
            <p className="p-8 text-center text-muted-foreground">
              Loading preview…
            </p>
          ) : content.error ? (
            <p role="alert" className="p-4 text-destructive">
              {content.error}
            </p>
          ) : content.text !== undefined ? (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                {content.note}
              </p>
              <pre className="max-h-[65dvh] whitespace-pre-wrap break-words rounded border bg-muted/20 p-4 text-sm">
                {content.text}
              </pre>
            </>
          ) : content.type === "application/pdf" ? (
            <iframe
              title={file?.original_name}
              src={content.url}
              className="h-[65dvh] w-full border-0"
            />
          ) : (
            <img
              alt={file?.original_name}
              src={content.url}
              className="mx-auto max-h-[65dvh] max-w-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectDocumentRegister({
  projectId,
  onRemove,
  canRemove,
  busy,
}: {
  projectId: string;
  onRemove: (id: number) => void;
  canRemove: boolean;
  busy: boolean;
}) {
  const { token } = useAuth();
  const [source, setSource] = useState("all"),
    [preview, setPreview] = useState<DocumentRow | null>(null),
    [downloadError, setDownloadError] = useState(""),
    [downloading, setDownloading] = useState(false);
  const state = useRegister<DocumentRow>(
    `/api/projects/projects/${projectId}/documents/`,
    { source },
  );
  const download = async (file: DocumentRow) => {
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(
        `/api/projects/projects/${projectId}/document-preview/${file.source}/${file.id}/?download=1`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.original_name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Download could not be completed.",
      );
    } finally {
      setDownloading(false);
    }
  };
  return <ERPListingScope>{(
    <div className="rounded-lg border">
      <Controls
        state={state}
        sorts={[
          ["-created_at", "Newest first"],
          ["original_name", "File name"],
        ]}
      >
        <Select
          value={source}
          onValueChange={(v) => {
            setSource(v);
            state.setPage(1);
          }}
        >
          <SelectTrigger
            aria-label="Document source"
            className="w-full sm:w-40"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All documents</SelectItem>
            <SelectItem value="project">Project documents</SelectItem>
            <SelectItem value="task">Task attachments</SelectItem>
          </SelectContent>
        </Select>
      </Controls>
      <div className="overflow-x-auto">
        <Table className="w-full min-w-[800px]">
          <thead className="border-b bg-muted/30">
            <tr>
              {[
                "#",
                "Document",
                "Source",
                "Uploaded by",
                "Uploaded",
                "Size",
                "Actions",
              ].map((label) => (
                <th className={head} key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((file, index) => (
              <tr
                key={file.source + "-" + file.id}
                className="border-b last:border-0"
              >
                <td className={cell}>
                  {(state.page - 1) * state.pageSize + index + 1}
                </td>
                <td className={cell}>
                  <button
                    className="text-left font-medium underline"
                    onClick={() => setPreview(file)}
                  >
                    {file.original_name}
                  </button>
                  {file.is_evidence && (
                    <Badge className="ml-2" variant="outline">
                      Evidence
                    </Badge>
                  )}
                </td>
                <td className={cell}>
                  {file.source === "project"
                    ? "Project document"
                    : file.task_number || "Task attachment"}
                </td>
                <td className={cell}>{file.uploaded_by_name}</td>
                <td className={cell}>
                  {new Date(file.created_at).toLocaleString()}
                </td>
                <td className={cell}>
                  {(file.size_bytes / 1024).toFixed(1)} KB
                </td>
                <td className={cell}>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreview(file)}
                    >
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={downloading}
                      onClick={() => void download(file)}
                    >
                      Download
                    </Button>
                    {canRemove && file.source === "project" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(`Remove “${file.original_name}”?`)
                          ) {
                            state.setPage(1);
                            onRemove(file.id);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {downloadError && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {downloadError}
        </p>
      )}
      <Empty state={state} />
      <Pager state={state} />
      <DocumentPreview
        projectId={projectId}
        file={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  )}</ERPListingScope>;
}
