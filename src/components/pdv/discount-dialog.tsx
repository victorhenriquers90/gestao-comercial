import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Base do desconto: subtotal ja com as promocoes. */
  subtotal: number;
  limitPct: number;
  onApply: (value: number) => void;
};

/** F6: desconto na venda, em R$ ou %, com a previa do novo total. */
export function DiscountDialog(p: Props) {
  const [mode, setMode] = useState<"value" | "pct">("value");
  const [input, setInput] = useState("");

  useEffect(() => {
    if (p.open) setInput("");
  }, [p.open]);

  const n = Number(input.replace(",", "."));
  const valido = input.trim() !== "" && Number.isFinite(n) && n >= 0;
  const valor = !valido ? 0 : mode === "pct" ? Number(((p.subtotal * n) / 100).toFixed(2)) : n;
  const pct = mode === "pct" ? n : p.subtotal ? (n / p.subtotal) * 100 : 0;
  const acimaDoLimite = valido && pct > p.limitPct + 0.05;

  function aplicar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    if (acimaDoLimite) {
      toast.error(`Desconto acima do limite (${p.limitPct}%).`);
      return;
    }
    p.onApply(valor);
    p.onOpenChange(false);
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Desconto na venda</DialogTitle>
          <DialogDescription>Limite do seu perfil: {p.limitPct}%.</DialogDescription>
        </DialogHeader>
        <form onSubmit={aplicar}>
          <div className="grid grid-cols-2 gap-1 rounded-sm bg-muted p-1" role="radiogroup" aria-label="Tipo de desconto">
            {(
              [
                ["value", "Valor (R$)"],
                ["pct", "Percentual (%)"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={cn(
                  "h-8 rounded-xs text-sm font-medium transition-colors",
                  mode === id ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* A unidade fica fixa no campo: "10" pode ser R$ 10 ou 10%, e como
              placeholder ela sumia no primeiro digito. */}
          <Field label={mode === "pct" ? "Desconto em percentual" : "Desconto em reais"} className="mt-block">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                {mode === "pct" ? "%" : "R$"}
              </span>
              <Input
                className="h-11 rounded-sm pl-9 text-base tabular"
                inputMode="decimal"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
          </Field>
          <div className="mt-3 flex items-baseline justify-between rounded-sm bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Novo total</span>
            <span className={cn("font-semibold tabular", acimaDoLimite && "text-destructive")}>
              {formatBRL(Math.max(0, p.subtotal - valor))}
            </span>
          </div>
          {acimaDoLimite ? (
            <p className="mt-1 text-xs text-destructive">Acima do limite de {p.limitPct}% do seu perfil.</p>
          ) : null}
          <Button type="submit" className="mt-5 h-11 w-full rounded-sm" disabled={!valido || acimaDoLimite}>
            Aplicar desconto
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
