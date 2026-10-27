import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Row = Record<string, any>;
export default function Departments() {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Row>({
    name: "",
    code: "",
    head: "",
    deputy: "",
    members: [],
    is_active: true,
  });
  const api = async (path: string, method = "GET", data?: any) => {
    const r = await fetch(`/api/procurement/${path}`, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!r.ok)
      throw await apiErrorFromResponse(r, "Department request failed.");
    return r.status === 204 ? null : r.json();
  };
  const scope = [
    token,
    (user as any)?.organization_id,
    (user as any)?.active_role_group_name,
  ];
  const setup = useQuery({
    queryKey: ["procurement-setup", ...scope],
    enabled: !!token,
    queryFn: () => api("setup/"),
  });
  const register = useQuery({
    queryKey: ["procurement-departments", ...scope],
    enabled: !!token,
    queryFn: () => api("departments/"),
  });
  const mutation = useMutation({
    mutationFn: ({ row, data }: { row?: Row; data: Row }) =>
      api(
        `departments/${row ? `${row.id}/` : ""}`,
        row ? "PATCH" : "POST",
        data,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["procurement-departments"] });
      qc.invalidateQueries({ queryKey: ["procurement-setup"] });
      setOpen(false);
      toast({ title: "Department saved" });
    },
    onError: (e: Error) =>
      toast({
        title: "Department",
        description: e.message,
        variant: "destructive",
      }),
  });
  const users: Row[] = setup.data?.users ?? [];
  const canManage = setup.data?.can_manage_departments;
  return (
    <ERPWorkspacePage
      title="Departments & Heads"
      description="Assign a named head and department members. Match the department code to its budget cost center."
    >
      <div className="mb-5 flex gap-3">
        <Link href="/procurement/requisitions">
          <Button variant="outline">Requisitions</Button>
        </Link>
        <Button
          disabled={!canManage}
          onClick={() => {
            setEditing(null);
            setForm({
              name: "",
              code: "",
              head: "",
              deputy: "",
              members: [],
              is_active: true,
            });
            setOpen(true);
          }}
        >
          New department
        </Button>
      </div>
      {register.error ? (
        <p className="text-destructive">{register.error.message}</p>
      ) : null}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {[
                "Department",
                "Budget cost center code",
                "Head",
                "Deputy",
                "Members",
                "Status",
                "Actions",
              ].map((h) => (
                <th className="p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(register.data?.results ?? []).map((row: Row) => (
              <tr className="border-t" key={row.id}>
                <td className="p-3">{row.name}</td>
                <td className="p-3">{row.code}</td>
                <td className="p-3">{row.head_name}</td>
                <td className="p-3">{row.deputy_name || "—"}</td>
                <td className="p-3">{row.members.length}</td>
                <td className="p-3">{row.is_active ? "Active" : "Inactive"}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => {
                        setEditing(row);
                        setForm(row);
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          row,
                          data: { is_active: !row.is_active },
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
        </table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit department" : "New department"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                row: editing ?? undefined,
                data: {
                  name: form.name,
                  code: form.code,
                  head: Number(form.head),
                  deputy: form.deputy ? Number(form.deputy) : null,
                  members: form.members,
                  is_active: form.is_active,
                },
              });
            }}
          >
            <label className="grid gap-2">
              Name
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="grid gap-2">
              Code / budget cost center
              <Input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              Link users to this department. Select one head and an optional
              deputy. Both may review and consolidate department requests; users
              cannot approve their own individual requests.
            </p>
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2">User</th>
                    <th className="p-2">Member</th>
                    <th className="p-2">Head</th>
                    <th className="p-2">Deputy</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="p-2">{u.name}</td>
                      <td className="p-2">
                        <input
                          aria-label={`${u.name} is a member`}
                          type="checkbox"
                          checked={
                            form.members.includes(u.id) ||
                            String(form.head) === String(u.id) ||
                            String(form.deputy) === String(u.id)
                          }
                          disabled={
                            String(form.head) === String(u.id) ||
                            String(form.deputy) === String(u.id)
                          }
                          onChange={(e) =>
                            setForm({
                              ...form,
                              members: e.target.checked
                                ? [...new Set([...form.members, u.id])]
                                : form.members.filter(
                                    (id: number) => id !== u.id,
                                  ),
                            })
                          }
                        />
                      </td>
                      {["head", "deputy"].map((position) => (
                        <td key={position} className="p-2">
                          <input
                            aria-label={`${u.name} is ${position}`}
                            type="checkbox"
                            checked={String(form[position]) === String(u.id)}
                            disabled={
                              String(
                                form[position === "head" ? "deputy" : "head"],
                              ) === String(u.id)
                            }
                            onChange={(e) =>
                              setForm({
                                ...form,
                                [position]: e.target.checked ? u.id : "",
                                members: e.target.checked
                                  ? [...new Set([...form.members, u.id])]
                                  : form.members,
                              })
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button disabled={mutation.isPending || !form.head}>
              Save department
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </ERPWorkspacePage>
  );
}
