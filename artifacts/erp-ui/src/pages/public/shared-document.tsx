import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorFromResponse } from "@/lib/api-errors";

function readableDocument(source: string) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const referrer = parsed.createElement("meta");referrer.name="referrer";referrer.content="no-referrer";parsed.head.append(referrer);
  const style=parsed.createElement("style");
  style.textContent="@media screen and (max-width:640px){*{box-sizing:border-box}body{margin:0;overflow-wrap:anywhere}.document-shell{width:100%!important;max-width:100%!important;margin:0!important;padding:16px!important}.document-header{display:block!important}.document-meta{width:100%!important;max-width:100%!important}table{max-width:100%}td,th{padding:8px 6px!important;font-size:12px!important}.document-summary{max-width:100%!important}}";
  parsed.head.append(style);
  return "<!doctype html>"+parsed.documentElement.outerHTML;
}

export default function SharedDocument({ token }: { token: string }) {
  const [html,setHtml]=useState("");const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [downloading,setDownloading]=useState(false);const [attempt,setAttempt]=useState(0);
  const endpoint=`/api/platform/public/documents/${encodeURIComponent(token)}/`;
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");setHtml("");
    void (async()=>{try{const response=await fetch(endpoint,{signal:controller.signal,credentials:"omit"});if(!response.ok)throw await apiErrorFromResponse(response,"This document link is unavailable.");const content=await response.text();if(!controller.signal.aborted)setHtml(readableDocument(content));}catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"This document link is unavailable.");}finally{if(!controller.signal.aborted)setLoading(false);}})();
    return()=>controller.abort();
  },[endpoint,attempt]);
  const download=async()=>{setDownloading(true);try{const response=await fetch(endpoint+"?download=pdf",{credentials:"omit"});if(!response.ok)throw await apiErrorFromResponse(response,"The PDF could not be downloaded.");const blob=await response.blob();const filename=response.headers.get("Content-Disposition")?.match(/filename="([^"\r\n]+)"/)?.[1]||"shared-document.pdf";const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(reason){setError(reason instanceof Error?reason.message:"The PDF could not be downloaded.");}finally{setDownloading(false);}};
  return <main className="flex h-[100dvh] flex-col bg-muted/30">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3"><div><h1 className="text-lg font-semibold">Shared document</h1><p className="text-xs text-muted-foreground">Read-only document details</p></div><Button variant="outline" disabled={loading||!html||downloading} onClick={()=>void download()}><Download className="mr-2 h-4 w-4" />{downloading?"Preparing PDF...":"Download PDF"}</Button></header>
    {loading?<div role="status" className="flex flex-1 items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Loading document...</div>:error?<div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"><h2 className="font-semibold">Document unavailable</h2><p className="max-w-lg text-sm text-muted-foreground">{error}</p><Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>Try again</Button></div>:<iframe title="Shared document details" srcDoc={html} sandbox="" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" />}
  </main>;
}
