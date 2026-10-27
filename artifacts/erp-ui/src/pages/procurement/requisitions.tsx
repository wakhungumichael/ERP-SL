import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Row = Record<string, any>;
const money = (n: any, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency }).format(
    Number(n ?? 0),
  );
const blankLine = () => ({
  description: "",
  item_type: "goods",
  quantity: "1",
  unit_price: "0",
  unit: "pcs",
});
const initial = () => ({
  title: "",
  description: "",
  request_kind: "individual",
  department: "",
  budget_line: "",
  sales_order: "",
  needed_by: "",
  vendor_option: "",
  cost_center: "",
  project_code: "",
  currency: "KES",
  lines: [blankLine()],
});
function Choice({
  label,
  value,
  onChange,
  options,
  optional,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  options: { id: any; name: string }[];
  optional?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span>{label}</span>
      <select
        className="h-10 rounded-md border bg-background px-3"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{optional ? "None" : "Choose…"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ProcurementRequisitions() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>(initial());
  const [detail, setDetail] = useState<Row | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [action, setAction] = useState<{ row?: Row; type: string } | null>(
    null,
  );
  const [notes, setNotes] = useState("");
  const [supplier, setSupplier] = useState("");
  const scope = [
    token,
    (user as any)?.organization_id,
    (user as any)?.branch_id,
    (user as any)?.active_role_group_name,
  ];
  const api = async (path: string, method = "GET", payload?: any) => {
    const response = await fetch(`/api/procurement/${path}`, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!response.ok)
      throw await apiErrorFromResponse(
        response,
        "The requisition action could not be completed.",
      );
    return response.status === 204 ? null : response.json();
  };
  const setup = useQuery({
    queryKey: ["procurement-setup", ...scope],
    enabled: !!token,
    queryFn: () => api("setup/"),
  });
  const query = useQuery({
    queryKey: [
      "procurement-requisitions",
      ...scope,
      page,
      pageSize,
      search,
      status,
    ],
    enabled: !!token,
    queryFn: () =>
      api(
        `requisitions/?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}&status=${status}`,
      ),
  });
  const mutation = useMutation({
    mutationFn: ({
      path,
      method = "POST",
      data,
    }: {
      path: string;
      method?: string;
      data: any;
    }) => api(path, method, data),
    onSuccess: (result, variables) => {
      qc.invalidateQueries({ queryKey: ["procurement-requisitions"] });
      qc.invalidateQueries({ queryKey: ["procurement-setup"] });
      qc.invalidateQueries({ queryKey: ["workflow-inbox"] });
      setOpen(false);
      setAction(null);
      if (variables.path === "requisitions/consolidate/") setSelected([]);
      if (result?.request_number) setDetail(result);
      else setDetail(null);
      toast({ title: "Requisition saved" });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not save requisition",
        description: e.message,
        variant: "destructive",
      }),
  });
  const rows: Row[] = query.data?.results ?? [];
  const options = setup.data ?? {};
  const access = query.data?.access ?? {};
  const currentUser = options.current_user;
  const departments: Row[] = options.departments ?? [];
  const budgets: Row[] = options.budget_lines ?? [];
  const department = departments.find(
    (d) => String(d.id) === String(form.department),
  );
  const budget = budgets.find((b) => String(b.id) === String(form.budget_line));
  const chooseBudget = (v: string) => {
    const b = budgets.find((row) => String(row.id) === v);
    setForm({
      ...form,
      budget_line: v,
      ...(b
        ? {
            cost_center: b.cost_center,
            project_code: b.project_code,
            currency: b.currency,
          }
        : {}),
    });
  };
  const startEdit = (row?: Row) => {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            ...row,
            department: row.department ?? "",
            budget_line: row.budget_line ?? "",
            sales_order: row.sales_order ?? "",
            needed_by: row.needed_by ?? "",
            lines: row.lines?.length ? row.lines : [blankLine()],
          }
        : initial(),
    );
    setOpen(true);
  };
  const runAction = (row: Row, type: string) => {
    setNotes("");
    setSupplier(row.vendor_option ?? "");
    setAction({ row, type });
  };
  const headFor = (row: Row) => {
    const department = departments.find((d) => d.id === row.department);
    return (
      !!department &&
      currentUser != null &&
      (department.head === currentUser || department.deputy === currentUser)
    );
  };
  const actions = (row: Row) => (
    <div className="flex flex-wrap gap-2">
      {row.status === "draft" && access.change ? (
        <>
          <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button size="sm" onClick={() => runAction(row, "submit")}>
            Submit
          </Button>
        </>
      ) : null}
      {row.request_kind === "individual" &&
      row.department_status === "pending" &&
      headFor(row) ? (
        <>
          <Button
            size="sm"
            onClick={() => runAction(row, "department-approve")}
          >
            Department: approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAction(row, "department-reject")}
          >
            Department: reject
          </Button>
        </>
      ) : null}
      {row.status === "pending_approval" && access.approve ? (
        <>
          <Button size="sm" onClick={() => runAction(row, "approve")}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAction(row, "reject")}
          >
            Reject
          </Button>
        </>
      ) : null}
      {row.status === "approved" && access.create_order ? (
        <Button size="sm" onClick={() => runAction(row, "order")}>
          Create purchase order
        </Button>
      ) : null}
      {["draft", "submitted", "pending_approval", "approved"].includes(
        row.status,
      ) &&
      !row.parent_requisition &&
      access.change ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => runAction(row, "cancel")}
        >
          Cancel
        </Button>
      ) : null}
      {["cancelled", "rejected"].includes(row.status) &&
      !row.parent_requisition &&
      access.change ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => runAction(row, "redraft")}
        >
          Return to draft
        </Button>
      ) : null}
    </div>
  );
  const perform = () => {
    if (!action) return;
    const type = action.type,
      row = action.row;
    if (type === "consolidate")
      mutation.mutate({
        path: "requisitions/consolidate/",
        data: {
          requests: selected,
          ...(notes.trim() ? { title: notes.trim() } : {}),
        },
      });
    else if (type.startsWith("department-"))
      mutation.mutate({
        path: `requisitions/${row?.id}/department-review/`,
        data: {
          decision: type.endsWith("approve") ? "approve" : "reject",
          notes,
        },
      });
    else if (["approve", "reject"].includes(type))
      mutation.mutate({
        path: `requisitions/${row?.id}/approval-action/`,
        data: { decision: type, notes },
      });
    else if (type === "order")
      mutation.mutate({
        path: `requisitions/${row?.id}/convert-to-order/`,
        data: { supplier_name: supplier },
      });
    else
      mutation.mutate({
        path: `requisitions/${row?.id}/status/`,
        method: "PATCH",
        data: {
          status: {
            submit: "submitted",
            cancel: "cancelled",
            redraft: "draft",
          }[type],
        },
      });
  };
  return (
    <ERPWorkspacePage
      title="Requisitions"
      description="Individual request → department head review → departmental consolidation → configured higher approvals → purchase order → receipt → supplier bill → payment."
    >
      <div className="mb-5 flex flex-wrap gap-2">
        <Button disabled={!access.add} onClick={() => startEdit()}>
          New requisition
        </Button>
        <Link href="/procurement/departments">
          <Button variant="outline">Departments & Heads</Button>
        </Link>
        <Link href="/procurement/approval-rules">
          <Button variant="outline">Approval Rules</Button>
        </Link>
        <Link href="/finance/budgets">
          <Button variant="outline">Budgets</Button>
        </Link>
        <Link href="/procurement/purchase-orders">
          <Button variant="outline">Purchase Orders</Button>
        </Link>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          className="sm:max-w-md"
          placeholder="Search reference, title or department…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Requisition status"
          className="h-10 rounded-md border bg-background px-3"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {[
            "draft",
            "submitted",
            "pending_approval",
            "approved",
            "rejected",
            "cancelled",
            "consolidated",
            "po_created",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        {selected.length ? (
          <Button
            onClick={() => {
              setNotes("");
              setAction({ type: "consolidate" });
            }}
          >
            Consolidate {selected.length} approved requests
          </Button>
        ) : null}
      </div>
      {query.isLoading ? <p>Loading requisitions…</p> : null}
      {query.error ? (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {[
                "Select",
                "Reference / Title",
                "Department / Type",
                "Status",
                "Budget",
                "Total",
                "Actions",
              ].map((t) => (
                <th key={t} className="p-3">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  {row.department_status === "approved" &&
                  row.request_kind === "individual" &&
                  !row.parent_requisition &&
                  headFor(row) ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.request_number}`}
                      checked={selected.includes(row.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, row.id]
                            : selected.filter((id) => id !== row.id),
                        )
                      }
                    />
                  ) : null}
                </td>
                <td className="p-3">
                  <button
                    className="text-left text-primary hover:underline"
                    onClick={() => setDetail(row)}
                  >
                    {row.request_number}
                  </button>
                  <div>{row.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.requested_by_name}
                  </div>
                </td>
                <td className="p-3">
                  {departments.find((d) => d.id === row.department)?.name ??
                    row.cost_center}
                  <div className="text-xs">{row.request_kind}</div>
                </td>
                <td className="p-3">
                  <Badge variant="secondary">
                    {row.status.replaceAll("_", " ")}
                  </Badge>
                  {row.request_kind === "individual" ? (
                    <div className="mt-1 text-xs">
                      Department: {row.department_status}
                    </div>
                  ) : null}
                </td>
                <td className="max-w-xs p-3">
                  <Badge variant="outline">{row.budget_status}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.budget_message}
                  </p>
                </td>
                <td className="whitespace-nowrap p-3">
                  {money(row.estimated_total, row.currency)}
                </td>
                <td className="min-w-[180px] p-3">{actions(row)}</td>
              </tr>
            ))}
            {!rows.length && !query.isLoading ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-8 text-center text-muted-foreground"
                >
                  No requisitions found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ListingPagination
        page={page}
        pageSize={pageSize}
        totalCount={query.data?.count ?? 0}
        onPage={setPage}
        onPageSize={(v) => {
          setPageSize(v);
          setPage(1);
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit draft requisition" : "New draft requisition"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                path: `requisitions/${editing ? `${editing.id}/` : ""}`,
                method: editing ? "PATCH" : "POST",
                data: {
                  title: form.title,
                  description: form.description,
                  request_kind: form.request_kind,
                  department: form.department ? Number(form.department) : null,
                  budget_line: form.budget_line
                    ? Number(form.budget_line)
                    : null,
                  sales_order: form.sales_order
                    ? Number(form.sales_order)
                    : null,
                  needed_by: form.needed_by || null,
                  vendor_option: form.vendor_option,
                  cost_center: budget?.cost_center ?? form.cost_center,
                  project_code: budget?.project_code ?? form.project_code,
                  currency: budget?.currency ?? form.currency,
                  status: "draft",
                  lines: form.lines.map((l: Row) => ({
                    description: l.description,
                    item_type: l.item_type,
                    quantity: Number(l.quantity),
                    unit_price: Number(l.unit_price),
                    unit: l.unit,
                  })),
                },
              });
            }}
          >
            <label className="grid gap-2 text-sm sm:col-span-2">
              Title
              <Input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <Choice
              label="Request type"
              value={form.request_kind}
              options={[
                {
                  id: "individual",
                  name: "Individual — department head first",
                },
                ...(access.view_all ||
                (department &&
                  currentUser != null &&
                  (department.head === currentUser ||
                    department.deputy === currentUser))
                  ? [
                      {
                        id: "standard",
                        name: "Standard — configured higher approvals",
                      },
                    ]
                  : []),
              ]}
              onChange={(v) => setForm({ ...form, request_kind: v })}
            />
            <Choice
              label="Department"
              optional={form.request_kind !== "individual"}
              value={form.department}
              options={departments.map((d) => ({ id: d.id, name: d.name }))}
              onChange={(v) =>
                setForm({ ...form, department: v, budget_line: "" })
              }
            />
            <Choice
              label="Budget line"
              value={form.budget_line}
              options={budgets
                .filter(
                  (b) =>
                    !department ||
                    [department.code, department.name].includes(b.cost_center),
                )
                .map((b) => ({
                  id: b.id,
                  name: `${b.name} · ${money(b.available, b.currency)} available`,
                }))}
              onChange={chooseBudget}
            />
            <Choice
              label="Related customer sales order"
              optional
              value={form.sales_order}
              options={(options.sales_orders ?? []).map((o: Row) => ({
                id: o.id,
                name: o.number,
              }))}
              onChange={(v) => setForm({ ...form, sales_order: v })}
            />
            <label className="grid gap-2 text-sm">
              Needed by
              <Input
                type="date"
                value={form.needed_by}
                onChange={(e) =>
                  setForm({ ...form, needed_by: e.target.value })
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              Preferred supplier
              <Input
                value={form.vendor_option}
                onChange={(e) =>
                  setForm({ ...form, vendor_option: e.target.value })
                }
              />
            </label>
            <label className="grid gap-2 text-sm sm:col-span-2">
              Justification
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <div className="space-y-3 sm:col-span-2">
              {form.lines.map((line: Row, index: number) => (
                <div
                  key={index}
                  className="grid gap-2 rounded border p-3 sm:grid-cols-6"
                >
                  <label className="text-xs sm:col-span-2">
                    Description
                    <Input
                      required
                      value={line.description}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          lines: form.lines.map((l: Row, i: number) =>
                            i === index
                              ? { ...l, description: e.target.value }
                              : l,
                          ),
                        })
                      }
                    />
                  </label>
                  {["quantity", "unit_price", "unit"].map((key) => (
                    <label key={key} className="text-xs">
                      {key.replaceAll("_", " ")}
                      <Input
                        required
                        type={key === "unit" ? "text" : "number"}
                        step="0.001"
                        min={key === "quantity" ? "0.001" : "0"}
                        value={line[key]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            lines: form.lines.map((l: Row, i: number) =>
                              i === index ? { ...l, [key]: e.target.value } : l,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="self-end"
                    disabled={form.lines.length === 1}
                    onClick={() =>
                      setForm({
                        ...form,
                        lines: form.lines.filter(
                          (_: Row, i: number) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm({ ...form, lines: [...form.lines, blankLine()] })
                }
              >
                Add line
              </Button>
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Save a draft, then submit it. Individual requests await the named
              department head. Consolidation combines requests sharing a
              department, budget and sales order. Budget is reserved when the
              departmental request enters higher approval.
            </p>
            <Button
              className="sm:col-span-2"
              disabled={
                mutation.isPending ||
                !form.budget_line ||
                (form.request_kind === "individual" && !form.department)
              }
            >
              Save draft
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.type.replaceAll("-", " ")} requisition
            </DialogTitle>
          </DialogHeader>
          <p>
            {action?.row?.request_number ??
              `${selected.length} selected requests`}
          </p>
          {action?.type === "order" ? (
            <label className="grid gap-2">
              Supplier name
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </label>
          ) : (
            <Textarea
              aria-label="Decision notes"
              placeholder={
                action?.type === "consolidate"
                  ? "Departmental request title (optional)"
                  : "Decision notes (optional)"
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
          <Button
            disabled={
              mutation.isPending ||
              (action?.type === "order" && !supplier.trim())
            }
            onClick={perform}
          >
            Confirm
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.request_number}</DialogTitle>
          </DialogHeader>
          {detail ? (
            <>
              <h3 className="font-semibold">{detail.title}</h3>
              <p>{detail.description}</p>
              <p>Budget: {detail.budget_message}</p>
              {detail.sales_order ? (
                <Link
                  href="/sales/orders"
                  className="text-primary hover:underline"
                >
                  Sales order{" "}
                  {options.sales_orders?.find(
                    (o: Row) => o.id === detail.sales_order,
                  )?.number ?? `#${detail.sales_order}`}
                </Link>
              ) : null}
              {detail.parent_requisition ? (
                <p>
                  Consolidated into departmental request #
                  {detail.parent_requisition}
                </p>
              ) : null}
              <div className="rounded border p-3">
                {detail.lines?.map((l: Row) => (
                  <div
                    key={l.id}
                    className="flex justify-between gap-3 border-b py-2"
                  >
                    <span>
                      {l.description} · {l.quantity} {l.unit}
                    </span>
                    <span>{money(l.line_total, detail.currency)}</span>
                  </div>
                ))}
                <strong className="mt-3 block">
                  Total: {money(detail.estimated_total, detail.currency)}
                </strong>
              </div>
              <h4 className="font-semibold">Approval history</h4>
              {detail.department_decided_at ? (
                <p>
                  Department head: {detail.department_status} ·{" "}
                  {detail.department_decision_notes}
                </p>
              ) : null}
              {detail.approvals?.map((a: Row) => (
                <div key={a.id} className="rounded border p-3">
                  <strong>
                    Step {a.step_order}: {a.group_name}
                  </strong>
                  <p>
                    {a.status} {a.acted_by_name ? `· ${a.acted_by_name}` : ""}
                  </p>
                  <p>{a.decision_notes}</p>
                </div>
              ))}
              {actions(detail)}
              {detail.status === "po_created" ? (
                <Link
                  href="/procurement/purchase-orders"
                  className="text-primary"
                >
                  Continue to purchase order, receipt and supplier billing
                </Link>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </ERPWorkspacePage>
  );
}
