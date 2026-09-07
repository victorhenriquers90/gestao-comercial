import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { formatBRL, formatDateTime, formatDoc } from "@/lib/format";
import { slipTitle, type TaxRegime, type TaxResult } from "@/lib/tax";

export type CommissionSlipSale = {
  saleNumber: number | null;
  rule: string;
  gross: number;
  net: number;
};

export type CommissionSlipData = {
  paidAt: string;
  sellerName: string;
  sellerDocument: string | null;
  sellerPhone: string | null;
  regime: TaxRegime;
  sales: CommissionSlipSale[];
  tax: TaxResult;
  companyName: string;
  companyDocument: string | null;
  companyCity: string | null;
  companyState: string | null;
};

export function CommissionSlip({
  data,
  onClose,
  preview,
}: {
  data: CommissionSlipData;
  onClose?: () => void;
  preview?: boolean;
}) {
  const title = slipTitle(data.regime);
  const company = data.companyName || APP_NAME;
  const city = [data.companyCity, data.companyState].filter(Boolean).join(" / ");
  const tax = data.tax;

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
      <article className="receipt-sheet mx-auto w-[80mm] bg-white p-4 font-mono text-[11px] leading-snug text-black">
        <header className="text-center">
          <p className="text-sm font-semibold tracking-wide uppercase">{company}</p>
          {data.companyDocument ? <p>CNPJ {formatDoc(data.companyDocument)}</p> : null}
          {city ? <p>{city}</p> : null}
        </header>
        <hr className="my-2 border-dashed border-black/40" />
        <p className="text-center font-semibold uppercase">{title}</p>
        <p>{formatDateTime(data.paidAt)}</p>
        <p>Vendedor: {data.sellerName}</p>
        {data.sellerDocument ? <p>CPF/CNPJ {formatDoc(data.sellerDocument)}</p> : null}
        {data.sellerPhone ? <p>Tel. {data.sellerPhone}</p> : null}
        <hr className="my-2 border-dashed border-black/40" />
        {data.sales.slice(0, 12).map((s, i) => (
          <p key={i} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {s.saleNumber != null ? `Venda nº ${s.saleNumber}` : "Lançamento"}
              {s.rule ? ` · ${s.rule}` : ""}
            </span>
            <span className="shrink-0">{formatBRL(s.gross)}</span>
          </p>
        ))}
        {data.sales.length > 12 ? (
          <p className="text-center">… +{data.sales.length - 12} lançamentos</p>
        ) : null}
        <hr className="my-2 border-dashed border-black/40" />
        <p className="flex justify-between">
          <span>Bruto</span>
          <span>{formatBRL(tax.gross)}</span>
        </p>
        {tax.lines.map((l) => (
          <p key={l.key} className="flex justify-between">
            <span>{l.label}</span>
            <span>−{formatBRL(l.amount)}</span>
          </p>
        ))}
        <p className="mt-1 flex justify-between text-sm font-semibold">
          <span>LÍQUIDO</span>
          <span>{formatBRL(tax.net)}</span>
        </p>
        {tax.employerCost > tax.gross + 0.009 ? (
          <p className="mt-1 flex justify-between">
            <span>Custo loja</span>
            <span>{formatBRL(tax.employerCost)}</span>
          </p>
        ) : null}
        <hr className="my-2 border-dashed border-black/40" />
        <p className="mt-6 text-center">______________________________</p>
        <p className="text-center">{data.sellerName}</p>
        <p className="mt-2 text-center">
          {preview ? "Simulação — conferência, sem valor de recibo." : "Recebi o líquido acima."}
        </p>
      </article>
    </div>
  );
}
