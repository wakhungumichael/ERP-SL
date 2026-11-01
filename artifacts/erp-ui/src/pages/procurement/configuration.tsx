import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Choice = { id: number; name: string; code?: string };
type Policy = {
  branch_scope: string;
  branches: number[];
  department_scope: string;
  departments: number[];
  require_department: boolean;
  approval_source: string;
  workflow: number | null;
};
type Setup = {
  organization: { id: number; name: string };
  can_manage: boolean;
  configuration: Policy;
  branches: Choice[];
  departments: Choice[];
  workflows: Choice[];
};
export default function ProcurementConfiguration() {
  const { token, user } = useAuth(),
    { toast } = useToast(),
    qc = useQueryClient();
  const [form, setForm] = useState<Policy | null>(null),
    [failure, setFailure] = useState("");
  const api = async (body?: Policy) => {
    const response = await fetch("/api/procurement/configuration/", {
      method: body ? "PATCH" : "GET",
      headers: {
        Authorization: `Token ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    return response.json();
  };
  const setup = useQuery<Setup>({
    queryKey: [
      "procurement-configuration",
      token,
      user?.organization_id,
      user?.active_role_group_name,
    ],
    enabled: !!token,
    queryFn: () => api(),
  });
  useEffect(() => {
    if (setup.data) setForm(setup.data.configuration);
  }, [setup.data]);
  const save = useMutation({
    mutationFn: () => api(form!),
    onSuccess: () => {
      for (const key of [
        "procurement-configuration",
        "procurement-setup",
        "procurement-approval-matrix",
        "procurement-requisitions",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      setFailure("");
      toast({ title: "Procurement configuration saved" });
    },
    onError: (error: Error) => setFailure(error.message),
  });
  const disabled = !setup.data?.can_manage || save.isPending;
  const selections = (field: "branches" | "departments", choices: Choice[]) => (
    <div className="grid max-h-64 gap-3 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
      {choices.length ? (
        choices.map((choice) => (
          <label key={choice.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={form![field].includes(choice.id)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current!,
                  [field]: event.target.checked
                    ? [...current![field], choice.id]
                    : current![field].filter((id) => id !== choice.id),
                }))
              }
            />
            <span>
              {choice.name}
              {choice.code ? ` (${choice.code})` : ""}
            </span>
          </label>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          Create shared {field} in Organization Settings first.
        </p>
      )}
    </div>
  );
  return (
    <ERPWorkspacePage
      title="Procurement settings"
      actions={
        <Button
          type="submit"
          form="procurement-settings"
          disabled={disabled || !form}
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      }
    >
      {setup.error && (
        <p role="alert" className="text-destructive">
          {setup.error.message}
        </p>
      )}
      {!form ? (
        <p className="text-sm text-muted-foreground">
          {setup.isLoading ? "Loading settings…" : "Settings are unavailable."}
        </p>
      ) : (
        <form
          id="procurement-settings"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!disabled) save.mutate();
          }}
          className="space-y-4"
        >
          {failure && (
            <p
              role="alert"
              className="rounded border border-destructive/40 p-3 text-sm text-destructive"
            >
              {failure}
            </p>
          )}
          <Tabs defaultValue="scope">
            <TabsList>
              <TabsTrigger value="scope">Branches & departments</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
            </TabsList>
            <TabsContent
              value="scope"
              className="rounded-lg border bg-card p-4 sm:p-6"
            >
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <Label htmlFor="procurement-branch-scope">Branches</Label>
                  <Select
                    value={form.branch_scope}
                    disabled={disabled}
                    onValueChange={(branch_scope) =>
                      setForm({ ...form, branch_scope })
                    }
                  >
                    <SelectTrigger id="procurement-branch-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All branches</SelectItem>
                      <SelectItem value="selected">
                        Selected branches
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {form.branch_scope === "selected" &&
                    selections("branches", setup.data?.branches || [])}
                </div>
                <div className="space-y-3">
                  <Label htmlFor="procurement-department-scope">
                    Departments
                  </Label>
                  <Select
                    value={form.department_scope}
                    disabled={disabled}
                    onValueChange={(department_scope) =>
                      setForm({ ...form, department_scope })
                    }
                  >
                    <SelectTrigger id="procurement-department-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      <SelectItem value="selected">
                        Selected departments
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {form.department_scope === "selected" &&
                    selections("departments", setup.data?.departments || [])}
                </div>
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={form.require_department}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      require_department: event.target.checked,
                    })
                  }
                />
                Require a department on every requisition
              </label>
              <div className="mt-5">
                <Button type="button" asChild variant="link" className="px-0">
                  <Link href="/platform/organization-settings?section=departments">
                    Manage departments
                  </Link>
                </Button>
              </div>
            </TabsContent>
            <TabsContent
              value="approvals"
              className="rounded-lg border bg-card p-4 sm:p-6"
            >
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <Label htmlFor="procurement-approval-source">
                    Approval process
                  </Label>
                  <Select
                    value={form.approval_source}
                    disabled={disabled}
                    onValueChange={(approval_source) =>
                      setForm({ ...form, approval_source })
                    }
                  >
                    <SelectTrigger id="procurement-approval-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="workflow">Workflow Center</SelectItem>
                      <SelectItem value="matrix">Approval rules</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.approval_source === "workflow" && (
                  <div className="space-y-3">
                    <Label htmlFor="procurement-workflow">Workflow</Label>
                    <Select
                      value={String(form.workflow || "automatic")}
                      disabled={disabled}
                      onValueChange={(value) =>
                        setForm({
                          ...form,
                          workflow:
                            value === "automatic" ? null : Number(value),
                        })
                      }
                    >
                      <SelectTrigger id="procurement-workflow">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">
                          Default organization workflow
                        </SelectItem>
                        {setup.data?.workflows.map((workflow) => (
                          <SelectItem
                            key={workflow.id}
                            value={String(workflow.id)}
                          >
                            {workflow.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Changes apply to new submissions. Existing approval decisions
                are retained.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                <Link
                  className="text-sm text-primary underline"
                  href="/platform/workflows"
                >
                  Workflow Center
                </Link>
                <Link
                  className="text-sm text-primary underline"
                  href="/procurement/approval-rules"
                >
                  Approval rules
                </Link>
                <Link
                  className="text-sm text-primary underline"
                  href="/platform/users"
                >
                  Users
                </Link>
                <Link
                  className="text-sm text-primary underline"
                  href="/platform/roles"
                >
                  Roles & permissions
                </Link>
              </div>
            </TabsContent>
          </Tabs>
        </form>
      )}
    </ERPWorkspacePage>
  );
}
