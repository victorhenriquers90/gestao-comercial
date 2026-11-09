import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
  Era em ingles ("Something went wrong") com paleta propria (zinc/red-500)
  fora dos tokens do app -- a UNICA tela do sistema que destoava assim,
  justo a que aparece quando algo quebra de verdade. Sem botao nenhum:
  o texto ja dizia "tente recarregar a pagina" mas deixava o visitante
  fazer isso manualmente (F5/Ctrl+R) em vez de so clicar.
*/
export function AppErrorComponent({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : undefined;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <span
        className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden="true"
      >
        <TriangleAlert className="size-7" strokeWidth={2} />
      </span>
      <h1 className="font-display text-xl font-semibold tracking-tight">Algo deu errado</h1>
      <p className="max-w-md text-sm leading-relaxed break-words text-muted-foreground">
        {message || "Ocorreu um erro inesperado. Tente recarregar a página."}
      </p>
      <Button onClick={() => window.location.reload()}>Recarregar</Button>
    </main>
  );
}
