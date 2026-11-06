import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      {/* Veu sempre escuro: `bg-foreground/40` virava um veu CLARO no tema
          escuro (foreground e claro la), lavando a tela inteira de cinza. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 dark:bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          // [container-type:inline-size]: sem isto, um `@container` sem
          // nome (ver styles.css, .field-grid-2/3) usado dentro de um
          // diálogo não encontra NENHUM ancestral com container query --
          // o Dialog é Portal do Radix pro document.body, fora de
          // `.content-pane` (que só cobre a página por trás dele).
          // max-h-[85vh] + overflow-y-auto por padrao: antes cada tela
          // decidia uma altura diferente (90vh/88vh/85vh) ou nenhuma, e
          // "nenhuma" deixava o dialogo vazar pra fora da tela em telas
          // baixas quando o conteudo era grande (recibo + bloco de NFC-e +
          // comissao, por exemplo). Uma tela que já passa seu proprio
          // max-h/overflow via className continua vencendo (cn funde por
          // ultimo), isto so cobre quem nao decidia nada.
          "fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-pop outline-none [container-type:inline-size] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {/* rounded-full, nao rounded-md: todo OUTRO botao so-icone do app
            (button.tsx, variante "icon") e circular -- este X era o unico
            quadrado com canto arredondado, mesmo visual mas linguagem
            diferente. */}
        <DialogPrimitive.Close className="absolute top-3 right-3 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-5 grid gap-1 pr-10", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-display text-xl font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-6 flex flex-wrap justify-end gap-2", className)} {...props} />;
}
