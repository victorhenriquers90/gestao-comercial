import { Button } from "@/components/ui/button";
import { APP_NAME, PAYMENT_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime, formatDoc, formatQty } from "@/lib/format";

export type ReceiptItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};

export type ReceiptPay = {
  method: string;
  amount: number;
};

export type ReceiptData = {
  number: number;
  soldAt: string;
  storeName?: string | null;
  customerName?: string | null;
  customerDocument?: string | null;
  sellerName?: string | null;
  notes?: string | null;
  items: ReceiptItem[];
  payments: ReceiptPay[];
  subtotal: number;
  discount: number;
  total: number;
};

export type ReceiptCompany = {
  name?: string | null;
  trade_name?: string | null;
  document?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  print_header?: string | null;
  print_footer?: string | null;
  receipt_message?: string | null;
};

export function Receipt({
  data,
  company,
  onClose,
}: {
  data: ReceiptData;
  company?: ReceiptCompany | null;
  onClose?: () => void;
}) {
  const title = company?.trade_name || company?.name || APP_NAME;
  const city = [company?.city, company?.state].filter(Boolean).join(" / ");

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
          <p className="text-sm font-semibold tracking-wide uppercase">{title}</p>
          {company?.print_header ? <p>{company.print_header}</p> : null}
          {company?.document ? <p>CNPJ {formatDoc(String(company.document))}</p> : null}
          {company?.address ? <p>{company.address}</p> : null}
          {city ? <p>{city}</p> : null}
          {company?.phone ? <p>{company.phone}</p> : null}
        </header>
        <hr className="my-2 border-dashed border-black/40" />
        <p>Cupom nº {data.number}</p>
        <p>{formatDateTime(data.soldAt)}</p>
        {data.storeName ? <p>Loja: {data.storeName}</p> : null}
        <p>Cliente: {data.customerName || "Consumidor"}</p>
        {data.customerDocument ? (
          <p>
            {data.customerDocument.replace(/\D/g, "").length === 14 ? "CNPJ" : "CPF"}: {formatDoc(data.customerDocument)}
          </p>
        ) : null}
        {data.sellerName ? <p>Vendedor: {data.sellerName}</p> : null}
        <hr className="my-2 border-dashed border-black/40" />
        {data.items.map((item, i) => (
          <div key={i} className="mb-1">
            <p>{item.description}</p>
            <p className="flex justify-between">
              <span>
                {formatQty(item.quantity)} × {formatBRL(item.unitPrice)}
                {item.discount > 0 ? ` − ${formatBRL(item.discount)}` : ""}
              </span>
              <span>{formatBRL(item.total)}</span>
            </p>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black/40" />
        <p className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatBRL(data.subtotal)}</span>
        </p>
        {data.discount > 0 ? (
          <p className="flex justify-between">
            <span>Desconto</span>
            <span>{formatBRL(data.discount)}</span>
          </p>
        ) : null}
        <p className="flex justify-between text-sm font-semibold">
          <span>TOTAL</span>
          <span>{formatBRL(data.total)}</span>
        </p>
        <hr className="my-2 border-dashed border-black/40" />
        {data.payments.map((p, i) => (
          <p key={i} className="flex justify-between">
            <span>{PAYMENT_LABELS[p.method as keyof typeof PAYMENT_LABELS] ?? p.method}</span>
            <span>{formatBRL(p.amount)}</span>
          </p>
        ))}
        {data.notes ? <p className="mt-2">Obs.: {data.notes}</p> : null}
        <hr className="my-2 border-dashed border-black/40" />
        <p className="text-center">
          {company?.receipt_message || "Obrigado pela preferência."}
        </p>
        {company?.print_footer ? <p className="mt-1 text-center">{company.print_footer}</p> : null}
      </article>
    </div>
  );
}
