import { useSearch } from "wouter";
import { PDFPreviewDialog } from "@/components/documents/pdf-preview-dialog";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { useAuth } from "@/context/use-auth";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";

type Payslip = {
  id: number;
  period_name: string;
  period_start: string;
  period_end: string;
  currency: string;
  employee_name: string;
  basic_pay: string;
  allowances: string;
  gross_pay: string;
  deductions: string;
  net_pay: string;
};
type PayslipPage = { count: number; results: Payslip[] };
const date = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const money = (value: string, currency: string) => `${currency || "KES"} ${Number(value).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MyPayslips() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Payslip | null>(null);
  const query = useSearch();
  useEffect(() => {
    const requested = new URLSearchParams(query).get("payslip");
    if (requested && /^\d+$/.test(requested)) setPreview({ id: Number(requested), period_name: "Payslip", period_start: "" } as Payslip);
  }, [query]);
  const payslips = useQuery<PayslipPage>({
    queryKey: ["my-payslips", token, user?.id, user?.organization_id, user?.active_membership_id, page, pageSize, search],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), search });
      const response = await fetch(`/api/hr/my-payslips/?${params}`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, "Your payslips could not be loaded.");
      return response.json();
    },
  });
  const download = useMutation({
    mutationFn: async (row: Payslip) => {
      const response = await fetch(`/api/hr/my-payslips/${row.id}/download/`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, "Your payslip could not be downloaded.");
      const blob = await response.blob();
      if (!blob.type.includes("application/pdf")) throw new Error("The payslip PDF is unavailable. Please try again.");
      const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"\r\n]+)"/)?.[1] || `payslip-${row.period_start}-${row.id}.pdf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error: Error) => toast({ title: "Unable to download payslip", description: error.message, variant: "destructive" }),
  });
  return (
    <ERPWorkspacePage title="My Payslips" description="Your individual payslips from completed payroll periods. Preview or download each payslip.">
      <Input aria-label="Search your payslips" placeholder="Search by pay period..." className="sm:max-w-md" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
      {payslips.isLoading && <p role="status" className="py-8 text-sm text-muted-foreground">Loading your payslips...</p>}
      {payslips.isError && <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"><p>{payslips.error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void payslips.refetch()}>Try again</Button></div>}
      {!payslips.isLoading && !payslips.isError && !payslips.data?.results.length && (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center"><h2 className="font-semibold">{search ? "No matching payslips" : "No payslips available yet"}</h2><p className="mt-2 text-sm text-muted-foreground">{search ? "Try another pay period." : "Your payslips will appear here when payroll is completed for your account."}</p></div>
      )}
      {!payslips.isError && (
        <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" aria-label="Your payslips">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr>{["Pay period", "Basic pay", "Allowances", "Gross pay", "Deductions", "Net pay", "Actions"].map(label => <th key={label} className={`whitespace-nowrap px-4 py-3 ${["Pay period", "Actions"].includes(label) ? "text-left" : "text-right"}`}>{label}</th>)}</tr></thead>
            <tbody>{payslips.data?.results.map(row => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="min-w-52 px-4 py-4"><p className="font-semibold">{row.period_name}</p><p className="mt-1 text-xs text-muted-foreground">{date(row.period_start)} - {date(row.period_end)}</p></td>
                {[row.basic_pay,row.allowances,row.gross_pay,row.deductions,row.net_pay].map((value,index) => <td key={index} className={`whitespace-nowrap px-4 py-4 text-right tabular-nums ${index===4 ? "font-semibold" : ""}`}>{money(value,row.currency)}</td>)}
                <td className="px-4 py-3"><div className="flex gap-2"><Button size="sm" variant="outline" aria-label={`Preview ${row.period_name} payslip`} onClick={() => setPreview(row)}><Eye className="mr-2 h-4 w-4" />Preview</Button><Button size="sm" variant="outline" aria-label={`Download ${row.period_name} payslip PDF`} disabled={download.isPending} onClick={() => download.mutate(row)}><Download className="mr-2 h-4 w-4" />{download.isPending && download.variables?.id===row.id ? "Downloading..." : "Download"}</Button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <PDFPreviewDialog title={preview?.period_name ?? "Payslip"} url={`/api/hr/my-payslips/${preview?.id ?? 0}/download/`} token={token} open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }} onDownload={() => { if (preview) download.mutate(preview); }} downloading={download.isPending} />
      {!payslips.isError && !!payslips.data?.count && <ListingPagination page={page} pageSize={pageSize} totalCount={payslips.data.count} onPage={setPage} onPageSize={value => { setPageSize(value); setPage(1); }} wrap />}
    </ERPWorkspacePage>
  );
}
