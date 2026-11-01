import { PDFPreviewDialog } from "@/components/documents/pdf-preview-dialog";

export function InvoicePreviewDialog({ invoiceId, invoiceNumber, token, open, onOpenChange, onDownload, downloading }: {
  invoiceId: number; invoiceNumber: string; token: string | null; open: boolean; onOpenChange: (open: boolean) => void; onDownload: () => void; downloading: boolean;
}) {
  return <PDFPreviewDialog title={invoiceNumber} url={`/api/payments/invoices/${invoiceId}/document/?download=pdf`} token={token} open={open} onOpenChange={onOpenChange} onDownload={onDownload} downloading={downloading} />;
}
