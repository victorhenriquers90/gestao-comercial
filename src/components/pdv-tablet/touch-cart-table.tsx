import { Minus, Plus, ScanBarcode, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CartTableProps } from "@/components/pdv/cart-table";
import { formatBRL } from "@/lib/format";
import { parseQuantity, stepQty } from "@/lib/pdv-sale";
import { cn } from "@/lib/utils";

/**
 * Mesma tabela de itens do PDV desktop (`CartTable`), em versão touch: linha
 * mais alta, stepper de quantidade e botão de remover com alvo de toque
 * ≥56×56 — o desktop usa 32×32, apertado demais pro dedo. Mesma lógica de
 * dados (`CartTableProps`, vinda de `usePdvSale`), só o layout muda.
 */
export function TouchCartTable({ lines, commission, selectedId, onSelect, onQty, onRemove, flash }: CartTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId == null) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-variant="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, flash?.n]);

  return (
    <section className="pdvt-cart" aria-label="Itens da venda">
      <div ref={scrollRef} className="pdvt-cart-scroll">
        <table>
          <thead>
            <tr>
              <th className="pdvt-col-idx text-right">#</th>
              <th>Produto</th>
              <th className="pdvt-col-qty text-center">Qtd</th>
              <th className="pdvt-col-unit text-right">Unitário</th>
              <th className="pdvt-col-total text-right">Total</th>
              <th className="pdvt-col-rm">
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
                  title={comissao ?? undefined}
                  data-variant={l.variantId}
                  data-selected={selecionada || undefined}
                  aria-selected={selecionada}
                  className={cn(flash?.id === l.variantId && "pdvt-row-flash")}
                  style={
                    flash?.id === l.variantId
                      ? { animationName: flash.n % 2 ? "pdvt-flash-a" : "pdvt-flash-b" }
                      : undefined
                  }
                  onClick={() => onSelect(l.variantId)}
                >
                  <td className="pdvt-col-idx num text-muted-foreground">{i + 1}</td>
                  <td className="min-w-0">
                    <span className="block truncate font-medium">{l.label}</span>
                    {l.promoName || acimaDoEstoque || l.sku ? (
                      <span className="flex items-center gap-x-2 overflow-hidden text-sm whitespace-nowrap text-muted-foreground">
                        <span className="shrink-0 tabular">{l.sku}</span>
                        {acimaDoEstoque ? (
                          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-warning">
                            <TriangleAlert className="size-4" />
                            {l.stock <= 0 ? "sem estoque" : `estoque ${l.stock}`}
                          </span>
                        ) : null}
                        {l.promoName ? <span className="truncate font-medium text-primary">{l.promoName}</span> : null}
                      </span>
                    ) : null}
                  </td>
                  <td className="pdvt-col-qty text-center">
                    <TouchQtyStepper
                      label={l.label}
                      value={l.qty}
                      onChange={(q) => onQty(l.variantId, q)}
                    />
                  </td>
                  <td className="pdvt-col-unit num">{formatBRL(l.sellPrice)}</td>
                  <td className="pdvt-col-total num font-semibold">
                    {formatBRL(l.sellPrice * l.qty - l.lineDiscount)}
                  </td>
                  <td className="pdvt-col-rm">
                    <button
                      type="button"
                      className="pdvt-remove"
                      aria-label={`Remover ${l.label} da venda`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(l.variantId);
                      }}
                    >
                      <Trash2 className="size-5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length === 0 ? (
          <div className="pdvt-cart-empty">
            <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
              <ScanBarcode className="size-7" />
            </span>
            <p className="mt-3 text-lg font-medium">Nenhum item na venda</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Leia o código de barras ou busque o produto pelo nome ou SKU.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TouchQtyStepper({ label, value, onChange }: { label: string; value: number; onChange: (q: number) => void }) {
  const [texto, setTexto] = useState(String(value));
  useEffect(() => setTexto(String(value).replace(".", ",")), [value]);

  function aplicar() {
    const q = parseQuantity(texto);
    if (q == null) setTexto(String(value).replace(".", ","));
    else if (q !== value) onChange(q);
  }

  return (
    <div className="pdvt-qty" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={`Diminuir quantidade de ${label}`}
        disabled={value <= (Number.isInteger(value) ? 1 : 0.001)}
        onClick={() => onChange(stepQty(value, -1))}
      >
        <Minus className="size-5" />
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
      <button type="button" aria-label={`Aumentar quantidade de ${label}`} onClick={() => onChange(stepQty(value, 1))}>
        <Plus className="size-5" />
      </button>
    </div>
  );
}
