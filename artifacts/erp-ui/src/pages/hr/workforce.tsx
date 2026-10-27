import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Row = Record<string, any>;
type Mode = "employees" | "leave" | "requests" | "settings" | "my-payslips";
const titles: Record<Mode, string> = {
  employees: "Employees & Onboarding",
  leave: "Leave Requests",
  requests: "Employee Requests",
  settings: "HR Settings",
  "my-payslips": "My Payslips",
};
const blankEmployee = {
  employee_number: "",
  full_name: "",
  user: "",
  email: "",
  phone: "",
  job_title: "",
  department: "",
  manager: "",
  start_date: "",
  employment_type: "permanent",
  emergency_contact_name: "",
  emergency_contact_phone: "",
};

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Choice({
  label,
  value,
  onChange,
  options,
  optional = false,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  options: Array<{ id: any; name: string }>;
  optional?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <select
        className="h-10 w-full rounded-md border bg-background px-3"
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

export default function HRWorkforce({ mode = "employees" }: { mode?: Mode }) {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Row>({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [action, setAction] = useState<{ row: Row; action: string } | null>(
    null,
  );
  const [notes, setNotes] = useState("");
  const [docType, setDocType] = useState("employment_contract");
  const [expiry, setExpiry] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [settingsForm, setSettingsForm] = useState<Row>({});
  const scope = [
    token,
    (user as any)?.organization_id,
    (user as any)?.branch_id,
    (user as any)?.active_role_group_name,
  ];
  const api = async (path: string, method = "GET", data?: any) => {
    const multipart = data instanceof FormData;
    const res = await fetch(`/api/${path}`, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        ...(!multipart && data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? (multipart ? data : JSON.stringify(data)) : undefined,
    });
    if (!res.ok)
      throw await apiErrorFromResponse(
        res,
        "HR request could not be completed.",
      );
    return res.status === 204 ? null : res.json();
  };
  const people = useQuery({
    queryKey: ["hr-employees", ...scope],
    enabled: !!token,
    queryFn: () => api("hr/employees/?page_size=100"),
  });
  const options = useQuery({
    queryKey: ["hr-options", ...scope],
    enabled: !!token && mode !== "my-payslips",
    queryFn: () => api("procurement/setup/"),
  });
  const register = useQuery({
    queryKey: ["hr-register", ...scope, mode, page, pageSize, search],
    enabled: !!token,
    queryFn: () =>
      api(
        `hr/${mode}/?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}`,
      ),
  });
  const employeeId = mode === "employees" ? selected?.id : form.employee;
  const docs = useQuery({
    queryKey: ["hr-documents", ...scope, employeeId],
    enabled: !!token && !!employeeId,
    queryFn: () => api(`hr/employees/${employeeId}/documents/`),
  });
  useEffect(() => {
    if (mode === "settings" && register.data)
      setSettingsForm({
        ...register.data,
        working_days: register.data.working_days.join(", "),
        public_holidays: register.data.public_holidays.join("\n"),
        required_documents: register.data.required_documents.join("\n"),
      });
  }, [mode, register.data]);
  useEffect(() => {
    setPage(1);
    setSearch("");
    setOpen(false);
    setSelected(null);
  }, [mode]);
  const mutation = useMutation({
    mutationFn: async ({
      path,
      method = "POST",
      data,
    }: {
      path: string;
      method?: string;
      data?: any;
    }) => api(path, method, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-register"] });
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      qc.invalidateQueries({ queryKey: ["hr-documents"] });
      qc.invalidateQueries({ queryKey: ["system-notifications"] });
      setOpen(false);
      setEditing(null);
      setAction(null);
      setFile(null);
      toast({ title: "HR record saved" });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not save",
        description: e.message,
        variant: "destructive",
      }),
  });
  const access = people.data?.access ?? {};
  const rows: Row[] = register.data?.results ?? [];
  const employeeOptions = (people.data?.results ?? []).map((r: Row) => ({
    id: r.id,
    name: `${r.employee_number} · ${r.full_name}`,
  }));
  const users = options.data?.users ?? [];
  const departments = options.data?.departments ?? [];
  const openCreate = () => {
    setEditing(null);
    setForm(
      mode === "employees"
        ? { ...blankEmployee }
        : {
            employee:
              people.data?.results?.find(
                (r: Row) => r.user === (user as any)?.id,
              )?.id ?? "",
            leave_type: "annual",
            start_date: "",
            end_date: "",
            reason: "",
            supporting_document: "",
            request_type: "employment_letter",
            subject: "",
            details: "",
          },
    );
    setOpen(true);
  };
  const submit = () => {
    let payload: Row;
    if (mode === "employees")
      payload = {
        ...form,
        user: form.user ? Number(form.user) : null,
        department: form.department ? Number(form.department) : null,
        manager: form.manager ? Number(form.manager) : null,
      };
    else if (mode === "leave")
      payload = {
        employee: Number(form.employee),
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason,
        supporting_document: form.supporting_document
          ? Number(form.supporting_document)
          : null,
      };
    else
      payload = {
        employee: Number(form.employee),
        request_type: form.request_type,
        subject: form.subject,
        details: form.details,
      };
    mutation.mutate({
      path: `hr/${mode}/${editing ? `${editing.id}/` : ""}`,
      method: editing ? "PATCH" : "POST",
      data: payload,
    });
  };
  const downloadDoc = async (doc: Row) => {
    try {
      const res = await fetch(
        `/api/hr/employees/${selected?.id}/documents/${doc.id}/`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!res.ok)
        throw await apiErrorFromResponse(res, "Document download failed.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast({
        title: "Document download",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };
  const act = (row: Row, value: string) => {
    setNotes("");
    setAction({ row, action: value });
  };
  return (
    <ERPWorkspacePage
      title={titles[mode]}
      description="Organization-scoped HR records, private documents, employee requests and leave approvals."
    >
      <nav className="mb-5 flex flex-wrap gap-2">
        {(
          [
            "employees",
            "leave",
            "requests",
            "my-payslips",
            "settings",
          ] as Mode[]
        )
          .filter((m) => m !== "settings" || access.change_hrpolicy)
          .map((m) => (
            <Link key={m} href={`/hr/${m}`}>
              <Button variant={m === mode ? "default" : "outline"} size="sm">
                {titles[m]}
              </Button>
            </Link>
          ))}
        {access.view_payperiod ? (
          <Link href="/hr/staff">
            <Button variant="outline" size="sm">
              Staff & Payroll
            </Button>
          </Link>
        ) : null}
      </nav>
      {register.isLoading ? <p>Loading HR records…</p> : null}
      {register.error ? (
        <p role="alert" className="text-destructive">
          {register.error.message}
        </p>
      ) : null}
      {mode === "settings" ? (
        <Card>
          <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
            <p className="text-sm text-muted-foreground md:col-span-2">
              Kenyan statutory baseline: annual 21 working days; sick leave 7
              full-pay and 7 half-pay days after two months of service;
              maternity three calendar months, paternity two weeks and
              pre-adoptive leave one calendar month. Enhanced annual and sick
              leave terms can be set here. Sectoral wage orders, contracts and
              collective agreements can grant higher entitlements. Leave
              balances use the calendar year; submitted requests reserve days.
              Fixed national holidays and Sunday substitutions are excluded from
              working-day leave. Add movable and newly gazetted holidays below.
            </p>
            {[
              "annual_leave_days",
              "sick_full_pay_days",
              "sick_half_pay_days",
              "carry_forward_limit",
            ].map((key) => (
              <Field
                key={key}
                label={key.replaceAll("_", " ")}
                type="number"
                value={settingsForm[key]}
                onChange={(v) => setSettingsForm({ ...settingsForm, [key]: v })}
              />
            ))}
            <Field
              label="Working weekdays (Monday 0 … Sunday 6)"
              value={settingsForm.working_days}
              onChange={(v) =>
                setSettingsForm({ ...settingsForm, working_days: v })
              }
            />
            <Choice
              label="Leave approval group (optional)"
              optional
              value={settingsForm.leave_approver_group}
              options={options.data?.approval_groups ?? []}
              onChange={(v) =>
                setSettingsForm({ ...settingsForm, leave_approver_group: v })
              }
            />
            {["public_holidays", "required_documents"].map((key) => (
              <label className="grid gap-2 text-sm" key={key}>
                <Label>
                  {key === "public_holidays"
                    ? "Additional public holidays (YYYY-MM-DD, one per line)"
                    : "Required onboarding document types (one per line)"}
                </Label>
                <Textarea
                  rows={7}
                  value={settingsForm[key] ?? ""}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <p className="text-sm text-muted-foreground md:col-span-2">
              Annual balances grant the configured entitlement for each calendar
              year. Carry-forward uses the previous year's unused entitlement up
              to the limit above. HR can record opening balance adjustments in
              Leave Requests. Employees submit for review; approval requires the
              HR approval permission and, when set, the configured group.
            </p>
            <Button
              disabled={mutation.isPending || !access.change_hrpolicy}
              onClick={() => {
                const { updated_at, ...values } = settingsForm;
                mutation.mutate({
                  path: "hr/settings/",
                  method: "PATCH",
                  data: {
                    ...values,
                    annual_leave_days: Number(values.annual_leave_days),
                    sick_full_pay_days: Number(values.sick_full_pay_days),
                    sick_half_pay_days: Number(values.sick_half_pay_days),
                    carry_forward_limit: Number(values.carry_forward_limit),
                    working_days: String(values.working_days)
                      .split(",")
                      .map((s) => Number(s.trim())),
                    public_holidays: String(values.public_holidays)
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    required_documents: String(values.required_documents)
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    leave_approver_group: values.leave_approver_group
                      ? Number(values.leave_approver_group)
                      : null,
                  },
                });
              }}
            >
              Save HR settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {mode === "leave" && register.data?.balances ? (
            <div className="mb-5 flex flex-wrap gap-3">
              {Object.entries(register.data.balances).map(([k, v]) => (
                <Badge variant="secondary" key={k}>
                  {k.replaceAll("_", " ")}: {String(v)} days available
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Input
              aria-label="Search HR records"
              className="sm:max-w-md"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search records…"
            />
            {mode !== "my-payslips" ? (
              <div className="flex gap-2">
                <Button
                  disabled={
                    mode === "employees"
                      ? !access.add_employee
                      : mode === "leave"
                        ? !(access.request_own_leave || access.add_leaverequest)
                        : !access.add_employeeservicerequest
                  }
                  onClick={openCreate}
                >
                  {mode === "employees"
                    ? "Onboard employee"
                    : mode === "leave"
                      ? "Request leave"
                      : "New HR request"}
                </Button>
                {mode === "leave" && access.change_leaveallocation ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setNotes("");
                      setForm({
                        employee: "",
                        year: String(new Date().getFullYear()),
                        leave_type: "annual",
                        additional_days: "0",
                      });
                      setAction({ row: {}, action: "allocation" });
                    }}
                  >
                    Adjust balance
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  {(mode === "employees"
                    ? [
                        "Employee",
                        "Department / Job",
                        "Status",
                        "Onboarding",
                        "Actions",
                      ]
                    : mode === "leave"
                      ? [
                          "Employee",
                          "Type / Period",
                          "Days",
                          "Status",
                          "Actions",
                        ]
                      : mode === "requests"
                        ? [
                            "Employee",
                            "Request",
                            "Details",
                            "Status",
                            "Actions",
                          ]
                        : [
                            "Period",
                            "Basic pay",
                            "Allowances",
                            "Deductions",
                            "Net pay",
                          ]
                  ).map((x) => (
                    <th key={x} className="p-3">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    {mode === "employees" ? (
                      <>
                        <td className="p-3">
                          <strong>{row.full_name}</strong>
                          <div className="text-muted-foreground">
                            {row.employee_number}
                          </div>
                        </td>
                        <td className="p-3">
                          {row.department_name || "—"}
                          <div>{row.job_title}</div>
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary">{row.status}</Badge>
                        </td>
                        <td className="p-3">
                          {row.missing_documents?.length
                            ? `${row.missing_documents.length} documents needed`
                            : "Documents verified"}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelected(row)}
                            >
                              Documents
                            </Button>
                            {access.change_employee ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditing(row);
                                  setForm({
                                    ...row,
                                    user: row.user ?? "",
                                    manager: row.manager ?? "",
                                    department: row.department ?? "",
                                  });
                                  setOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                            ) : null}
                            {row.status === "onboarding" &&
                            access.manage_onboarding ? (
                              <Button
                                size="sm"
                                disabled={mutation.isPending}
                                onClick={() =>
                                  mutation.mutate({
                                    path: `hr/employees/${row.id}/`,
                                    data: {},
                                  })
                                }
                              >
                                Complete onboarding
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </>
                    ) : mode === "leave" ? (
                      <>
                        <td className="p-3">{row.employee_name}</td>
                        <td className="p-3">
                          {row.leave_type.replaceAll("_", " ")}
                          <div>
                            {row.start_date} — {row.end_date}
                          </div>
                          <div className="max-w-sm text-muted-foreground">
                            {row.reason}
                          </div>
                          {row.decision_notes ? (
                            <div>Decision: {row.decision_notes}</div>
                          ) : null}
                        </td>
                        <td className="p-3">{row.days}</td>
                        <td className="p-3">
                          <Badge variant="secondary">{row.status}</Badge>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            {row.status === "draft" ? (
                              <Button
                                size="sm"
                                disabled={mutation.isPending}
                                onClick={() => act(row, "submit")}
                              >
                                Submit
                              </Button>
                            ) : null}
                            {["draft", "submitted"].includes(row.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => act(row, "cancel")}
                              >
                                Cancel
                              </Button>
                            ) : null}
                            {row.status === "submitted" &&
                            register.data?.can_approve ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => act(row, "approve")}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => act(row, "reject")}
                                >
                                  Reject
                                </Button>
                              </>
                            ) : null}
                            {row.status === "approved" &&
                            register.data?.can_approve ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => act(row, "revoke")}
                              >
                                Revoke
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </>
                    ) : mode === "requests" ? (
                      <>
                        <td className="p-3">{row.employee_name}</td>
                        <td className="p-3">
                          {row.subject}
                          <div className="text-muted-foreground">
                            {row.request_type}
                          </div>
                        </td>
                        <td className="max-w-sm p-3">
                          {row.details}
                          {row.response ? (
                            <p className="mt-2">HR: {row.response}</p>
                          ) : null}
                        </td>
                        <td className="p-3">{row.status}</td>
                        <td className="p-3">
                          {access.change_employeeservicerequest ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => act(row, "resolve")}
                            >
                              Respond
                            </Button>
                          ) : null}
                        </td>
                      </>
                    ) : (
                      <>
                        {[
                          "period_name",
                          "basic_pay",
                          "allowances",
                          "deductions",
                          "net_pay",
                        ].map((key) => (
                          <td key={key} className="p-3">
                            {key === "period_name"
                              ? row[key]
                              : `KES ${Number(row[key]).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`}
                          </td>
                        ))}
                      </>
                    )}
                  </tr>
                ))}
                {!rows.length && !register.isLoading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-8 text-center text-muted-foreground"
                    >
                      No records found in your permitted workspace.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {mode !== "my-payslips" ? (
            <ListingPagination
              page={page}
              pageSize={pageSize}
              totalCount={register.data?.count ?? 0}
              onPage={setPage}
              onPageSize={(v) => {
                setPageSize(v);
                setPage(1);
              }}
            />
          ) : null}
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit employee"
                : mode === "employees"
                  ? "Employee onboarding"
                  : mode === "leave"
                    ? "Draft leave request"
                    : "Employee service request"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            {mode === "employees" ? (
              <>
                {[
                  "employee_number",
                  "full_name",
                  "email",
                  "phone",
                  "job_title",
                  "start_date",
                  "emergency_contact_name",
                  "emergency_contact_phone",
                ].map((key) => (
                  <Field
                    key={key}
                    label={key.replaceAll("_", " ")}
                    value={form[key]}
                    type={
                      key === "start_date"
                        ? "date"
                        : key === "email"
                          ? "email"
                          : "text"
                    }
                    onChange={(v) => setForm({ ...form, [key]: v })}
                  />
                ))}
                <Choice
                  label="ERP user (for self service)"
                  optional
                  value={form.user}
                  options={users}
                  onChange={(v) => setForm({ ...form, user: v })}
                />
                <Choice
                  label="Department"
                  optional
                  value={form.department}
                  options={departments}
                  onChange={(v) => setForm({ ...form, department: v })}
                />
                <Choice
                  label="Line manager"
                  optional
                  value={form.manager}
                  options={users}
                  onChange={(v) => setForm({ ...form, manager: v })}
                />
                <Choice
                  label="Employment type"
                  value={form.employment_type}
                  options={["permanent", "fixed_term", "casual", "intern"].map(
                    (v) => ({ id: v, name: v.replaceAll("_", " ") }),
                  )}
                  onChange={(v) => setForm({ ...form, employment_type: v })}
                />
                {editing ? (
                  <Choice
                    label="Employment status"
                    value={form.status}
                    options={["onboarding", "active", "on_leave", "exited"].map(
                      (v) => ({ id: v, name: v.replaceAll("_", " ") }),
                    )}
                    onChange={(v) => setForm({ ...form, status: v })}
                  />
                ) : null}
              </>
            ) : (
              <>
                <Choice
                  label="Employee"
                  value={form.employee}
                  options={employeeOptions}
                  onChange={(v) =>
                    setForm({ ...form, employee: v, supporting_document: "" })
                  }
                />
                {mode === "leave" ? (
                  <>
                    <Choice
                      label="Leave type"
                      value={form.leave_type}
                      options={(register.data?.leave_types ?? []).map(
                        ([id, name]: string[]) => ({ id, name }),
                      )}
                      onChange={(v) => setForm({ ...form, leave_type: v })}
                    />
                    <Field
                      label="Start date"
                      type="date"
                      value={form.start_date}
                      onChange={(v) => setForm({ ...form, start_date: v })}
                    />
                    <Field
                      label="End date"
                      type="date"
                      value={form.end_date}
                      onChange={(v) => setForm({ ...form, end_date: v })}
                    />
                    <label className="grid gap-2 sm:col-span-2">
                      <Label>Reason / handover plan</Label>
                      <Textarea
                        value={form.reason}
                        onChange={(e) =>
                          setForm({ ...form, reason: e.target.value })
                        }
                      />
                    </label>
                    <Choice
                      label="Supporting document (required for sick leave)"
                      optional
                      value={form.supporting_document}
                      options={(docs.data?.results ?? []).map((d: Row) => ({
                        id: d.id,
                        name: d.name,
                      }))}
                      onChange={(v) =>
                        setForm({ ...form, supporting_document: v })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Attach evidence through your employee Documents screen
                      first. Save the draft, then submit it for approval.
                    </p>
                  </>
                ) : (
                  <>
                    <Choice
                      label="Request type"
                      value={form.request_type}
                      options={[
                        "employment_letter",
                        "payslip",
                        "profile_update",
                        "training",
                        "other",
                      ].map((v) => ({ id: v, name: v.replaceAll("_", " ") }))}
                      onChange={(v) => setForm({ ...form, request_type: v })}
                    />
                    <Field
                      label="Subject"
                      value={form.subject}
                      onChange={(v) => setForm({ ...form, subject: v })}
                    />
                    <label className="grid gap-2 sm:col-span-2">
                      <Label>Details</Label>
                      <Textarea
                        value={form.details}
                        onChange={(e) =>
                          setForm({ ...form, details: e.target.value })
                        }
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={mutation.isPending}>
                Save {mode === "leave" ? "draft" : "record"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.full_name} — Private documents</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Documents are available only through authenticated employee access.
            HR must verify all required onboarding documents before activation.
          </p>
          {docs.error ? (
            <p className="text-destructive">{docs.error.message}</p>
          ) : null}
          {(docs.data?.results ?? []).map((d: Row) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
            >
              <div>
                <strong>{d.name}</strong>
                <p className="text-xs text-muted-foreground">
                  {d.document_type} ·{" "}
                  {d.verified_by ? "Verified" : "Awaiting verification"}
                  {d.expires_on ? ` · Expires ${d.expires_on}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadDoc(d)}
                >
                  Download
                </Button>
                {access.change_employeedocument && !d.verified_by ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      mutation.mutate({
                        path: `hr/employees/${selected?.id}/documents/${d.id}/`,
                        method: "PATCH",
                        data: {},
                      })
                    }
                  >
                    Verify
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <div className="grid gap-3 rounded border p-4">
            <Field
              label="Document type"
              value={docType}
              onChange={setDocType}
            />
            <Field
              label="Expires on (optional)"
              type="date"
              value={expiry}
              onChange={setExpiry}
            />
            <Input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              disabled={
                !access.add_employeedocument || !file || mutation.isPending
              }
              onClick={() => {
                if (!file) return;
                const data = new FormData();
                data.set("file", file);
                data.set("document_type", docType);
                if (expiry) data.set("expires_on", expiry);
                mutation.mutate({
                  path: `hr/employees/${selected?.id}/documents/`,
                  data,
                });
              }}
            >
              Attach document
            </Button>
          </div>
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
              {action?.action === "allocation"
                ? "Record leave balance adjustment"
                : `${action?.action ?? ""} request`}
            </DialogTitle>
          </DialogHeader>
          {action?.action === "allocation" ? (
            <>
              <Choice
                label="Employee"
                value={form.employee}
                options={employeeOptions}
                onChange={(v) => setForm({ ...form, employee: v })}
              />
              <Field
                label="Year"
                type="number"
                value={form.year}
                onChange={(v) => setForm({ ...form, year: v })}
              />
              <Choice
                label="Leave balance"
                value={form.leave_type}
                options={["annual", "sick_full", "sick_half"].map((v) => ({
                  id: v,
                  name: v,
                }))}
                onChange={(v) => setForm({ ...form, leave_type: v })}
              />
              <Field
                label="Additional days (negative to reduce)"
                type="number"
                value={form.additional_days}
                onChange={(v) => setForm({ ...form, additional_days: v })}
              />
            </>
          ) : null}
          <Textarea
            aria-label="Decision notes"
            placeholder="Decision notes / response"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              if (!action) return;
              mutation.mutate(
                action.action === "allocation"
                  ? {
                      path: "hr/leave/allocations/",
                      data: {
                        ...form,
                        employee: Number(form.employee),
                        year: Number(form.year),
                        additional_days: Number(form.additional_days),
                        notes,
                      },
                    }
                  : mode === "requests"
                    ? {
                        path: `hr/requests/${action.row.id}/`,
                        method: "PATCH",
                        data: { status: "resolved", response: notes },
                      }
                    : {
                        path: `hr/leave/${action.row.id}/action/`,
                        data: { action: action.action, notes },
                      },
              );
            }}
          >
            Confirm
          </Button>
        </DialogContent>
      </Dialog>
    </ERPWorkspacePage>
  );
}
