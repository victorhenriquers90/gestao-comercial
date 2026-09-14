import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { useOverlayHistory } from "@/hooks/use-overlay-history";
import { cn } from "@/lib/utils";

export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(!!defaultOpen);
  const isControlled = open !== undefined;
  const current = isControlled ? open : uncontrolled;
  const handleOpenChange = useOverlayHistory(current, (next) => {
    if (!isControlled) setUncontrolled(next);
    onOpenChange?.(next);
  });
  return <DialogPrimitive.Root {...props} open={current} onOpenChange={handleOpenChange} />;
}

export function SheetContent({
  className,
  side = "left",
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "left" | "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 motion-reduce:animate-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex h-full w-72 flex-col bg-sidebar text-sidebar-foreground shadow-pop outline-none motion-reduce:animate-none data-[state=open]:animate-in data-[state=closed]:animate-out",
          side === "left"
            ? "inset-y-0 left-0 rounded-r-2xl data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
            : "inset-y-0 right-0 rounded-l-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 flex size-10 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
