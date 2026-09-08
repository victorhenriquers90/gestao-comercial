import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";

export type PriceTagItem = {
  key: string | number;
  title: string;
  subtitle?: string | null;
  price: number;
  code: string | null;
};

export function PriceTags({
  items,
  onClose,
}: {
  items: PriceTagItem[];
  onClose?: () => void;
}) {
  return (
    <div>
      <div className="no-print mb-3 flex justify-end gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          Imprimir
        </Button>
        {onClose ? (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        ) : null}
      </div>
      <div className="tags-sheet flex flex-wrap gap-3 bg-white p-2">
        {items.map((item) => (
          <PriceTagCard key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}

function PriceTagCard({ item }: { item: PriceTagItem }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !item.code) return;
    try {
      JsBarcode(svgRef.current, item.code, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 36,
        width: 1.4,
      });
    } catch {
      // An empty render beats crashing the whole tag sheet over one bad code.
    }
  }, [item.code]);

  return (
    <div className="flex w-[58mm] flex-col items-center gap-1 border border-dashed border-black/30 p-2 text-black">
      <p className="line-clamp-2 text-center text-[10px] leading-tight font-medium uppercase">{item.title}</p>
      {item.subtitle ? <p className="text-[9px] text-black/70">{item.subtitle}</p> : null}
      <p className="font-display text-lg font-semibold tabular">{formatBRL(item.price)}</p>
      {item.code ? (
        <>
          <svg ref={svgRef} className="w-full" />
          <p className="text-[9px] tabular">{item.code}</p>
        </>
      ) : (
        <p className="text-[9px] text-black/50">Sem código</p>
      )}
    </div>
  );
}
