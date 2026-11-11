/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import * as React from "react";
import { createPortal } from "react-dom";
import { ERPListingScope } from "@/components/erp/listing/listing-scope";
import { usePageFlow } from "@/components/erp/workspace/page-flow";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type DialogContextValue = {
  open: boolean;
  page: boolean;
  id: string;
  setOpen: (value: boolean) => void;
};
const DialogContext = React.createContext<DialogContextValue | null>(null);
export const useDialogPresentation = () => React.useContext(DialogContext);
function Dialog({
  presentation,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  presentation?: "page" | "modal";
}) {
  const flow = usePageFlow();
  const id = React.useId();
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const page = presentation !== "modal" && Boolean(flow);
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [controlledOpen, onOpenChange],
  );
  return (
    <DialogContext.Provider value={{ open, page, id, setOpen }}>
      <DialogPrimitive.Root
        {...props}
        open={open}
        onOpenChange={setOpen}
        modal={page ? false : props.modal}
      >
        {children}
      </DialogPrimitive.Root>
    </DialogContext.Provider>
  );
}
function textContent(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (React.isValidElement<{ children?: React.ReactNode }>(value))
    return textContent(value.props.children);
  return "";
}
function pageTitle(value: React.ReactNode): string {
  let title = "";
  React.Children.forEach(value, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child) || title)
      return;
    const name = (child.type as { displayName?: string }).displayName;
    title =
      name === "DialogTitle" || name === "SheetTitle"
        ? textContent(child.props.children)
        : pageTitle(child.props.children);
  });
  return title;
}
const PageDialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(
  (
    {
      children,
      className,
      style,
      onOpenAutoFocus,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onPointerDownOutside,
      onInteractOutside,
      onFocusOutside,
      ...props
    },
    ref,
  ) => {
    const dialog = useDialogPresentation()!;
    const flow = usePageFlow()!;
    const [node] = React.useState(() => document.createElement("div"));
    const close = React.useRef(dialog.setOpen);
    close.current = dialog.setOpen;
    const title = pageTitle(children) || "Record details";
    React.useLayoutEffect(() => {
      if (dialog.open)
        flow.add({
          id: dialog.id,
          node,
          title,
          close: () => close.current(false),
        });
      else flow.remove(dialog.id);
    }, [dialog.open, dialog.id, flow.add, flow.remove, node, title]);
    React.useEffect(
      () => () => flow.remove(dialog.id),
      [dialog.id, flow.remove],
    );
    React.useEffect(() => {
      if (dialog.open)
        requestAnimationFrame(() =>
          node
            .querySelector<HTMLElement>(
              "input:not([type=hidden]), textarea, select, button",
            )
            ?.focus(),
        );
    }, [dialog.open, node]);
    const recordChanged = (target: EventTarget) => {
      const element = target as HTMLElement;
      return (
        !element.closest(
          "[data-erp-table-toolbar],[data-erp-pagination],.erp-toolbar-filter-panel,[role=search]",
        ) &&
        !/^(?:search|filter)\b/i.test(
          element.getAttribute("aria-label") ||
            element.getAttribute("placeholder") ||
            "",
        )
      );
    };
    if (!dialog.open) return null;
    return createPortal(
      <div
        {...props}
        ref={ref}
        role="region"
        aria-label={title}
        data-workspace-record-page
        className={cn(
          "relative grid w-full gap-5 rounded-xl border bg-card p-5 text-card-foreground md:p-6",
          className,
        )}
        style={{
          ...style,
          position: "relative",
          inset: "auto",
          transform: "none",
          width: "100%",
          maxWidth: "none",
          maxHeight: "none",
        }}
        // Bubble after field handlers; capture updates can reset controlled inputs.
        onChange={(event) => {
          props.onChange?.(event);
          if (recordChanged(event.target)) flow.change(dialog.id);
        }}
        onInput={(event) => {
          props.onInput?.(event);
          if (recordChanged(event.target)) flow.change(dialog.id);
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            flow.close(dialog.id);
          }
        }}
      >
        <ERPListingScope>{children}</ERPListingScope>
        <button
          type="button"
          onClick={() => flow.close(dialog.id)}
          className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close this page"
        >
          <X className="h-4 w-4" />
        </button>
      </div>,
      node,
    );
  },
);
PageDialogContent.displayName = "PageDialogContent";

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const presentation = useDialogPresentation();
  if (presentation?.page)
    return (
      <PageDialogContent ref={ref} className={className} {...props}>
        {children}
      </PageDialogContent>
    );
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
