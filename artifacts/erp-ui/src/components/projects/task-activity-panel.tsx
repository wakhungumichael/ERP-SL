import { useState, type FormEvent } from "react";
import {
  CalendarClock,
  CheckSquare,
  MessageSquarePlus,
  Plus,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskRelatedRegister, type RelatedRow } from "./related-register";
import { dateAfterDays, useProjectSettings } from "./module-settings";

type ActivityKind = "checklist" | "updates" | "follow-ups";
const sections = [
  {
    kind: "checklist",
    label: "Deliverables",
    title: "Task deliverables",
    description:
      "Track measurable results. Check off a deliverable when the work is complete.",
    action: "Add deliverable",
    icon: CheckSquare,
  },
  {
    kind: "updates",
    label: "Activity log",
    title: "Activity log",
    description: "Keep a record of completed work, time spent, and blockers.",
    action: "Add update",
    icon: MessageSquarePlus,
  },
  {
    kind: "follow-ups",
    label: "Follow-ups",
    title: "Scheduled follow-ups",
    description:
      "Track reminders and next actions. Completing a reminder keeps the task status unchanged.",
    action: "Schedule follow-up",
    icon: CalendarClock,
  },
] satisfies Array<{
  kind: ActivityKind;
  label: string;
  title: string;
  description: string;
  action: string;
  icon: typeof CheckSquare;
}>;

export function TaskActivityPanel({
  taskId,
  projectId,
  progress,
  inactive,
  canProgress = false,
  canAddFollowUp = false,
  canCompleteFollowUp = false,
  saving,
  checklistBusy,
  followUpBusy,
  onAddDeliverable,
  onAddUpdate,
  onAddFollowUp,
  onToggleDeliverable,
  onCompleteFollowUp,
}: {
  taskId: string;
  projectId: number;
  progress: number;
  inactive: boolean;
  canProgress?: boolean;
  canAddFollowUp?: boolean;
  canCompleteFollowUp?: boolean;
  saving: boolean;
  checklistBusy: boolean;
  followUpBusy: boolean;
  onAddDeliverable: (title: string) => Promise<unknown>;
  onAddUpdate: (values: {
    note: string;
    timeSpent: string;
  }) => Promise<unknown>;
  onAddFollowUp: (values: { date: string; notes: string }) => Promise<unknown>;
  onToggleDeliverable: (row: RelatedRow) => void;
  onCompleteFollowUp: (id: number) => void;
}) {
  const settings = useProjectSettings();
  const [dialog, setDialog] = useState<ActivityKind | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [timeSpent, setTimeSpent] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState("");
  const percentage = Math.min(100, Math.max(0, Number(progress) || 0));
  const current = sections.find((section) => section.kind === dialog);
  const open = (kind: ActivityKind) => {
    setFailure("");
    if (kind === "follow-ups" && !date)
      setDate(dateAfterDays(settings.data?.default_follow_up_days ?? 7));
    setDialog(kind);
  };
  const canSave =
    dialog === "checklist"
      ? !!title.trim()
      : dialog === "updates"
        ? !!note.trim()
        : !!date;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || inactive || !canSave) return;
    setFailure("");
    try {
      if (dialog === "checklist") {
        await onAddDeliverable(title.trim());
        setTitle("");
      } else if (dialog === "updates") {
        await onAddUpdate({ note: note.trim(), timeSpent });
        setNote("");
        setTimeSpent("");
      } else if (dialog === "follow-ups") {
        await onAddFollowUp({ date, notes: notes.trim() });
        setDate("");
        setNotes("");
      }
      setDialog(null);
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not save. Please try again.",
      );
    }
  };
  return (
    <div className="min-w-0 space-y-4">
      <section
        className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        aria-label="Task progress"
      >
        <div>
          <h2 className="font-semibold">Task progress</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Progress updates automatically as deliverables are completed.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-48">
          <p className="mb-2 text-right text-sm font-semibold">
            {percentage}% complete
          </p>
          <div
            role="progressbar"
            aria-label="Task completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </section>
      <Tabs
        defaultValue="checklist"
        className="min-w-0 overflow-hidden rounded-lg border bg-card"
      >
        <div className="border-b bg-muted/20 p-2">
          <TabsList
            aria-label="Task activity sections"
            className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0"
          >
            {sections.map(({ kind, label, icon: Icon }) => (
              <TabsTrigger className="gap-2 px-3 py-2" key={kind} value={kind}>
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {sections.map((section) => (
          <TabsContent
            key={section.kind}
            value={section.kind}
            className="mt-0 min-w-0 p-3 sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-semibold">{section.title}</h3>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
              <Button
                className="shrink-0 gap-2"
                disabled={
                  inactive ||
                  !(section.kind === "follow-ups"
                    ? canAddFollowUp
                    : canProgress)
                }
                onClick={() => open(section.kind)}
              >
                <Plus className="h-4 w-4" />
                {section.action}
              </Button>
            </div>
            <TaskRelatedRegister
              taskId={taskId}
              projectId={projectId}
              kind={section.kind}
              busy={
                inactive ||
                (section.kind === "checklist" ? checklistBusy : followUpBusy)
              }
              onToggle={canProgress ? onToggleDeliverable : undefined}
              onComplete={canCompleteFollowUp ? onCompleteFollowUp : undefined}
            />
          </TabsContent>
        ))}
      </Tabs>
      <Dialog
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setDialog(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-xl flex-col overflow-hidden rounded-lg">
          <DialogHeader className="shrink-0 text-left">
            <DialogTitle>{current?.action}</DialogTitle>
            <DialogDescription>{current?.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
            <div className="min-h-0 space-y-4 overflow-y-auto p-1">
              {failure && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {failure}
                </p>
              )}
              {dialog === "checklist" && (
                <div className="space-y-2">
                  <Label htmlFor="task-deliverable-title" required>
                    Deliverable
                  </Label>
                  <Input
                    id="task-deliverable-title"
                    required
                    maxLength={255}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={saving}
                    placeholder="For example, deploy and verify the update"
                  />
                </div>
              )}
              {dialog === "updates" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="task-update-note" required>
                      Work update
                    </Label>
                    <Textarea
                      id="task-update-note"
                      required
                      className="min-h-32"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      disabled={saving}
                      placeholder="Describe completed work, blockers, or the next action"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="task-update-hours">
                      Hours worked (optional)
                    </Label>
                    <Input
                      id="task-update-hours"
                      type="number"
                      min="0"
                      step="0.25"
                      value={timeSpent}
                      onChange={(event) => setTimeSpent(event.target.value)}
                      disabled={saving}
                      placeholder="0"
                      className="sm:max-w-48"
                    />
                  </div>
                </>
              )}
              {dialog === "follow-ups" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="task-follow-up-date" required>
                      Follow-up date
                    </Label>
                    <Input
                      id="task-follow-up-date"
                      type="date"
                      required
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="task-follow-up-notes">
                      Reminder notes (optional)
                    </Label>
                    <Textarea
                      id="task-follow-up-notes"
                      className="min-h-32"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      disabled={saving}
                      placeholder="What needs to happen?"
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t pt-4 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || inactive || !canSave}>
                {saving ? "Saving…" : current?.action}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
