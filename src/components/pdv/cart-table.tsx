import { Minus, Plus, ScanBarcode, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { parseQuantity } from "@/lib/pdv-sale";
import { cn } from "@/lib/utils";
import type { PricedLine } from "./sale-model";

type Props = {
  lines: PricedLine[];
  /** Texto de comissao por linha, no mesmo indice de `lines`. */
  commission?: (string | null)[];
  selectedId: number | null;
  onSelect: (variantId: number) => void;
  onQty: (variantId: number, qty: number) => void;
  onRemove: (variantId: number) => void;
  /** Ultimo item adicionado; `n` muda a cada adicao pra reanimar a mesma linha. */
  flash: { id: number; n: number } | null;
};

/**
 * Itens da venda. Tabela, nao cartoes: com cartao de 112px por item, um
 * monitor de 1366x768 mostrava UM item inteiro -- o operador rolava pra ver
 * a propria venda. Em linha de 52px cabem dez.
 */
export function CartTable({ lines, commission, selectedId, onSelect, onQty, onRemove, flash }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId == null) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-variant="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, flash?.n]);

  return (
    <section className="pdv-cart" aria-label="Itens da venda">
      <div ref={scrollRef} className="pdv-cart-scroll">
        <table>
          <thead>
            <tr>
              <th className="w-10 text-right">#</th>
              <th className="pdv-col-code w-36">Código</th>
              <th>Produto</th>
              <th className="w-32 text-center">Qtd</th>
              <th className="w-28 text-right">Unitário</th>
              <th className="pdv-col-disc w-24 text-right">Desconto</th>
              <th className="w-28 text-right">Total</th>
              <th className="w-12">
                <span className="sr-only">Remover</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const selecionada = l.variantId === selectedId;
              const acimaDoEstoque = l.qty > l.stock;
              const comissao = commission?.[i];
              return (
                <tr
                  key={l.variantId}
                  // Comissao por item no tooltip, nao na linha: escrita ali ela
                  // quebrava em quatro linhas numa tela estreita e dobrava a
                  // altura do item. O total da comissao ja esta no cupom.
                  title={comissao ?? undefined}
                  data-variant={l.variantId}
                  data-selected={selecionada || undefined}
                  aria-selected={selecionada}
                  className={cn(flash?.id === l.variantId && "pdv-row-flash")}
                  style={
                    flash?.id === l.variantId
                      ? { animationName: flash.n % 2 ? "pdv-flash-a" : "pdv-flash-b" }
                      : undefined
                  }
                  onClick={() => onSelect(l.variantId)}
                >
                  <td className="num text-muted-foreground">{i + 1}</td>
                  <td className="pdv-col-code">
                    <span className="block truncate text-xs text-muted-foreground tabular">{l.sku ?? "—"}</span>
                  </td>
                  <td className="min-w-0">
                    <span className="block truncate font-medium">{l.label}</span>
                    {l.promoName || acimaDoEstoque || l.sku ? (
                      <span className="flex items-center gap-x-2 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
                        <span className="pdv-sku-inline shrink-0 tabular">{l.sku}</span>
                        {acimaDoEstoque ? (
                          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-warning">
                            <TriangleAlert className="size-3" />
                            {l.stock <= 0 ? "sem estoque" : `estoque ${l.stock}`}
                          </span>
                        ) : null}
                        {l.promoName ? <span className="truncate font-medium text-primary">{l.promoName}</span> : null}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-center">
                    <QtyStepper
                      label={l.label}
                      value={l.qty}
                      onChange={(q) => onQty(l.variantId, q)}
                    />
                  </td>
                  <td className="num">{formatBRL(l.sellPrice)}</td>
                  <td className={cn("pdv-col-disc num", l.lineDiscount > 0 ? "text-primary" : "text-muted-foreground")}>
                    {l.lineDiscount > 0 ? `− ${formatBRL(l.lineDiscount)}` : "—"}
                  </td>
                  <td className="num font-semibold">{formatBRL(l.sellPrice * l.qty - l.lineDiscount)}</td>
                  <td className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remover ${l.label} da venda`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(l.variantId);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length === 0 ? (
          <div className="pdv-cart-empty">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <ScanBarcode className="size-6" />
            </span>
            <p className="mt-3 font-medium">Nenhum item na venda</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Leia o código de barras ou busque o produto pelo nome ou SKU.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * −/+ e o numero editavel no meio. O campo guarda o texto enquanto se
 * digita e so aplica ao confirmar (Enter ou sair do campo): aplicar a cada
 * tecla transformaria "12" em 1 e depois 12, recalculando promocao e
 * comissao no meio do caminho.
 */
function QtyStepper({ label, value, onChange }: { label: string; value: number; onChange: (q: number) => void }) {
  const [texto, setTexto] = useState(String(value));
  useEffect(() => setTexto(String(value).replace(".", ",")), [value]);

  function aplicar() {
    const q = parseQuantity(texto);
    if (q == null) setTexto(String(value).replace(".", ","));
    else if (q !== value) onChange(q);
  }

  return (
    <div className="pdv-qty" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={`Diminuir quantidade de ${label}`}
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        inputMode="decimal"
        aria-label={`Quantidade de ${label}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={aplicar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setTexto(String(value).replace(".", ","));
            e.currentTarget.blur();
          }
        }}
      />
      <button type="button" aria-label={`Aumentar quantidade de ${label}`} onClick={() => onChange(value + 1)}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
