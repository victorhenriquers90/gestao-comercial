import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
  Sem isto, uma URL invalida caia no padrao sem estilo do TanStack Router,
  em ingles -- unico lugar do app sem a cara do resto do sistema.
*/
export function AppNotFoundComponent() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <span
        className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Compass className="size-7" strokeWidth={2} />
      </span>
      <h1 className="font-display text-xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        Esse endereço não existe ou foi movido.
      </p>
      <Button asChild>
        <Link to="/app">Ir para o início</Link>
      </Button>
    </main>
  );
}
