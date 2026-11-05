import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * So pro `ConfirmBar` (shared.tsx) -- confirmação de ação perigosa
 * (cancelar, pagar, excluir), nunca cancelável sem querer. Igual ao
 * `Dialog` (dialog.tsx), mas com `role="alertdialog"` em vez de
 * `"dialog"` -- é o Radix quem decide isso, não uma prop nossa.
 */
export const AlertDialog = AlertDialogPrimitive.Root;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:bg-black/60" />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-[60] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-pop outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("font-display text-lg font-medium tracking-tight", className)}
      {...props}
    />
  );
}

/** sr-only: o título do ConfirmBar já é a pergunta inteira ("Pagar X? Não dá pra desfazer"), nada a somar na tela. */
export function AlertDialogDescription(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Description>,
) {
  return <AlertDialogPrimitive.Description className="sr-only" {...props} />;
}

export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
