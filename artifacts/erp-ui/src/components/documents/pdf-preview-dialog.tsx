import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, Download, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorFromResponse } from "@/lib/api-errors";

export function PDFPreviewDialog({ title, url, token, open, onOpenChange, onDownload, downloading = false }: {
  title: string; url: string; token: string | null; open: boolean; onOpenChange: (open: boolean) => void; onDownload: () => void; downloading?: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [attempt, setAttempt] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!open || !token) { setPdf(null); return; }
    const controller = new AbortController();
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true); setError(""); setPdf(null); setPage(1); setZoom(1);
    void (async () => {
      try {
        const response = await fetch(url, { headers: { Authorization: `Token ${token}` }, signal: controller.signal });
        if (!response.ok) throw await apiErrorFromResponse(response, "The PDF preview could not be loaded.");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        if (controller.signal.aborted) return;
        loadingTask = pdfjs.getDocument({ data });
        const document = await loadingTask.promise;
        if (!controller.signal.aborted) setPdf(document);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The PDF preview could not be loaded."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); if (loadingTask) void loadingTask.destroy(); };
  }, [open, token, url, attempt]);
  useEffect(() => {
    if (!open || !viewportRef.current) return;
    const element = viewportRef.current;
    const observer = new ResizeObserver(() => setWidth(Math.max(160, element.clientWidth - 32)));
    observer.observe(element);
    setWidth(Math.max(160, element.clientWidth - 32));
    return () => observer.disconnect();
  }, [open, pdf]);
  useEffect(() => {
    if (!pdf || !canvasRef.current || !open) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const canvas = canvasRef.current;
    delete canvas.dataset.renderedPage;
    void (async () => {
      try {
        const documentPage = await pdf.getPage(page);
        if (cancelled) return;
        const normal = documentPage.getViewport({ scale: 1 });
        const viewport = documentPage.getViewport({ scale: width / normal.width * zoom });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not display the PDF preview.");
        const rendering = documentPage.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        task = rendering;
        await rendering.promise;
        if (!cancelled) canvas.dataset.renderedPage = String(page);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "This PDF page could not be displayed."); }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, width, zoom, open]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[96dvh] sm:max-h-[96dvh] sm:w-[calc(100vw-2rem)] sm:max-w-[1600px] sm:rounded-lg sm:border">
      <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12"><DialogTitle className="break-words">Preview {title}</DialogTitle></DialogHeader>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous PDF page" disabled={!pdf || page <= 1} onClick={() => setPage(value => value-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="px-2 text-xs">Page {page} of {pdf?.numPages ?? 1}</span>
          <Button variant="outline" size="icon" aria-label="Next PDF page" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(value => value+1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" aria-label="Zoom out" disabled={!pdf || zoom <= .5} onClick={() => setZoom(value => Math.max(.5,value-.25))}><Minus className="h-4 w-4" /></Button>
          <span className="min-w-10 text-center text-xs">{Math.round(zoom*100)}%</span>
          <Button variant="outline" size="icon" aria-label="Zoom in" disabled={!pdf || zoom >= 3} onClick={() => setZoom(value => Math.min(3,value+.25))}><Plus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" disabled={!pdf} onClick={() => setZoom(1)}>Fit width</Button>
        </div>
        <Button variant="outline" className="gap-2" disabled={downloading} onClick={onDownload}><Download className="h-4 w-4" />{downloading ? "Preparing PDF..." : "Download PDF"}</Button>
      </div>
      <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/50 p-4">
        {loading ? <div role="status" className="flex h-full items-center justify-center gap-2 text-sm"><Loader2 className="h-5 w-5 animate-spin" />Loading PDF preview...</div> : error ? <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 text-center"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value+1)}>Retry preview</Button></div> : pdf ? <canvas ref={canvasRef} role="img" aria-label={`${title}, PDF page ${page}`} className="mx-auto block bg-white shadow" /> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
