import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ShareForm = { id: number; name: string; is_public: boolean };
function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
export function ShareTicketFormDialog({
  form,
  onClose,
}: {
  form: ShareForm | null;
  onClose: () => void;
}) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [preview, setPreview] = useState(false);
  const publish = useQuery<{
    is_public: boolean;
    form_path: string | null;
    allowed_domains: string[];
  }>({
    queryKey: ["ticket-form-publish", token, user?.organization_id, form?.id],
    enabled: !!token && !!form,
    queryFn: async () => {
      const response = await fetch(
        `/api/ticketing/forms/${form!.id}/publish/`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      return response.json();
    },
  });
  const url = publish.data?.form_path
    ? new URL(publish.data.form_path, window.location.origin).href
    : "";
  const iframe = url
    ? `<iframe src="${escapeAttribute(url)}" title="${escapeAttribute(form?.name || "Support request")}" width="100%" height="900" style="border:0;max-width:100%;" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
    : "";
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({
        title: "Select and copy the text below",
        variant: "destructive",
      });
    }
  };
  return (
    <Dialog
      open={!!form}
      onOpenChange={(open) => {
        if (!open) {
          setPreview(false);
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Share & Embed: {form?.name}</DialogTitle>
          <DialogDescription>
            Use a direct link or place this public form on your website. No
            sign-in or API key is needed for requesters.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto p-1">
          {publish.isLoading ? (
            <p>Loading publishing details…</p>
          ) : publish.isError ? (
            <p role="alert" className="text-destructive">
              {publish.error.message}
            </p>
          ) : !publish.data?.is_public ? (
            <p>
              This form is internal. Enable Public in its form settings before
              sharing it.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="ticket-form-share-url">Direct form link</Label>
                <Input
                  id="ticket-form-share-url"
                  readOnly
                  value={url}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void copy(url, "Form link")}
                  >
                    Copy link
                  </Button>
                  <Button asChild variant="outline">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      Open form
                    </a>
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticket-form-iframe">Website iframe code</Label>
                <Textarea
                  id="ticket-form-iframe"
                  className="min-h-28 font-mono text-xs"
                  readOnly
                  value={iframe}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  variant="outline"
                  onClick={() => void copy(iframe, "Iframe code")}
                >
                  Copy iframe
                </Button>
              </div>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  Websites allowed to embed this form
                </p>
                {publish.data.allowed_domains.length ? (
                  <ul className="mt-2 list-inside list-disc">
                    {publish.data.allowed_domains.map((domain) => (
                      <li key={domain}>{domain}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">
                    The direct link works now. Add your website origin in
                    Ticketing Setup → Allowed domains before embedding on
                    another website.
                  </p>
                )}
                <p className="mt-2 text-muted-foreground">
                  Use HTTPS links on your live website. A localhost link works
                  only on your development machine.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? "Hide preview" : "Preview form"}
              </Button>
              {preview && (
                <iframe
                  title="Ticket form preview"
                  src={url}
                  className="h-[28rem] w-full rounded-md border"
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
