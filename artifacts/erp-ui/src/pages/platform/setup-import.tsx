import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Package = { key: string; name: string; description: string };
export default function OrganizationSetupImport({
  tenantId,
}: {
  tenantId: number;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState([
    "workflows",
    "approval_rules",
    "hr_defaults",
  ]);
  const [publish, setPublish] = useState(true);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const api = async (method = "GET", body?: any) => {
    const r = await fetch(`/api/platform/tenants/${tenantId}/setup-import/`, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok)
      throw await apiErrorFromResponse(
        r,
        "Organization setup could not be completed.",
      );
    return r.json();
  };
  const catalog = useQuery({
    queryKey: ["organization-setup-import", token, tenantId],
    enabled: !!token,
    queryFn: () => api(),
  });
  const mutation = useMutation({
    mutationFn: ({
      preview,
      remove,
    }: {
      preview?: boolean;
      remove?: boolean;
    }) =>
      api(
        remove ? "DELETE" : "POST",
        remove
          ? undefined
          : { selections: selected, publish, dry_run: !!preview },
      ),
    onSuccess: (data, options) => {
      setResult(data);
      setClearOpen(false);
      if (!options.preview) qc.invalidateQueries();
      toast({
        title: options.preview
          ? "Import preview ready"
          : options.remove
            ? "Optional examples removed"
            : "Organization setup imported",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Setup import",
        description: e.message,
        variant: "destructive",
      }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup & Demo Import</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Choose what to add to this organization. Imports add missing records
          and preserve existing customizations. Optional examples are marked
          [DEMO] or [SAMPLE]. Module access continues to follow the
          organization’s plan.
        </p>
        {catalog.error ? (
          <p role="alert" className="text-destructive">
            {catalog.error.message}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {(catalog.data?.catalog ?? []).map((item: Package) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(item.key)}
                onChange={(e) => {
                  setResult(null);
                  setSelected(
                    e.target.checked
                      ? [...selected, item.key]
                      : selected.filter((k) => k !== item.key),
                  );
                }}
              />
              <span>
                <strong className="block text-sm">{item.name}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {selected.includes("workflows") ? (
          <label className="flex items-start gap-3 rounded border p-4 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={publish}
              onChange={(e) => {
                setPublish(e.target.checked);
                setResult(null);
              }}
            />
            <span>
              <strong>Activate newly imported workflows</strong>
              <span className="block text-xs text-muted-foreground">
                Uses existing staffed approval groups and built-in thresholds.
                Uncheck to save new workflows as drafts. Existing workflows keep
                their current status.
              </span>
            </span>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={mutation.isPending || !selected.length}
            onClick={() => mutation.mutate({ preview: true })}
          >
            Preview import
          </Button>
          <Button
            disabled={mutation.isPending || !selected.length}
            onClick={() => mutation.mutate({})}
          >
            {mutation.isPending ? "Working…" : "Import selected setup"}
          </Button>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setClearOpen(true)}
          >
            Remove optional examples
          </Button>
        </div>
        {result ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <strong className="text-sm">
              {result.dry_run ? "Preview — no records saved" : "Result"}
            </strong>
            {result.detail ? (
              <p className="mt-2 text-sm">{result.detail}</p>
            ) : null}
            {Object.entries(result.report ?? {}).map(([name, values]) => (
              <div key={name} className="mt-3 border-t pt-3 text-sm">
                <strong>{name.replaceAll("_", " ")}</strong>
                <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                  {Object.entries(values as object).map(([key, value]) => (
                    <div key={key}>
                      {key.replaceAll("_", " ")}:{" "}
                      {typeof value === "object"
                        ? Object.entries(value ?? {})
                            .map(([k, v]) => `${k} ${v}`)
                            .join(", ")
                        : String(value)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent imports</h3>
          {(catalog.data?.history ?? []).map((run: any) => (
            <div key={run.id} className="rounded border px-3 py-2 text-xs">
              <span>{new Date(run.created_at).toLocaleString("en-KE")}</span>
              <p className="mt-1 text-muted-foreground">
                {run.selections
                  .map((key: string) => key.replaceAll("_", " "))
                  .join(" · ")}
                {run.examples_removed_at ? " · Optional examples removed" : ""}
              </p>
            </div>
          ))}
          {!catalog.data?.history?.length ? (
            <p className="text-xs text-muted-foreground">
              No setup imports recorded yet.
            </p>
          ) : null}
        </div>
        <Dialog open={clearOpen} onOpenChange={setClearOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove optional examples?</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              Removes untouched imported demo masters and project samples in
              this organization. Cleanup stops if an example has edits or linked
              business records. Standard workflows, approval rules, accounts, HR
              settings and real business data are preserved.
            </p>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ remove: true })}
            >
              Remove optional examples
            </Button>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
