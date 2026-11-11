import { ERPFilterBar } from "@/components/erp/listing/filter-bar";
import { ERPListingScope } from "@/components/erp/listing/listing-scope";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Allocation = {
  id?: number;
  account?: number;
  account_name?: string;
  account_code?: string;
  cost_center?: string;
  project_code?: string;
  period_year?: number;
  period_month?: number | null;
  allocated_amount?: string;
  notes?: string;
};
type Item = {
  id?: number;
  budget_line: number;
  description: string;
  category: string;
  quantity: string;
  unit: string;
  estimated_amount: string;
  procurement_method: string;
  planned_date: string | null;
  notes?: string;
  account_name?: string;
  department_code?: string;
};
type RecordRow = {
  id: number;
  name: string;
  code: string;
  department?: number | null;
  department_name?: string;
  annual_budget?: number | null;
  budget_name?: string;
  currency: string;
  status: string;
  approval_status?: string;
  total_amount: string;
  source_budgets?: number[];
  access: {
    can_edit?: boolean;
    can_submit?: boolean;
    can_consolidate?: boolean;
  };
  branch?: number | null;
  financial_year?: number | null;
  start_date?: string;
  end_date?: string;
  lines: (Allocation & Partial<Item>)[];
};
type Option = {
  id: number;
  name: string;
  code?: string;
  start_date?: string;
  end_date?: string;
  lines?: { id: number; name: string; department: string; amount: string }[];
};
type Options = {
  departments?: Option[];
  branches?: Option[];
  accounts?: Option[];
  financial_years?: Option[];
  budgets?: Option[];
  access: { can_create: boolean; can_consolidate?: boolean };
};
const selectClass =
  "flex h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid min-w-0 gap-2 text-sm">
      {label}
      {children}
    </Label>
  );
}
function money(value: string, currency = "KES") {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
    }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function PlanningWorkspace({
  plans = false,
}: {
  plans?: boolean;
}) {
  const { token, user } = useAuth(),
    { toast } = useToast(),
    qc = useQueryClient(),
    searchParams = useSearch();
  const base = plans ? "/api/procurement/plans" : "/api/budgeting/budgets";
  const [kind, setKind] = useState("department"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState(false),
    [form, setForm] = useState<any>(null),
    [failure, setFailure] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [mergeOpen, setMergeOpen] = useState(false),
    [mergeName, setMergeName] = useState(""),
    [mergeCode, setMergeCode] = useState("");
  const [recordId, setRecordId] = useState<number | null>(null);
  const scope = [
    token,
    user?.organization_id,
    user?.branch_id,
    user?.active_branch_id,
    user?.active_role_group_name,
  ];
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    return response.json();
  };
  const options = useQuery<Options>({
    queryKey: ["planning", ...scope, base, "options"],
    enabled: !!token,
    queryFn: () => api(plans ? `${base}/options/` : "/api/budgeting/options/"),
  });
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    search,
    ...(!plans ? { kind } : {}),
    ...(status ? { [plans ? "status" : "approval_status"]: status } : {}),
  });
  const rows = useQuery<{ results: RecordRow[]; count: number }>({
    queryKey: ["planning", ...scope, base, query.toString()],
    enabled: !!token,
    queryFn: () => api(`${base}/?${query}`),
  });
  const detail = useQuery<RecordRow>({
    queryKey: ["planning", ...scope, base, "record", recordId],
    enabled: !!token && !!recordId,
    queryFn: () => api(`${base}/${recordId}/`),
  });
  useEffect(() => {
    const value = Number(
      new URLSearchParams(searchParams).get(plans ? "plan" : "budget"),
    );
    setRecordId(value || null);
  }, [searchParams, plans]);
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [kind, search, status, base]);
  useEffect(() => {
    setOpen(false);
    setForm(null);
    setRecordId(
      Number(
        new URLSearchParams(searchParams).get(plans ? "plan" : "budget"),
      ) || null,
    );
    setSelected([]);
  }, [token, user?.organization_id, user?.active_role_group_name]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["planning"] });
  const edit = (row: RecordRow) => {
    setFailure("");
    setForm({ ...row, lines: row.lines.map((line) => ({ ...line })) });
    setOpen(true);
  };
  const create = () => {
    const year = new Date().getFullYear();
    setFailure("");
    setForm(
      plans
        ? { name: "", code: "", annual_budget: "", lines: undefined }
        : {
            name: "",
            code: "",
            department: "",
            branch: "",
            financial_year: "",
            start_date: `${year}-01-01`,
            end_date: `${year}-12-31`,
            currency: "KES",
            lines: [
              {
                account: "",
                allocated_amount: "",
                cost_center: "",
                period_year: year,
                notes: "",
              },
            ],
          },
    );
    setOpen(true);
  };
  const save = useMutation({
    mutationFn: () => {
      const body = plans
        ? {
            name: form.name,
            code: form.code,
            annual_budget: Number(form.annual_budget),
            ...(form.lines
              ? {
                  lines: form.lines.map((line: Item) => ({
                    budget_line: Number(line.budget_line),
                    description: line.description,
                    category: line.category,
                    quantity: line.quantity,
                    unit: line.unit,
                    estimated_amount: line.estimated_amount,
                    procurement_method: line.procurement_method,
                    planned_date: line.planned_date || null,
                    notes: line.notes || "",
                  })),
                }
              : {}),
          }
        : {
            name: form.name,
            code: form.code,
            department: Number(form.department) || null,
            branch: Number(form.branch) || null,
            financial_year: Number(form.financial_year) || null,
            start_date: form.start_date,
            end_date: form.end_date,
            currency: form.currency,
            period_type: "annual",
            lines: form.lines.map((line: Allocation) => ({
              account: Number(line.account),
              cost_center: line.cost_center || "GENERAL",
              project_code: line.project_code || "",
              period_year: Number(line.period_year),
              period_month: line.period_month || null,
              allocated_amount: line.allocated_amount,
              notes: line.notes || "",
            })),
          };
      return api(
        `${base}/${form.id ? `${form.id}/` : ""}`,
        form.id ? "PATCH" : "POST",
        body,
      );
    },
    onSuccess: (row: RecordRow) => {
      setOpen(false);
      setRecordId(row.id);
      void refresh();
      toast({ title: plans ? "Procurement plan saved" : "Budget saved" });
    },
    onError: (error: Error) => setFailure(error.message),
  });
  const submit = useMutation({
    mutationFn: (row: RecordRow) =>
      api("/api/platform/workflows/forward/", "POST", {
        module_slug: plans ? "procurement" : "budgeting",
        entity_type: plans
          ? "procurement_plan"
          : row.department
            ? "department_budget"
            : "annual_budget",
        entity_id: row.id,
        trigger_event: "submit",
      }),
    onSuccess: () => {
      void refresh();
      toast({ title: "Submitted for approval" });
    },
    onError: (error: Error) =>
      toast({
        title: "Submission failed",
        description: error.message,
        variant: "destructive",
      }),
  });
  const merge = useMutation({
    mutationFn: () =>
      api("/api/budgeting/budgets/consolidate/", "POST", {
        budgets: selected,
        name: mergeName,
        code: mergeCode,
      }),
    onSuccess: (row: RecordRow) => {
      setMergeOpen(false);
      setSelected([]);
      setKind("annual");
      setRecordId(row.id);
      void refresh();
      toast({ title: "Annual budget created" });
    },
    onError: (error: Error) => setFailure(error.message),
  });
  const exportCsv = async (row: RecordRow) => {
    try {
      const response = await fetch(`${base}/${row.id}/?export=csv`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `procurement-plan-${row.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Export failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };
  const updateLine = (index: number, field: string, value: unknown) =>
    setForm((current: any) => ({
      ...current,
      lines: current.lines.map((line: any, i: number) =>
        i === index ? { ...line, [field]: value } : line,
      ),
    }));
  const optionElements = (choices: Option[] = []) =>
    choices.map((row) => (
      <option key={row.id} value={row.id}>
        {row.code ? `${row.code} — ` : ""}
        {row.name}
      </option>
    ));
  const statusValue = (row: RecordRow) =>
    plans ? row.status : row.approval_status || row.status;
  const record = detail.data;
  const actions = (row: RecordRow) => (
    <div className="flex flex-wrap gap-2">
      {row.access.can_edit ? (
        <Button variant="outline" onClick={() => edit(row)}>
          Edit
        </Button>
      ) : null}
      {row.access.can_submit ? (
        <Button disabled={submit.isPending} onClick={() => submit.mutate(row)}>
          Submit for approval
        </Button>
      ) : null}
      {plans ? (
        <Button variant="outline" onClick={() => void exportCsv(row)}>
          Export CSV
        </Button>
      ) : null}
    </div>
  );
  const editable = !form?.id || form?.access?.can_edit;
  const planBudget = options.data?.budgets?.find(
    (row) => row.id === Number(form?.annual_budget),
  );
  return <ERPListingScope>{(
    <ERPWorkspacePage
      title={plans ? "Procurement plans" : "Budgets"}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/workflows/approvals">Approvals</Link>
          </Button>
          {!plans ? (
            <Button asChild variant="outline">
              <Link href="/procurement/plans">Procurement plans</Link>
            </Button>
          ) : null}
          {options.data?.access.can_create ? (
            <Button onClick={create}>
              {plans ? "New procurement plan" : "New department budget"}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="min-w-0 space-y-4">
        {!plans ? (
          <div className="flex flex-wrap gap-2">
            {["department", "annual"].map((value) => (
              <Button
                key={value}
                variant={kind === value ? "default" : "outline"}
                onClick={() => setKind(value)}
              >
                {value === "department"
                  ? "Department budgets"
                  : "Annual budgets"}
              </Button>
            ))}
            {kind === "department" && options.data?.access.can_consolidate ? (
              <Button
                variant="outline"
                disabled={!selected.length}
                onClick={() => {
                  setFailure("");
                  setMergeOpen(true);
                }}
              >
                Consolidate selected ({selected.length})
              </Button>
            ) : null}
          </div>
        ) : null}
        <ERPFilterBar searchSlot={<Input
            aria-label="Search"
            className="w-full sm:max-w-sm"
            placeholder={plans ? "Search procurement plans" : "Search budgets"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />} />
        {rows.error || options.error ? (
          <p role="alert" className="text-sm text-destructive">
            {(rows.error || options.error)?.message}
          </p>
        ) : null}
        {rows.isLoading ? <p>Loading…</p> : null}
        <div className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 border-b bg-muted/40 p-3 text-xs font-semibold uppercase md:grid">
            <span>Name / code</span>
            <span>{plans ? "Annual budget" : "Department"}</span>
            <span>Amount</span>
            <span>Status</span>
          </div>
          {(rows.data?.results ?? []).map((row) => (
            <div
              key={row.id}
              className="grid min-w-0 gap-3 border-b p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                {!plans && row.access.can_consolidate ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.includes(row.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, row.id]
                          : current.filter((id) => id !== row.id),
                      )
                    }
                  />
                ) : null}
                <button
                  className="min-w-0 text-left hover:underline"
                  onClick={() => setRecordId(row.id)}
                >
                  <span className="block break-words font-medium">
                    {row.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.code}
                  </span>
                </button>
              </div>
              <span className="break-words text-sm text-muted-foreground">
                {plans
                  ? row.budget_name
                  : row.department_name || "Organization"}
              </span>
              <span className="text-sm">
                {money(row.total_amount, row.currency)}
              </span>
              <Badge variant="secondary" className="w-fit capitalize">
                {label(statusValue(row))}
              </Badge>
            </div>
          ))}
          {!rows.isLoading && !rows.data?.results.length ? (
            <p className="p-6 text-sm text-muted-foreground">
              No {plans ? "procurement plans" : "budgets"} found.
            </p>
          ) : null}
          <div className="px-3">
            <ListingPagination
              page={page}
              pageSize={pageSize}
              totalCount={rows.data?.count ?? 0}
              onPage={setPage}
              onPageSize={setPageSize}
              wrap
            />
          </div>
        </div>
        {record ? (
          <section className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="break-words text-lg font-semibold">
                  {record.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {record.code} · {money(record.total_amount, record.currency)}{" "}
                  · {label(statusValue(record))}
                </p>
                {record.source_budgets?.length ? (
                  <p className="text-sm">
                    Consolidated from {record.source_budgets.length} department
                    budgets.
                  </p>
                ) : null}
              </div>
              {actions(record)}
            </div>
            <div className="space-y-2">
              {record.lines.map((line, index) => (
                <div
                  key={line.id ?? index}
                  className="flex flex-wrap justify-between gap-2 rounded border p-3 text-sm"
                >
                  <span className="break-words">
                    {plans ? line.description : line.notes || line.account_name}
                    <span className="block text-xs text-muted-foreground">
                      {plans ? line.department_code : line.cost_center}
                      {plans ? ` · ${line.planned_date || "Date not set"}` : ""}
                    </span>
                  </span>
                  <span>
                    {money(
                      plans
                        ? line.estimated_amount || "0"
                        : line.allocated_amount || "0",
                      record.currency,
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : detail.error ? (
          <p role="alert" className="text-destructive">
            {detail.error.message}
          </p>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%_-_1rem)] sm:max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Edit" : "New"}{" "}
              {plans
                ? "procurement plan"
                : form?.id && !form.department
                  ? "annual budget"
                  : "department budget"}
            </DialogTitle>
            <DialogDescription>
              {plans
                ? "Select an approved annual budget, then refine the procurement items before submitting."
                : "Enter the department’s proposed annual allocations."}
            </DialogDescription>
          </DialogHeader>
          {form ? (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                setFailure("");
                save.mutate();
              }}
            >
              <fieldset
                disabled={!editable || save.isPending}
                className="grid min-w-0 gap-4 sm:grid-cols-2"
              >
                <Field label="Name">
                  <Input
                    required
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </Field>
                <Field label="Code">
                  <Input
                    required
                    maxLength={plans ? 50 : 40}
                    value={form.code}
                    onChange={(event) =>
                      setForm({ ...form, code: event.target.value })
                    }
                  />
                </Field>
                {plans ? (
                  <Field label="Approved annual budget">
                    <select
                      required
                      className={selectClass}
                      disabled={!!form.id}
                      value={form.annual_budget || ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          annual_budget: Number(event.target.value),
                          lines: undefined,
                        })
                      }
                    >
                      <option value="">Select annual budget</option>
                      {optionElements(options.data?.budgets)}
                    </select>
                  </Field>
                ) : (
                  <>
                    <Field label="Department">
                      <select
                        required={!form.id || !!form.department}
                        disabled={!!form.id && !form.department}
                        className={selectClass}
                        value={form.department || ""}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            department: Number(event.target.value),
                          })
                        }
                      >
                        <option value="">
                          {form.id && !form.department
                            ? "Organization"
                            : "Select department"}
                        </option>
                        {optionElements(options.data?.departments)}
                      </select>
                    </Field>
                    <Field label="Branch">
                      <select
                        className={selectClass}
                        value={form.branch || ""}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            branch: Number(event.target.value) || null,
                          })
                        }
                      >
                        <option value="">Organization wide</option>
                        {optionElements(options.data?.branches)}
                      </select>
                    </Field>
                    <Field label="Financial year">
                      <select
                        className={selectClass}
                        value={form.financial_year || ""}
                        onChange={(event) => {
                          const year = options.data?.financial_years?.find(
                            (row) => row.id === Number(event.target.value),
                          );
                          setForm({
                            ...form,
                            financial_year: Number(event.target.value) || null,
                            ...(year
                              ? {
                                  start_date: year.start_date,
                                  end_date: year.end_date,
                                  lines: form.lines.map((line: any) => ({
                                    ...line,
                                    period_year: Number(
                                      year.start_date?.slice(0, 4),
                                    ),
                                  })),
                                }
                              : {}),
                          });
                        }}
                      >
                        <option value="">Use dates below</option>
                        {optionElements(options.data?.financial_years)}
                      </select>
                    </Field>
                    <Field label="Start date">
                      <Input
                        type="date"
                        required
                        value={form.start_date}
                        onChange={(event) =>
                          setForm({ ...form, start_date: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="End date">
                      <Input
                        type="date"
                        required
                        value={form.end_date}
                        onChange={(event) =>
                          setForm({ ...form, end_date: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Currency">
                      <Input
                        required
                        maxLength={10}
                        value={form.currency}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            currency: event.target.value.toUpperCase(),
                          })
                        }
                      />
                    </Field>
                  </>
                )}
              </fieldset>
              {plans && !form.lines ? (
                <p className="rounded border bg-muted/30 p-3 text-sm">
                  Save the draft to copy the annual budget allocations. Then
                  edit the items, procurement methods and planned dates before
                  submitting.
                </p>
              ) : null}
              {form.lines ? (
                <div className="space-y-3">
                  <h3 className="font-semibold">
                    {plans ? "Procurement items" : "Allocations"}
                  </h3>
                  {form.lines.map((line: any, index: number) => (
                    <fieldset
                      key={line.id ?? index}
                      disabled={!editable || save.isPending}
                      className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3"
                    >
                      {plans ? (
                        <>
                          <Field label="Budget allocation">
                            <select
                              required
                              className={selectClass}
                              value={line.budget_line}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "budget_line",
                                  Number(event.target.value),
                                )
                              }
                            >
                              {planBudget?.lines?.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.department} — {row.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Item / service">
                            <Input
                              required
                              maxLength={300}
                              value={line.description}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "description",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Category">
                            <select
                              className={selectClass}
                              value={line.category}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "category",
                                  event.target.value,
                                )
                              }
                            >
                              {["goods", "services", "works", "other"].map(
                                (value) => (
                                  <option key={value} value={value}>
                                    {label(value)}
                                  </option>
                                ),
                              )}
                            </select>
                          </Field>
                          <Field label="Quantity">
                            <Input
                              required
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={line.quantity}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "quantity",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Unit">
                            <Input
                              required
                              value={line.unit}
                              onChange={(event) =>
                                updateLine(index, "unit", event.target.value)
                              }
                            />
                          </Field>
                          <Field label="Estimated total amount">
                            <Input
                              required
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={line.estimated_amount}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "estimated_amount",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Procurement method">
                            <select
                              className={selectClass}
                              value={line.procurement_method}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "procurement_method",
                                  event.target.value,
                                )
                              }
                            >
                              {Object.entries({
                                other: "To be determined",
                                open_tender: "Open tender",
                                quotation: "Request for quotations",
                                framework: "Framework agreement",
                                direct: "Direct procurement",
                              }).map(([value, name]) => (
                                <option key={value} value={value}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Planned procurement date">
                            <Input
                              type="date"
                              value={line.planned_date || ""}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "planned_date",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                          <Field label="Account">
                            <select
                              className={selectClass}
                              required
                              value={line.account}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "account",
                                  Number(event.target.value),
                                )
                              }
                            >
                              <option value="">Select account</option>
                              {optionElements(options.data?.accounts)}
                            </select>
                          </Field>
                          <Field label="Proposed amount">
                            <Input
                              required
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={line.allocated_amount}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "allocated_amount",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Year">
                            <Input
                              required
                              type="number"
                              min="2000"
                              max="2200"
                              value={line.period_year}
                              onChange={(event) =>
                                updateLine(
                                  index,
                                  "period_year",
                                  Number(event.target.value),
                                )
                              }
                            />
                          </Field>
                        </>
                      )}
                      <Field label="Notes">
                        <Input
                          value={line.notes || ""}
                          onChange={(event) =>
                            updateLine(index, "notes", event.target.value)
                          }
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setForm({
                              ...form,
                              lines: form.lines.filter(
                                (_: unknown, i: number) => i !== index,
                              ),
                            })
                          }
                        >
                          Remove line
                        </Button>
                      </div>
                    </fieldset>
                  ))}
                  {editable ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          ...form,
                          lines: [
                            ...form.lines,
                            plans
                              ? {
                                  budget_line: planBudget?.lines?.[0]?.id || "",
                                  description: "",
                                  category: "other",
                                  quantity: "1",
                                  unit: "item",
                                  estimated_amount: "",
                                  procurement_method: "other",
                                  planned_date: null,
                                  notes: "",
                                }
                              : {
                                  account: "",
                                  allocated_amount: "",
                                  period_year: Number(
                                    form.start_date.slice(0, 4),
                                  ),
                                  notes: "",
                                },
                          ],
                        })
                      }
                    >
                      Add {plans ? "item" : "allocation"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {failure ? (
                <p role="alert" className="text-sm text-destructive">
                  {failure}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                {editable ? (
                  <Button
                    type="submit"
                    disabled={save.isPending || !options.data}
                  >
                    {save.isPending ? "Saving…" : "Save draft"}
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%_-_1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Consolidate annual budget</DialogTitle>
            <DialogDescription>
              Merge {selected.length} approved department submissions. Source
              budgets will be retained.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              merge.mutate();
            }}
          >
            <Field label="Annual budget name">
              <Input
                required
                maxLength={180}
                value={mergeName}
                onChange={(event) => setMergeName(event.target.value)}
              />
            </Field>
            <Field label="Annual budget code">
              <Input
                required
                maxLength={40}
                value={mergeCode}
                onChange={(event) => setMergeCode(event.target.value)}
              />
            </Field>
            {failure ? (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            ) : null}
            <Button disabled={merge.isPending}>Create annual budget</Button>
          </form>
        </DialogContent>
      </Dialog>
    </ERPWorkspacePage>
  )}</ERPListingScope>;
}
