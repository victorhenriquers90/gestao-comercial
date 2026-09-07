import { Card } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { TAX_REGIME_LABELS, TAX_TABLE_NOTE, type TaxResult } from "@/lib/tax";
import { cn } from "@/lib/utils";

export function TaxBreakdown({
  tax,
  compact,
}: {
  tax: TaxResult;
  compact?: boolean;
}) {
  if (tax.gross <= 0) return null;
  return (
    <Card className={cn("p-4", compact && "p-3")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {TAX_REGIME_LABELS[tax.regime]}
        </p>
        <p className="text-xs text-muted-foreground">Bruto {formatBRL(tax.gross)}</p>
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        {tax.lines.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma retenção nesta comissão.</p>
        ) : (
          tax.lines.map((l) => (
            <div key={l.key} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="text-foreground">{l.label}</span>
                {l.note && !compact ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{l.note}</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular text-destructive">−{formatBRL(l.amount)}</span>
            </div>
          ))
        )}
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="font-medium">Líquido a pagar</span>
          <span className="font-display text-lg font-medium tabular text-success">{formatBRL(tax.net)}</span>
        </div>
        {tax.employerCost > tax.gross + 0.009 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            Custo da loja {formatBRL(tax.employerCost)}
            {tax.employerInss > 0 ? ` · INSS patronal ${formatBRL(tax.employerInss)}` : ""}
            {tax.employerFgts > 0 ? ` · FGTS ${formatBRL(tax.employerFgts)}` : ""}
          </p>
        ) : null}
      </div>
      {tax.note && !compact ? <p className="mt-3 text-xs text-muted-foreground">{tax.note}</p> : null}
      {!compact ? <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{TAX_TABLE_NOTE}</p> : null}
    </Card>
  );
}
