/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { Button } from '@/components/ui/button';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { apiErrorFromResponse } from '@/lib/api-errors';

type Task = { id: number; number: string; title: string; due_date: string | null; priority: string; status: string };
type Page = { results: Task[] };
const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ProjectCalendar() {
  const { token } = useAuth();
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const tasks = useQuery<Page>({ queryKey: ['projects-calendar'], enabled: !!token, queryFn: async () => { const response = await fetch('/api/projects/tasks/?page_size=100', { headers: { Authorization: `Token ${token}` } }); if (!response.ok) throw await apiErrorFromResponse(response, 'Task calendar could not be loaded.'); return response.json(); } });
  const days = useMemo(() => {
    const year = cursor.getFullYear(); const month = cursor.getMonth();
    const first = new Date(year, month, 1); const offset = (first.getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
      const day = index - offset + 1;
      return day >= 1 && day <= count ? new Date(year, month, day) : null;
    });
  }, [cursor]);
  const tasksForDay = (day: Date) => (tasks.data?.results ?? []).filter((task) => task.due_date === `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
  return <ERPWorkspacePage title="Task Calendar" description="Due dates for tasks in your active branch. Select a task to update its work or workflow state.">
    <div className="mb-4 flex items-center justify-between"><Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><h2 className="font-semibold">{monthLabel}</h2><Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
    <div className="grid grid-cols-7 overflow-hidden rounded-lg border bg-card">{weekDays.map((day) => <div className="border-b bg-muted/40 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={day}>{day}</div>)}{days.map((day, index) => <div className="min-h-32 border-b border-r p-2" key={`${day?.toISOString() ?? 'empty'}-${index}`}>{day ? <><div className="text-sm font-medium">{day.getDate()}</div><div className="mt-2 space-y-1">{tasksForDay(day).map((task) => <Link href={`/projects/tasks/${task.id}`} key={task.id}><div className="cursor-pointer truncate rounded bg-[#C4B13B]/15 px-2 py-1 text-xs hover:bg-[#C4B13B]/25">{task.number} {task.title}</div></Link>)}</div></> : null}</div>)}</div>
  </ERPWorkspacePage>;
}
