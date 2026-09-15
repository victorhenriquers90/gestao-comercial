import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-transparent bg-muted px-3 text-sm text-foreground shadow-none transition-colors placeholder:text-muted-foreground focus-visible:border-input focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-lg border border-transparent bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-input focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

/**
 * O elemento raiz e um <label> de proposito: antes era uma <div> com um
 * <Label> solto dentro, sem `htmlFor` e sem envolver o campo -- ou seja, o
 * rotulo aparecia na tela mas nao estava associado a nada. Leitor de tela
 * anunciava o campo sem nome, e clicar no texto do rotulo nao focava o
 * campo (num balcao com touch, isso e area de toque desperdicada).
 * Envolver da a associacao implicita, sem precisar gerar id.
 */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="ed-label">{label}</span>
      {children}
    </label>
  );
}
