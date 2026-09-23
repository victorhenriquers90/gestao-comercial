import {
  Banknote,
  CalendarClock,
  CircleCheck,
  CreditCard,
  Plus,
  QrCode,
  Ticket,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { MAX_INSTALLMENTS } from "@/lib/card";
import { CARD_BRANDS, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/constants";
import { MAX_CREDIARIO_INSTALLMENTS } from "@/lib/crediario";
import { formatBRL } from "@/lib/format";
import { valorDigitado, type PaymentStatus } from "@/lib/pdv-sale";
import { cn } from "@/lib/utils";
import { emptyPay, PDV_FINISH_CLASS, resumoCrediario, type PayRow } from "./sale-model";

const METODO: Record<PaymentMethod, { icon: LucideIcon; curto: string }> = {
  dinheiro: { icon: Banknote, curto: "Dinheiro" },
  pix: { icon: QrCode, curto: "PIX" },
  debito: { icon: WalletCards, curto: "Débito" },
  credito: { icon: CreditCard, curto: "Crédito" },
  crediario: { icon: CalendarClock, curto: "Crediário" },
  vale: { icon: Ticket, curto: "Vale" },
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  total: number;
  payments: PayRow[];
  onPayments: (rows: PayRow[]) => void;
  pay: PaymentStatus;
  hasCustomer: boolean;
  commissionNote: string | null;
  busy: boolean;
  onConfirm: () => void;
};

/**
 * Recebimento. Os quatro numeros que o operador fala em voz alta (total,
 * recebido, falta, troco) ficam em cima, grandes; antes eram uma frase de
 * 14px e o troco so aparecia quando ja era positivo.
 *
 * <form>: Enter em qualquer campo finaliza -- o fluxo de dinheiro vira
 * F8, digita o recebido, Enter. Sem mouse.
 */
export function PaymentDialog(p: Props) {
  const falta = p.pay.remaining > 0.05;
  // "Recebido" e o que o cliente ENTREGOU: no dinheiro, a nota que ele deu
  // (R$ 1.500), nao o valor cobrado (R$ 1.099,49). E o numero que o
  // operador confere antes de dar o troco.
  const entregue = p.payments.reduce(
    (a, r) => a + (r.method === "dinheiro" && r.received.trim() ? valorDigitado(r.received) : valorDigitado(r.amount)),
    0,
  );

  function set(idx: number, patch: Partial<PayRow>) {
    p.onPayments(p.payments.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function trocarMetodo(idx: number, method: PaymentMethod) {
    const row = p.payments[idx]!;
    // Virando dinheiro: o recebido comeca igual ao valor, pra o troco
    // partir de zero em vez de mostrar "falta" de um campo vazio.
    set(idx, { method, received: method === "dinheiro" && !row.received ? row.amount : row.received });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!p.busy) p.onConfirm();
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle>Pagamento</DialogTitle>
          <DialogDescription className="sr-only">
            Escolha a forma de pagamento, informe os valores e finalize a venda.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit}>
          <div className="pdv-pay-stats">
            <Stat label="Total" value={formatBRL(p.total)} strong />
            <Stat label="Recebido" value={formatBRL(entregue)} />
            <Stat
              label={p.pay.remaining < -0.005 ? "A mais" : "Falta"}
              value={formatBRL(Math.abs(p.pay.remaining))}
              tone={falta ? "warning" : undefined}
            />
            <Stat label="Troco" value={formatBRL(p.pay.change)} tone={p.pay.change > 0.004 ? "success" : undefined} />
          </div>

          <div className="mt-4 max-h-[min(24rem,45vh)] space-y-3 overflow-y-auto pr-1">
            {p.payments.map((row, idx) => (
              <fieldset key={idx} className="rounded-md border border-border p-3">
                <legend className="sr-only">Forma de pagamento {idx + 1}</legend>
                <div className="flex items-start gap-2">
                  <div className="pdv-methods" role="radiogroup" aria-label="Forma de pagamento">
                    {PAYMENT_METHODS.map((m) => {
                      const { icon: Icon, curto } = METODO[m];
                      const ativo = row.method === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={ativo}
                          title={PAYMENT_LABELS[m]}
                          className={cn("pdv-method", ativo && "is-active")}
                          onClick={() => trocarMetodo(idx, m)}
                        >
                          <Icon className="size-4" />
                          {curto}
                        </button>
                      );
                    })}
                  </div>
                  {p.payments.length > 1 ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="shrink-0 rounded-sm"
                      aria-label={`Remover ${PAYMENT_LABELS[row.method]}`}
                      onClick={() => p.onPayments(p.payments.filter((_, i) => i !== idx))}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <MoneyField
                    label="Valor"
                    value={row.amount}
                    onChange={(v) => set(idx, { amount: v })}
                    autoFocus={idx === 0 && row.method !== "dinheiro"}
                  />
                  {row.method === "dinheiro" ? (
                    <MoneyField
                      label="Valor recebido"
                      value={row.received}
                      onChange={(v) => set(idx, { received: v })}
                      autoFocus={idx === 0}
                      hint={
                        row.received.trim() && valorDigitado(row.received) + 0.004 < valorDigitado(row.amount)
                          ? "Menor que o valor em dinheiro."
                          : undefined
                      }
                    />
                  ) : null}

                  {/* Bandeira vale pros DOIS cartoes: e o que casa a venda com o
                      extrato da adquirente. Parcelas so no credito. */}
                  {row.method === "credito" || row.method === "debito" ? (
                    <Field label="Bandeira">
                      <Select className="rounded-sm" value={row.brand} onChange={(e) => set(idx, { brand: e.target.value })}>
                        <option value="">Selecione…</option>
                        {CARD_BRANDS.map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  {row.method === "credito" ? (
                    <Field label="Parcelas">
                      <Input
                        className="rounded-sm tabular"
                        type="number"
                        min={1}
                        max={MAX_INSTALLMENTS}
                        value={row.installments}
                        onChange={(e) => set(idx, { installments: Number(e.target.value) })}
                      />
                    </Field>
                  ) : null}
                  {row.method === "credito" || row.method === "debito" ? (
                    <Field label="NSU / autorização" className={row.method === "debito" ? undefined : "col-span-2"}>
                      <Input
                        className="rounded-sm"
                        value={row.nsu}
                        placeholder="Opcional"
                        onChange={(e) => set(idx, { nsu: e.target.value })}
                      />
                    </Field>
                  ) : null}

                  {/* Crediario tambem parcela; o resumo e o que o operador FALA
                      pro cliente, na mesma divisao que o servidor grava. */}
                  {row.method === "crediario" ? (
                    <Field label="Parcelas">
                      <Input
                        className="rounded-sm tabular"
                        type="number"
                        min={1}
                        max={MAX_CREDIARIO_INSTALLMENTS}
                        value={row.installments}
                        onChange={(e) => set(idx, { installments: Number(e.target.value) })}
                      />
                    </Field>
                  ) : null}
                </div>
                {row.method === "crediario" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {resumoCrediario(row) ?? "Informe valor e parcelas."}
                    {!p.hasCustomer ? (
                      <span className="block text-warning">Crediário exige cliente: informe o CPF (F4).</span>
                    ) : null}
                  </p>
                ) : null}
              </fieldset>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-sm"
              onClick={() =>
                p.onPayments([
                  ...p.payments,
                  { ...emptyPay("pix"), amount: p.pay.remaining > 0 ? p.pay.remaining.toFixed(2).replace(".", ",") : "" },
                ])
              }
            >
              <Plus className="size-4" />
              Dividir pagamento
            </Button>
            {p.commissionNote ? (
              <p className="truncate text-xs text-muted-foreground">{p.commissionNote}</p>
            ) : null}
          </div>

          <div className="mt-5 flex gap-2">
            <Button type="button" variant="ghost" className="h-12 rounded-sm" onClick={() => p.onOpenChange(false)}>
              Voltar
              <Kbd>Esc</Kbd>
            </Button>
            <Button type="submit" className={cn(PDV_FINISH_CLASS, "w-auto flex-1")} disabled={p.busy || falta}>
              {p.busy ? (
                <>
                  <Spinner className="size-5" tone="inverse" />
                  Finalizando…
                </>
              ) : falta ? (
                `Faltam ${formatBRL(p.pay.remaining)}`
              ) : (
                <>
                  <CircleCheck className="size-5" />
                  Finalizar venda
                  <Kbd tone="on-primary" className="ml-auto">
                    Enter
                  </Kbd>
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "warning" | "success";
}) {
  return (
    <div
      className={cn(
        "pdv-pay-stat",
        tone === "warning" && "is-warning",
        tone === "success" && "is-success",
        strong && "is-strong",
      )}
    >
      <span className="ed-label">{label}</span>
      <span className="pdv-pay-stat-value">{value}</span>
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  autoFocus,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
          R$
        </span>
        <Input
          className="h-11 rounded-sm pl-9 text-base tabular"
          inputMode="decimal"
          value={value}
          autoFocus={autoFocus}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {hint ? (
        <p className="text-xs text-warning" role="status">
          {hint}
        </p>
      ) : null}
    </Field>
  );
}
