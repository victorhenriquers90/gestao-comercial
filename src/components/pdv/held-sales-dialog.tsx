import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { listHeldFn } from "@/lib/server/commerce";

type Held = Awaited<ReturnType<typeof listHeldFn>>[number];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  held: Held[];
  onResume: (id: number) => void;
  onDiscard: (id: number) => Promise<void>;
};

export function HeldSalesDialog(p: Props) {
  const [descartarId, setDescartarId] = useState<number | null>(null);

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vendas guardadas</DialogTitle>
          <DialogDescription>Recupere para continuar de onde parou.</DialogDescription>
        </DialogHeader>
        {!p.held.length ? (
          <p className="rounded-sm bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma venda guardada nesta loja.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {p.held.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{h.customerName ?? "Consumidor"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {h.items} {h.items === 1 ? "item" : "itens"}
                    {h.sellerName ? ` · ${h.sellerName}` : ""}
                    {h.notes ? ` · ${h.notes}` : ""}
                  </p>
                </div>
                {/* Descarte em duas etapas: apagar uma venda guardada e
                    irreversivel, e o botao fica ao lado do Recuperar. */}
                {descartarId === h.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-muted-foreground">Descartar?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="rounded-sm"
                      onClick={async () => {
                        setDescartarId(null);
                        await p.onDiscard(h.id);
                      }}
                    >
                      Sim
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-sm" onClick={() => setDescartarId(null)}>
                      Não
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" className="rounded-sm" onClick={() => p.onResume(h.id)}>
                      Recuperar
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Descartar venda guardada de ${h.customerName ?? "Consumidor"}`}
                      onClick={() => setDescartarId(h.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
