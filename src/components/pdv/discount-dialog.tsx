import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { formatBRL, formatPct } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Base do desconto: o que o F6 abate (venda) ou o total da linha ja com promocao (item). */
  subtotal: number;
  limitPct: number;
  /**
   * % do operador na venda INTEIRA se `value` for aplicado -- a mesma conta
   * do limite no checkoutFn (ver operatorPctOf). Nao da pra checar so o %
   * do proprio escopo: o servidor soma item e cabecalho.
   */
  operatorPct: (value: number) => number;
  onApply: (value: number) => void;
  /** Titulo do dialogo. Default: "Desconto na venda" (F6, escopo cabecalho). */
  title?: string;
  /** Rotulo do campo "novo total". Default: "Novo total". */
  totalLabel?: string;
  /** Valor ja concedido, pra reabrir editando em vez de sempre começar vazio. */
  initialValue?: number;
  /** Com desconto ja concedido (initialValue > 0), mostra "Remover desconto" junto do botao principal. */
  onRemove?: () => void;
  /** Linha extra abaixo do limite (ex.: item ja em promocao). */
  note?: string;
};

/**
 * F6 (cabecalho) e o botao "Desconto" da coluna do carrinho (por linha,
 * ver cart-table.tsx) usam o MESMO dialogo -- so o titulo, a base do
 * percentual e o que `onApply` faz do lado de fora mudam. Duplicar o
 * dialogo pros dois casos ia divergir em algum detalhe de validacao cedo
 * ou tarde (ja aconteceu antes nesta base com fornecedor/cliente, ver
 * item 153 do HANDOFF).
 */
export function DiscountDialog(p: Props) {
  const [mode, setMode] = useState<"value" | "pct">("value");
  const [input, setInput] = useState("");

  useEffect(() => {
    if (p.open) setInput(p.initialValue ? String(p.initialValue).replace(".", ",") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- so ao ABRIR; reagir a initialValue mudando com o dialogo aberto sobrescreveria o que o operador esta digitando
  }, [p.open]);

  // parseMoneyInput, nao Number(input.replace(",",".")): "1.500" digitado
  // (mil e quinhentos, convencao BR sem casas decimais) virava 1.5 --
  // um desconto de R$1.500 silenciosamente aplicado como R$1,50.
  const n = parseMoneyInput(input);
  const valido = input.trim() !== "" && Number.isFinite(n) && n >= 0;
  const valor = !valido ? 0 : mode === "pct" ? Number(((p.subtotal * n) / 100).toFixed(2)) : n;
  const acimaDoLimite = valido && p.operatorPct(valor) > p.limitPct + 0.05;
  // Desconto do operador no RESTO da venda (este escopo zerado): e o que
  // explica um 5% recusado num limite de 10%.
  //
  // `Number.isFinite`: carrinho com promocao comendo o subtotal inteiro
  // (ex.: item 100% off) devolve Infinity de `operatorDiscountPct` (base
  // zero pra dividir) -- sem a checagem, `formatPct(Infinity)` imprime
  // "0%" (seu proprio fallback pra nao-finito), e a mensagem ficava
  // "...(0%), passa do limite..." -- contraditoria: diz 0% E que estourou.
  const outros = p.operatorPct(0);
  const motivo =
    Number.isFinite(outros) && outros > 0.005
      ? `Somado aos outros descontos desta venda (${formatPct(outros)}), passa do limite de ${p.limitPct}% do seu perfil.`
      : `Acima do limite de ${p.limitPct}% do seu perfil.`;

  function aplicar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    if (acimaDoLimite) {
      toast.error(motivo);
      return;
    }
    p.onApply(valor);
    p.onOpenChange(false);
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{p.title ?? "Desconto na venda"}</DialogTitle>
          <DialogDescription>
            Limite do seu perfil: {p.limitPct}% da venda.
            {p.note ? <span className="mt-1 block">{p.note}</span> : null}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={aplicar}>
          <div
            className="grid grid-cols-2 gap-1 rounded-sm bg-muted p-1"
            role="radiogroup"
            aria-label="Tipo de desconto"
          >
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
                  mode === id
                    ? "bg-card text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* A unidade fica fixa no campo: "10" pode ser R$ 10 ou 10%, e como
              placeholder ela sumia no primeiro digito. */}
          <Field
            label={mode === "pct" ? "Desconto em percentual" : "Desconto em reais"}
            className="mt-block"
          >
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
            <span className="text-muted-foreground">{p.totalLabel ?? "Novo total"}</span>
            <span className={cn("font-semibold tabular", acimaDoLimite && "text-destructive")}>
              {formatBRL(Math.max(0, p.subtotal - valor))}
            </span>
          </div>
          {acimaDoLimite ? <p className="mt-1 text-xs text-destructive">{motivo}</p> : null}
          <div className="mt-5 flex gap-2">
            {p.onRemove && p.initialValue ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-sm"
                onClick={() => {
                  p.onRemove?.();
                  p.onOpenChange(false);
                }}
              >
                Remover
              </Button>
            ) : null}
            <Button
              type="submit"
              className="h-11 flex-1 rounded-sm"
              disabled={!valido || acimaDoLimite}
            >
              Aplicar desconto
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
