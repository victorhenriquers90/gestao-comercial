import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tecla de atalho desenhada como tecla (nao como texto entre parenteses).
 * Num PDV o operador trabalha pelo teclado: "F8" e a affordance principal do
 * botao, nao um detalhe do rotulo -- por isso vira um elemento proprio, com
 * peso visual separado do texto da acao.
 *
 * `tone="on-primary"` para quando a tecla fica dentro de um botao de fundo
 * solido (Finalizar), onde a borda/fundo claros do padrao sumiriam.
 */
export function Kbd({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"kbd"> & { tone?: "default" | "on-primary" }) {
  return (
    <kbd
      className={cn(
        // Sem borda propria: com borda + fundo a tecla flutuava como adesivo
        // colado por cima do botao. Um chip chapado, tirado da propria cor do
        // texto, se le como parte da peca.
        "pointer-events-none grid h-5 min-w-7 select-none place-items-center rounded px-1.5 font-sans text-[0.625rem] leading-none font-semibold tracking-wide tabular",
        tone === "on-primary" ? "bg-current/15 text-current" : "bg-foreground/8 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
