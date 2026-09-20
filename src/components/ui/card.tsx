import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-soft",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-0", className)} {...props} />;
}

/**
 * Titulo do cartao. Usa `ed-title` (18px, Syne), nao `ed-label`.
 *
 * Antes era o kicker de 11px maiusculo em cinza -- ou seja, o titulo do
 * cartao era menor e mais fraco que o conteudo de 14px logo abaixo dele.
 * Quem quiser o kicker editorial continua podendo escrever `ed-label`
 * explicitamente; o que nao pode e um TITULO chamar o rotulo de rodape.
 */
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("ed-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function Separator({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("h-px w-full bg-border", className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("skeleton-sweep rounded-md bg-muted", className)}
      {...props}
    />
  );
}
