import { Table } from "@/components/ui/table";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Option = { id: number; name: string; unit_type?: string };
type Unit = {
  id: number;
  name: string;
  code: string;
  unit_type: string;
  parent: number | null;
  head: number;
  head_name: string;
  deputy: number | null;
  deputy_name: string;
  members: number[];
  branches: number[];
  branch_scope: string;
  access_mode: string;
  is_active: boolean;
};
type Draft = Omit<Unit, "id" | "head_name" | "deputy_name">;
const fresh = (): Draft => ({
  name: "",
  code: "",
  unit_type: "department",
  parent: null,
  head: 0,
  deputy: null,
  members: [],
  branches: [],
  branch_scope: "all",
  access_mode: "organization",
  is_active: true,
});
export function OrganizationUnits({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1),
    [size, setSize] = useState(25),
    [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState("-id");
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Unit | null>(null),
    [form, setForm] = useState<Draft>(fresh),
    [failure, setFailure] = useState("");
  const scope = [
    token,
    user?.organization_id,
    user?.branch_id,
    user?.active_role_group_name,
  ];
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`/api/platform/organization-units/${path}`, {
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
  const options = useQuery<{
    organization: { id: number; name: string };
    permissions: Record<string, boolean>;
    branches: Option[];
    users: Option[];
    units: Option[];
    unit_types: { value: string; label: string }[];
  }>({
    queryKey: ["organization-unit-options", ...scope],
    enabled: !!token,
    queryFn: () => api("options/"),
  });
  const rows = useQuery<{ count: number; results: Unit[] }>({
    queryKey: ["organization-units", ...scope, page, size, search, ordering],
    enabled: !!token,
    queryFn: () =>
      api(
        `?${new URLSearchParams({ page: String(page), page_size: String(size), search, ordering })}`,
      ),
  });
  const mutation = useMutation({
    mutationFn: ({ row, values }: { row?: Unit; values: Partial<Draft> }) =>
      api(row ? `${row.id}/` : "", row ? "PATCH" : "POST", values),
    onSuccess: (_saved, variables) => {
      if (!variables.row) {
        setPage(1);
        setSearch("");
        setOrdering("-id");
      }
      for (const key of [
        "organization-units",
        "organization-unit-options",
        "procurement-setup",
        "procurement-configuration",
        "hr-setup",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      setOpen(false);
      setFailure("");
      toast({ title: "Department saved" });
    },
    onError: (error: Error) => {
      setFailure(error.message);
      if (!open)
        toast({
          title: "Could not save department",
          description: error.message,
          variant: "destructive",
        });
    },
  });
  const select = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    choices: { value: string; label: string }[],
  ) => (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const begin = (row?: Unit) => {
    setEditing(row || null);
    setForm(row ? { ...row } : fresh());
    setFailure("");
    setOpen(true);
  };
  const toggle = (ids: number[], id: number, enabled: boolean) =>
    enabled ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
  const save = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      row: editing || undefined,
      values: {
        ...form,
        members: [
          ...new Set([
            ...form.members,
            form.head,
            ...(form.deputy ? [form.deputy] : []),
          ]),
        ],
        branches: form.branch_scope === "selected" ? form.branches : [],
      },
    });
  };
  const permissions = options.data?.permissions || {};
  const content = (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          aria-label="Search departments"
          placeholder="Search names or codes"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="max-w-md"
        />
        <div className="w-full sm:w-48">
          {select(
            "unit-ordering",
            "Sort",
            ordering,
            (value) => {
              setOrdering(value);
              setPage(1);
            },
            [
              { value: "-id", label: "Newest first" },
              { value: "name", label: "Name A–Z" },
              { value: "code", label: "Code A–Z" },
            ],
          )}
        </div>
        <Button
          className="sm:ml-auto"
          disabled={!permissions.add}
          onClick={() => begin()}
        >
          Add department
        </Button>
      </div>
      {(rows.error || options.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(rows.error || options.error)?.message}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <Table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                {[
                  "No.",
                  "Name / code",
                  "Type / parent",
                  "Branch & access scope",
                  "Head / deputy",
                  "Members",
                  "Status",
                  "Actions",
                ].map((label) => (
                  <th key={label} className="whitespace-nowrap p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data?.results.map((row, index) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{(page - 1) * size + index + 1}</td>
                  <td className="p-3">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.code}</p>
                  </td>
                  <td className="p-3">
                    <p>
                      {
                        options.data?.unit_types.find(
                          (type) => type.value === row.unit_type,
                        )?.label
                      }
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {options.data?.units.find(
                        (unit) => unit.id === row.parent,
                      )?.name ||
                        (row.parent ? `Department ${row.parent}` : "None")}
                    </p>
                  </td>
                  <td className="p-3">
                    <p>
                      {row.branch_scope === "all"
                        ? "All branches"
                        : row.branches
                            .map(
                              (id) =>
                                options.data?.branches.find(
                                  (branch) => branch.id === id,
                                )?.name || `Branch ${id}`,
                            )
                            .join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.access_mode === "members"
                        ? "Members only"
                        : "Organization members"}
                    </p>
                  </td>
                  <td className="p-3">
                    <p>{row.head_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.deputy_name || "No deputy"}
                    </p>
                  </td>
                  <td className="p-3">{row.members.length}</td>
                  <td className="p-3">
                    {row.is_active ? "Active" : "Inactive"}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!permissions.change}
                        onClick={() => begin(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!permissions.change || mutation.isPending}
                        onClick={() =>
                          mutation.mutate({
                            row,
                            values: { is_active: !row.is_active },
                          })
                        }
                      >
                        {row.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {!rows.isLoading && !rows.data?.results.length && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No departments found.
          </p>
        )}
        <div className="px-3">
          <ListingPagination
            wrap
            page={page}
            pageSize={size}
            totalCount={rows.data?.count || 0}
            onPage={setPage}
            onPageSize={(value) => {
              setSize(value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden rounded-lg">
          <DialogHeader className="text-left">
            <DialogTitle>
              {editing ? "Edit department" : "New department"}
            </DialogTitle>
            <DialogDescription>
              Set the department’s access and members.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="flex min-h-0 flex-col gap-4">
            <div className="min-h-0 space-y-5 overflow-y-auto p-1">
              {failure && (
                <p
                  role="alert"
                  className="rounded border border-destructive/40 p-3 text-sm text-destructive"
                >
                  {failure}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="unit-name" required>
                    Name
                  </Label>
                  <Input
                    id="unit-name"
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit-code" required>
                    Code / cost center
                  </Label>
                  <Input
                    id="unit-code"
                    required
                    maxLength={40}
                    value={form.code}
                    onChange={(event) =>
                      setForm({ ...form, code: event.target.value })
                    }
                  />
                </div>
                {select(
                  "unit-type",
                  "Type",
                  form.unit_type,
                  (value) => setForm({ ...form, unit_type: value }),
                  options.data?.unit_types || [],
                )}
                {select(
                  "unit-parent",
                  "Parent department (optional)",
                  String(form.parent || "none"),
                  (value) =>
                    setForm({
                      ...form,
                      parent: value === "none" ? null : Number(value),
                    }),
                  [
                    { value: "none", label: "None" },
                    ...(options.data?.units
                      .filter((row) => row.id !== editing?.id)
                      .map((row) => ({
                        value: String(row.id),
                        label: row.name,
                      })) || []),
                  ],
                )}
                {select(
                  "unit-branch-scope",
                  "Branch availability",
                  form.branch_scope,
                  (value) => setForm({ ...form, branch_scope: value }),
                  [
                    { value: "all", label: "All organization branches" },
                    { value: "selected", label: "Selected branches only" },
                  ],
                )}
                {select(
                  "unit-access",
                  "Access",
                  form.access_mode,
                  (value) => setForm({ ...form, access_mode: value }),
                  [
                    { value: "organization", label: "Organization members" },
                    {
                      value: "members",
                      label: "Head, deputy, and members only",
                    },
                  ],
                )}
              </div>
              {form.branch_scope === "selected" && (
                <fieldset className="space-y-2 rounded border p-3">
                  <legend className="px-1 text-sm font-medium">
                    Allowed branches
                  </legend>
                  {options.data?.branches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={form.branches.includes(branch.id)}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            branches: toggle(
                              form.branches,
                              branch.id,
                              event.target.checked,
                            ),
                          })
                        }
                      />
                      {branch.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {select(
                  "unit-head",
                  "Head (required)",
                  String(form.head || "none"),
                  (value) =>
                    setForm({
                      ...form,
                      head: value === "none" ? 0 : Number(value),
                    }),
                  [
                    { value: "none", label: "Choose a head" },
                    ...(options.data?.users.map((row) => ({
                      value: String(row.id),
                      label: row.name,
                    })) || []),
                  ],
                )}
                {select(
                  "unit-deputy",
                  "Deputy (optional)",
                  String(form.deputy || "none"),
                  (value) =>
                    setForm({
                      ...form,
                      deputy: value === "none" ? null : Number(value),
                    }),
                  [
                    { value: "none", label: "No deputy" },
                    ...(options.data?.users
                      .filter((row) => row.id !== form.head)
                      .map((row) => ({
                        value: String(row.id),
                        label: row.name,
                      })) || []),
                  ],
                )}
              </div>
              <fieldset className="rounded border p-3">
                <legend className="px-1 text-sm font-medium">Members</legend>
                <div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
                  {options.data?.users.map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={
                          form.members.includes(member.id) ||
                          form.head === member.id ||
                          form.deputy === member.id
                        }
                        disabled={
                          form.head === member.id || form.deputy === member.id
                        }
                        onChange={(event) =>
                          setForm({
                            ...form,
                            members: toggle(
                              form.members,
                              member.id,
                              event.target.checked,
                            ),
                          })
                        }
                      />
                      {member.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t pt-4 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  mutation.isPending ||
                  !form.head ||
                  (form.branch_scope === "selected" && !form.branches.length)
                }
              >
                {mutation.isPending ? "Saving…" : "Save department"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
  return embedded ? (
    content
  ) : (
    <ERPWorkspacePage title="Departments">{content}</ERPWorkspacePage>
  );
}
export default OrganizationUnits;
