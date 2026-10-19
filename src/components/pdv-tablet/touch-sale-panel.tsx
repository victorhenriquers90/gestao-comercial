import { CircleCheck, MessageSquareText, Pause, Percent, Play, UserRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SalePanelProps } from "@/components/pdv/sale-panel";
import { PDV_FINISH_CLASS } from "@/components/pdv/sale-model";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { PAYMENT_LABELS } from "@/lib/constants";
import { formatBRL, formatDoc } from "@/lib/format";
import { valorDigitado } from "@/lib/pdv-sale";
import { cn } from "@/lib/utils";

/**
 * Mesmo cupom do PDV desktop (`SalePanel`), em versão touch: sem atalho de
 * teclado (tablet não tem teclado físico — nada de `<Kbd>`), botões de ação
 * e seletor de vendedor ≥56px, remover-desconto 44px em vez de 20×20 (o
 * menor alvo de toda a tela desktop). Mesma lógica (`SalePanelProps`, vinda
 * de `usePdvSale`), só o layout muda.
 */
export function TouchSalePanel(p: SalePanelProps) {
  const vazio = p.summary.lines === 0;
  const [notasAbertas, setNotasAbertas] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  const podeFinalizar = !vazio && p.registerOpen && !p.busy;
  const motivoBloqueio = !p.registerOpen ? "Caixa fechado" : vazio ? "Adicione um produto" : null;

  return (
    <aside className="pdvt-side" aria-label="Cupom da venda">
      {/* QUEM */}
      <div className="pdvt-section">
        <button
          type="button"
          onClick={p.onCustomer}
          className={cn("pdvt-customer", p.askDoc && "is-asking")}
          aria-label="Cliente e documento na nota"
        >
          <UserRound className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-left">
            {p.customerName || p.customerDoc ? (
              <>
                <span className="block truncate text-base font-medium">{p.customerName ?? "Consumidor"}</span>
                {p.customerDoc ? (
                  <span className="block truncate text-sm text-muted-foreground tabular">
                    {formatDoc(p.customerDoc)}
                  </span>
                ) : null}
              </>
            ) : p.askDoc ? (
              <>
                <span className="block text-base font-medium">CPF na nota?</span>
                <span className="block text-sm">Pergunte ao cliente</span>
              </>
            ) : (
              <span className="block text-base text-muted-foreground">Consumidor não identificado</span>
            )}
          </span>
        </button>
        <label className="mt-3 flex items-center gap-2">
          <span className="w-20 shrink-0 text-sm text-muted-foreground">Vendedor</span>
          <Select
            className="h-14 rounded-sm text-base"
            value={p.sellerId ?? ""}
            onChange={(e) => p.onSeller(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Sem vendedor</option>
            {p.sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {/* QUANTO */}
      <div className="pdvt-section">
        <dl className="space-y-1.5 text-base">
          <SumRow label="Subtotal" value={formatBRL(p.summary.gross)} />
          {p.summary.promo > 0.004 ? (
            <SumRow label="Promoções" value={`− ${formatBRL(p.summary.promo)}`} tone="primary" />
          ) : null}
          {p.summary.manual > 0.004 ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                Desconto
                <button
                  type="button"
                  className="pdvt-remove-discount"
                  aria-label="Remover desconto"
                  onClick={p.onClearDiscount}
                >
                  <X className="size-4" />
                </button>
              </dt>
              <dd className="tabular text-primary">− {formatBRL(p.summary.manual)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="pdvt-total" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="ed-label">Total</span>
            <span className="text-sm text-muted-foreground tabular">
              {vazio
                ? "nenhum item"
                : `${p.summary.lines} ${p.summary.lines === 1 ? "item" : "itens"} · ${formatQtd(p.summary.pieces)} ${p.summary.pieces === 1 ? "peça" : "peças"}`}
            </span>
          </div>
          <p className="pdvt-total-value">{formatBRL(p.summary.total)}</p>
        </div>
      </div>

      {/* COMO PAGA */}
      <div className="pdvt-section">
        <div className="flex items-center justify-between">
          <span className="ed-label">Pagamento</span>
          <Button
            variant="outline"
            className="h-12 rounded-sm px-4 text-base"
            onClick={p.onPay}
            disabled={vazio}
          >
            {p.pay.informed ? "Alterar" : "Informar"}
          </Button>
        </div>
        {p.pay.informed ? (
          <ul className="mt-2 space-y-1 text-base">
            {p.payments
              .filter((x) => valorDigitado(x.amount) > 0)
              .map((x, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {PAYMENT_LABELS[x.method]}
                    {x.method === "credito" && x.installments > 1 ? ` · ${x.installments}x` : ""}
                  </span>
                  <span className="tabular">{formatBRL(valorDigitado(x.amount))}</span>
                </li>
              ))}
            {p.pay.remaining > 0.005 ? (
              <li className="flex justify-between gap-2 font-medium text-warning">
                <span>Falta</span>
                <span className="tabular">{formatBRL(p.pay.remaining)}</span>
              </li>
            ) : null}
            {p.pay.change > 0.004 ? (
              <li className="flex justify-between gap-2 font-medium text-success">
                <span>Troco</span>
                <span className="tabular">{formatBRL(p.pay.change)}</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {vazio
              ? "Informe depois de incluir os produtos."
              : "Não informado. Obrigatório para finalizar a venda."}
          </p>
        )}
        {p.commission.show || p.commission.warnNoSeller ? (
          <div className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
            {p.commission.warnNoSeller ? (
              <p className="text-warning">Sem vendedor: a venda não gera comissão.</p>
            ) : (
              <p className="flex justify-between gap-2">
                <span>Comissão prevista</span>
                <span className="tabular">
                  {formatBRL(p.commission.amount)}
                  {p.commission.net != null ? ` · líquido ${formatBRL(p.commission.net)}` : ""}
                </span>
              </p>
            )}
            {p.commission.hints.length ? (
              <details className="mt-1">
                <summary className="cursor-pointer list-none underline-offset-2 hover:underline">
                  Detalhes da comissão ({p.commission.hints.length})
                </summary>
                <div className="mt-1 space-y-0.5">
                  {p.commission.hints.map((h) => (
                    <p key={h.key} className={cn(h.tone === "bonus" && "text-primary")}>
                      {h.text}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      {notasAbertas || p.notes ? (
        <div className="pdvt-section">
          <label className="ed-label" htmlFor="pdvt-notes">
            Observação
          </label>
          <textarea
            id="pdvt-notes"
            rows={2}
            maxLength={500}
            autoFocus={notasAbertas && !p.notes}
            className="mt-1 w-full resize-none rounded-sm border border-input bg-card px-3 py-2.5 text-base focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            placeholder="Vai no registro da venda"
            value={p.notes}
            onChange={(e) => p.onNotes(e.target.value)}
            onBlur={() => !p.notes && setNotasAbertas(false)}
          />
        </div>
      ) : null}

      <div className="pdvt-actions">
        <div className="grid grid-cols-2 gap-2.5">
          <TouchSecondaryAction icon={<Percent />} label="Desconto" onClick={p.onDiscount} disabled={vazio} />
          <TouchSecondaryAction icon={<Pause />} label="Guardar" onClick={p.onHold} disabled={vazio} />
          <TouchSecondaryAction
            icon={<Play />}
            label="Recuperar"
            onClick={p.onHeld}
            badge={p.heldCount || undefined}
          />
          <TouchSecondaryAction
            icon={<MessageSquareText />}
            label="Observação"
            onClick={() => setNotasAbertas(true)}
            active={Boolean(p.notes)}
          />
        </div>

        <Button className={PDV_FINISH_CLASS} onClick={p.onFinish} disabled={!podeFinalizar}>
          {p.busy ? (
            <>
              <Spinner className="size-5" tone="inverse" />
              Finalizando…
            </>
          ) : (
            <>
              <CircleCheck className="size-5" />
              Finalizar venda
            </>
          )}
        </Button>
        {motivoBloqueio && !p.busy ? (
          <p className="-mt-1 text-center text-sm text-muted-foreground">{motivoBloqueio}</p>
        ) : null}

        <div className="flex min-h-11 items-center justify-center">
          {confirmarCancelar ? (
            <div className="flex items-center gap-2 text-base" role="alertdialog" aria-label="Confirmar cancelamento">
              <span className="text-muted-foreground">Cancelar esta venda?</span>
              <Button
                variant="destructive"
                className="h-11 rounded-sm px-4"
                onClick={() => {
                  setConfirmarCancelar(false);
                  p.onCancel();
                }}
              >
                Sim, cancelar
              </Button>
              <Button variant="ghost" className="h-11 rounded-sm px-4" onClick={() => setConfirmarCancelar(false)}>
                Não
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="rounded-sm px-3 py-2 text-base text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-40"
              disabled={vazio}
              onClick={() => setConfirmarCancelar(true)}
            >
              Cancelar venda
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function SumRow({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular", tone === "primary" && "text-primary")}>{value}</dd>
    </div>
  );
}

function TouchSecondaryAction({
  icon,
  label,
  badge,
  active,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      className={cn(
        "h-14 justify-start gap-2.5 rounded-sm px-4 text-base font-normal [&_svg]:size-5 [&_svg]:text-muted-foreground",
        active && "border-primary/40 bg-accent/60",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="ml-auto grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs leading-none font-semibold text-primary-foreground tabular">
          {badge}
        </span>
      ) : null}
    </Button>
  );
}

function formatQtd(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
