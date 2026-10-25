/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
import { apiErrorFromResponse } from "@/lib/api-errors";

type CalendarEvent = {
  kind: "task" | "milestone" | "follow_up";
  id: number;
  title: string;
  date: string;
  priority: string;
  status: string;
  url: string;
};
type ProjectPage = {
  results: Array<{ id: number; code: string; name: string }>;
};
type Assignee = { id: number; name: string };
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function ProjectCalendar() {
  const { token } = useAuth();
  const [cursor, setCursor] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [project, setProject] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const range = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const iso = (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    return { start: iso(start), end: iso(end) };
  }, [cursor]);
  const filters = new URLSearchParams({ start: range.start, end: range.end });
  if (project !== "all") filters.set("project", project);
  if (assignee !== "all") filters.set("assignee", assignee);
  const events = useQuery<CalendarEvent[]>({
    queryKey: ["projects-calendar", range.start, range.end, project, assignee],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/calendar/?${filters.toString()}`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project calendar could not be loaded.",
        );
      return response.json();
    },
  });
  const projects = useQuery<ProjectPage>({
    queryKey: ["projects-calendar-options"],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch("/api/projects/projects/?page_size=100", {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Projects could not be loaded.",
        );
      return response.json();
    },
  });
  const assignees = useQuery<Assignee[]>({
    queryKey: ["projects-calendar-assignee-options"],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch("/api/projects/tasks/assignees/", {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task assignees could not be loaded.",
        );
      return response.json();
    },
  });
  const days = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from(
      { length: Math.ceil((offset + count) / 7) * 7 },
      (_, index) => {
        const day = index - offset + 1;
        return day >= 1 && day <= count ? new Date(year, month, day) : null;
      },
    );
  }, [cursor]);
  const eventsForDay = (day: Date) =>
    (events.data ?? []).filter(
      (event) =>
        event.date ===
        `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
    );
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(cursor);
  const today = new Date();
  const isToday = (day: Date) =>
    day.getFullYear() === today.getFullYear() &&
    day.getMonth() === today.getMonth() &&
    day.getDate() === today.getDate();
  return (
    <ERPWorkspacePage
      title="Project Calendar"
      description="Task due dates, project milestones, and scheduled follow-ups in your active branch."
    >
      <div className="mb-4 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{monthLabel}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
            }
          >
            Today
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#C4B13B]" />
          Task
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />
          Milestone
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500" />
          Follow-up
        </span>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="sm:w-64">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects.data?.results ?? []).map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.code} · {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="All assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value="mine">My tasks</SelectItem>
            {(assignees.data ?? []).map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border bg-card">
        {weekDays.map((day) => (
          <div
            className="border-b bg-muted/40 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            key={day}
          >
            {day}
          </div>
        ))}
        {days.map((day, index) => (
          <div
            className={`min-h-32 border-b border-r p-2 ${day && isToday(day) ? "bg-[#C4B13B]/10 ring-1 ring-inset ring-[#C4B13B]/50" : ""}`}
            key={`${day?.toISOString() ?? "empty"}-${index}`}
          >
            {day ? (
              <>
                <div className="text-sm font-medium">{day.getDate()}</div>
                <div className="mt-2 space-y-1">
                  {eventsForDay(day).map((event) => (
                    <Link href={event.url} key={`${event.kind}-${event.id}`}>
                      <div
                        className={`cursor-pointer truncate rounded px-2 py-1 text-xs hover:opacity-80 ${event.kind === "milestone" ? "bg-blue-100 text-blue-800" : event.kind === "follow_up" ? "bg-violet-100 text-violet-800" : "bg-[#C4B13B]/15 text-foreground"}`}
                        title={event.title}
                      >
                        {event.title}
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </ERPWorkspacePage>
  );
}
