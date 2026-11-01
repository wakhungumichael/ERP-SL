import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CORE_TICKET_KEYS,
  ticketIntakeFields,
  type IntakeForm,
} from "./form-schema";

export type CreatedAgentTicket = {
  id: number;
  public_id: string;
  subject: string;
  project_name?: string;
  project?: number | null;
  requester_name?: string;
  requester_email: string;
  description?: string;
  priority: string;
  status: string;
};
export type RequesterDefaults = { name: string; email: string };
const initialDraft = (defaults?: RequesterDefaults) => ({
  requester_name: defaults?.name || "",
  requester_email: defaults?.email || "",
  requester_phone: "",
  project_name: "",
  subject: "",
  description: "",
  category: "",
  priority: "normal",
});

export function CreateAgentTicketDialog({
  open,
  onOpenChange,
  defaults,
  onCreated,
  forms = [],
  projectNames = [],
  onProjectSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: RequesterDefaults;
  onCreated: (ticket: CreatedAgentTicket) => void;
  forms?: IntakeForm[];
  projectNames?: string[];
  onProjectSearch?: (value: string) => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [draft, setDraft] = useState(() => initialDraft(defaults));
  const [failure, setFailure] = useState("");
  const defaultFormId = String(
    forms.find((form) => form.is_default)?.id || "none",
  );
  const [formId, setFormId] = useState(defaultFormId);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const selectedForm = forms.find((form) => String(form.id) === formId);
  const fields = useMemo(
    () => ticketIntakeFields(selectedForm),
    [selectedForm],
  );
  useEffect(() => {
    if (!open) {
      setDraft(initialDraft(defaults));
      setFormId(defaultFormId);
      setCustom({});
      setFailure("");
    }
  }, [open, defaults?.name, defaults?.email, defaultFormId]);
  const schemaKey = JSON.stringify(selectedForm?.schema || {});
  useEffect(() => {
    const priority = fields.find((field) => field.key === "priority");
    if (priority?.type === "select")
      setDraft((current) => ({
        ...current,
        priority: priority.options?.includes(current.priority)
          ? current.priority
          : priority.options?.[0] || "normal",
      }));
  }, [formId, schemaKey]);
  const create = useMutation({
    mutationFn: async () => {
      if (
        !draft.subject.trim() ||
        !draft.requester_email.trim() ||
        !draft.description.trim()
      )
        throw new Error("Enter a requester email, subject, and description.");
      const visible = new Set(fields.map((field) => field.key));
      const payload = Object.fromEntries(
        Object.entries(draft)
          .filter(([key]) => visible.has(key))
          .map(([key, value]) => [key, value.trim()]),
      );
      const response = await fetch("/api/ticketing/tickets/", {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          ...(formId !== "none" ? { form_schema: Number(formId) } : {}),
          custom_fields: custom,
          source_channel: "erp",
          source_page: "/ticketing/queue",
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "The ticket could not be created.",
        );
      return response.json() as Promise<CreatedAgentTicket>;
    },
    onSuccess: (ticket) => {
      setFailure("");
      toast({ title: "Ticket created", description: ticket.public_id });
      onCreated(ticket);
    },
    onError: (error: Error) => setFailure(error.message),
  });
  const update = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFailure("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!create.isPending) create.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>New Ticket</DialogTitle>
          <DialogDescription>
            Log a ticket in the active organization. Use the requester’s details
            when creating it on someone else’s behalf.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="min-h-0 space-y-4 overflow-y-auto p-1">
            {failure && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {failure}
              </p>
            )}
            {forms.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="agent-ticket-form">Intake form</Label>
                <Select
                  value={formId}
                  onValueChange={(value) => {
                    setFormId(value);
                    setCustom({});
                    setFailure("");
                  }}
                  disabled={create.isPending}
                >
                  <SelectTrigger id="agent-ticket-form">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General ticket</SelectItem>
                    {forms.map((form) => (
                      <SelectItem key={form.id} value={String(form.id)}>
                        {form.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => {
                const id = `agent-ticket-${field.key.replaceAll("_", "-")}`;
                const value = CORE_TICKET_KEYS.has(field.key)
                  ? draft[field.key as keyof typeof draft] || ""
                  : custom[field.key] || "";
                const change = (next: string) => {
                  if (CORE_TICKET_KEYS.has(field.key))
                    update(field.key as keyof typeof draft, next);
                  else {
                    setCustom((current) => ({ ...current, [field.key]: next }));
                    setFailure("");
                  }
                  if (field.key === "project_name") onProjectSearch?.(next);
                };
                const limit =
                  (
                    {
                      requester_name: 150,
                      requester_email: 254,
                      requester_phone: 50,
                      project_name: 180,
                      subject: 255,
                      category: 120,
                    } as Record<string, number>
                  )[field.key] || 10000;
                return (
                  <div
                    key={field.key}
                    className={`space-y-2 ${["project_name", "subject", "description"].includes(field.key) || field.type === "textarea" ? "sm:col-span-2" : ""}`}
                  >
                    <Label htmlFor={id}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </Label>
                    {field.type === "textarea" ? (
                      <Textarea
                        id={id}
                        required={field.required}
                        maxLength={limit}
                        value={value}
                        onChange={(event) => change(event.target.value)}
                        disabled={create.isPending}
                        className="min-h-28"
                      />
                    ) : field.type === "select" ? (
                      <Select
                        value={value}
                        onValueChange={change}
                        required={field.required}
                        disabled={create.isPending}
                      >
                        <SelectTrigger id={id}>
                          <SelectValue placeholder="Choose an option" />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options || []).map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        required={field.required}
                        type={
                          field.key === "requester_email" ||
                          field.type === "email"
                            ? "email"
                            : ["phone", "tel"].includes(field.type)
                              ? "tel"
                              : "text"
                        }
                        maxLength={limit}
                        value={value}
                        onChange={(event) => change(event.target.value)}
                        disabled={create.isPending}
                        list={
                          field.key === "project_name"
                            ? "agent-ticket-project-names"
                            : undefined
                        }
                      />
                    )}
                    {field.key === "project_name" && (
                      <>
                        <datalist id="agent-ticket-project-names">
                          {projectNames.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                        <p className="text-xs text-muted-foreground">
                          Type or choose a project name. Existing names are
                          reused. New names automatically create a draft
                          project.
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create Ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
