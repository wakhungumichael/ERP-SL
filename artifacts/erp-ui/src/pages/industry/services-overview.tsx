import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BriefcaseBusiness, Clock3, Landmark, Users2 } from 'lucide-react';

const serviceAreas = [
  { title: 'Project Workspace', text: 'Projects can be a standalone client-facing operating model while still reusing shared customers, finance, and staffing data.', icon: <BriefcaseBusiness className="h-4 w-4 text-indigo-600" /> },
  { title: 'Resource Management', text: 'Capacity and utilization should link HR and project execution without duplicating employee records.', icon: <Users2 className="h-4 w-4 text-sky-600" /> },
  { title: 'Time & Expense', text: 'Timesheets and reimbursables should feed billing and payroll through shared policy and approval controls.', icon: <Clock3 className="h-4 w-4 text-emerald-600" /> },
  { title: 'Milestone Billing', text: 'Billing logic should remain finance-native even when triggered by project progress.', icon: <Landmark className="h-4 w-4 text-amber-600" /> },
];

export default function ServicesOverview() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects & Services Pack</h1>
          <p className="mt-1 text-sm text-muted-foreground">Professional services, project delivery, and milestone billing on top of shared ERP core services.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/20 border-b py-3">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Pack Objective</CardTitle>
        </CardHeader>
        <CardContent className="p-5 text-sm text-muted-foreground">
          This pack should be able to run standalone for services firms while still consuming shared party, HR, finance, and reporting masters.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {serviceAreas.map((item) => (
          <Card key={item.title} className="shadow-sm">
            <CardContent className="p-5">
              <div className="mb-3 inline-flex rounded-full bg-muted p-2">{item.icon}</div>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link href="/crm/companies" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Users2 className="h-4 w-4 text-sky-600" /> Shared Client Master</div>
          <p className="mt-2 text-sm text-muted-foreground">Service projects should reuse the same account, contact, and opportunity backbone as CRM and Sales.</p>
        </Link>
        <Link href="/hr/staff" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-emerald-600" /> Shared Resource Pool</div>
          <p className="mt-2 text-sm text-muted-foreground">Project delivery teams should consume shared employee records instead of creating a separate staffing silo.</p>
        </Link>
        <Link href="/finance/overview" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-violet-600" /> Shared Billing & Margin</div>
          <p className="mt-2 text-sm text-muted-foreground">Milestone billing and profitability must settle back into the finance core for one source of truth.</p>
        </Link>
      </div>
    </div>
  );
}
