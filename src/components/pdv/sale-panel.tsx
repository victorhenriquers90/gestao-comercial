import {
  CircleCheck,
  MessageSquareText,
  Pause,
  Percent,
  Play,
  UserRound,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { PAYMENT_LABELS } from "@/lib/constants";
import { formatBRL, formatDoc } from "@/lib/format";
import { valorDigitado, type PaymentStatus, type SaleSummary } from "@/lib/pdv-sale";
import { cn } from "@/lib/utils";
import { PDV_FINISH_CLASS, type PayRow } from "./sale-model";

type Seller = { id: number; name: string };

type Props = {
  summary: SaleSummary;
  customerName: string | null;
  customerDoc: string;
  /** Venda comecou sem documento nem cliente: lembrar de perguntar. */
  askDoc: boolean;
  onCustomer: () => void;
  sellers: Seller[];
  sellerId: number | null;
  onSeller: (id: number | null) => void;
  payments: PayRow[];
  pay: PaymentStatus;
  onPay: () => void;
  onDiscount: () => void;
  onClearDiscount: () => void;
  commission: {
    show: boolean;
    amount: number;
    net: number | null;
    warnNoSeller: boolean;
    hints: { key: string; text: string; tone?: "bonus" }[];
  };
  notes: string;
  onNotes: (v: string) => void;
  heldCount: number;
  onHold: () => void;
  onHeld: () => void;
  onCancel: () => void;
  onFinish: () => void;
  busy: boolean;
  registerOpen: boolean;
};

/**
 * O cupom: quem, quanto, como paga e o que fazer. Ordem de leitura de cima
 * pra baixo e a ordem da venda; o TOTAL e a maior coisa da tela e o
 * Finalizar e a unica acao solida. Secoes separadas por filete, nao por
 * caixas -- caixa dentro de caixa era o que dava cara de rascunho.
 */
export function SalePanel(p: Props) {
  const vazio = p.summary.lines === 0;
  const [notasAbertas, setNotasAbertas] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  const podeFinalizar = !vazio && p.registerOpen && !p.busy;
  const motivoBloqueio = !p.registerOpen ? "Caixa fechado" : vazio ? "Adicione um produto" : null;

  return (
    <aside className="pdv-side" aria-label="Cupom da venda">
      {/* QUEM */}
      <div className="pdv-section">
        <button
          type="button"
          onClick={p.onCustomer}
          className={cn("pdv-customer", p.askDoc && "is-asking")}
          aria-label="Cliente e documento na nota"
        >
          <UserRound className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-left">
            {p.customerName || p.customerDoc ? (
              <>
                <span className="block truncate text-sm font-medium">{p.customerName ?? "Consumidor"}</span>
                {p.customerDoc ? (
                  <span className="block truncate text-xs text-muted-foreground tabular">
                    {formatDoc(p.customerDoc)}
                  </span>
                ) : null}
              </>
            ) : p.askDoc ? (
              <>
                <span className="block text-sm font-medium">CPF na nota?</span>
                <span className="block text-xs">Pergunte ao cliente</span>
              </>
            ) : (
              <span className="block text-sm text-muted-foreground">Consumidor não identificado</span>
            )}
          </span>
          <Kbd>F4</Kbd>
        </button>
        <label className="mt-2 flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">Vendedor</span>
          <Select
            className="h-9 rounded-sm text-sm"
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
      <div className="pdv-section">
        <dl className="space-y-1 text-sm">
          <SumRow label="Subtotal" value={formatBRL(p.summary.gross)} />
          {p.summary.promo > 0.004 ? (
            <SumRow label="Promoções" value={`− ${formatBRL(p.summary.promo)}`} tone="primary" />
          ) : null}
          {p.summary.manual > 0.004 ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1 text-muted-foreground">
                Desconto
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Remover desconto"
                  onClick={p.onClearDiscount}
                >
                  <X className="size-3" />
                </button>
              </dt>
              <dd className="tabular text-primary">− {formatBRL(p.summary.manual)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="pdv-total" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="ed-label">Total</span>
            <span className="text-xs text-muted-foreground tabular">
              {vazio
                ? "nenhum item"
                : `${p.summary.lines} ${p.summary.lines === 1 ? "item" : "itens"} · ${formatQtd(p.summary.pieces)} ${p.summary.pieces === 1 ? "peça" : "peças"}`}
            </span>
          </div>
          <p className="pdv-total-value">{formatBRL(p.summary.total)}</p>
        </div>
      </div>

      {/* COMO PAGA */}
      <div className="pdv-section">
        <div className="flex items-center justify-between">
          <span className="ed-label">Pagamento</span>
          <Button variant="ghost" size="sm" className="-mr-2 h-7 gap-1.5 rounded-sm px-2" onClick={p.onPay} disabled={vazio}>
            {p.pay.informed ? "Alterar" : "Informar"}
            <Kbd>F8</Kbd>
          </Button>
        </div>
        {p.pay.informed ? (
          <ul className="mt-1 space-y-0.5 text-sm">
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
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {vazio
              ? "Informe depois de incluir os produtos."
              : "Não informado. Finalizar registra em dinheiro, no valor exato."}
          </p>
        )}
        {p.commission.show || p.commission.warnNoSeller ? (
          <div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
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
        <div className="pdv-section">
          <label className="ed-label" htmlFor="pdv-notes">
            Observação
          </label>
          <textarea
            id="pdv-notes"
            rows={2}
            maxLength={500}
            autoFocus={notasAbertas && !p.notes}
            className="mt-1 w-full resize-none rounded-sm border border-input bg-card px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            placeholder="Vai no registro da venda"
            value={p.notes}
            onChange={(e) => p.onNotes(e.target.value)}
            onBlur={() => !p.notes && setNotasAbertas(false)}
          />
        </div>
      ) : null}

      <div className="pdv-actions">
        <div className="grid grid-cols-2 gap-2">
          <SecondaryAction icon={<Percent />} label="Desconto" kbd="F6" onClick={p.onDiscount} disabled={vazio} />
          <SecondaryAction icon={<Pause />} label="Guardar" kbd="F9" onClick={p.onHold} disabled={vazio} />
          <SecondaryAction
            icon={<Play />}
            label="Recuperar"
            onClick={p.onHeld}
            badge={p.heldCount || undefined}
          />
          <SecondaryAction
            icon={<MessageSquareText />}
            label="Observação"
            onClick={() => setNotasAbertas(true)}
            active={Boolean(p.notes)}
          />
        </div>

        <Button
          className={PDV_FINISH_CLASS}
          onClick={p.onFinish}
          disabled={!podeFinalizar}
          aria-describedby={motivoBloqueio ? "pdv-finish-why" : undefined}
        >
          {p.busy ? (
            <>
              <Spinner className="size-5" tone="inverse" />
              Finalizando…
            </>
          ) : (
            <>
              <CircleCheck className="size-5" />
              Finalizar venda
              <Kbd tone="on-primary" className="ml-auto">
                F10
              </Kbd>
            </>
          )}
        </Button>
        {motivoBloqueio && !p.busy ? (
          <p id="pdv-finish-why" className="-mt-1 text-center text-xs text-muted-foreground">
            {motivoBloqueio}
          </p>
        ) : null}

        <div className="flex min-h-8 items-center justify-center">
          {confirmarCancelar ? (
            <div className="flex items-center gap-2 text-sm" role="alertdialog" aria-label="Confirmar cancelamento">
              <span className="text-muted-foreground">Cancelar esta venda?</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 rounded-sm"
                onClick={() => {
                  setConfirmarCancelar(false);
                  p.onCancel();
                }}
              >
                Sim, cancelar
              </Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-sm" onClick={() => setConfirmarCancelar(false)}>
                Não
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="rounded-xs px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
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

function SecondaryAction({
  icon,
  label,
  kbd,
  badge,
  active,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  kbd?: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      title={kbd ? `${label} (${kbd})` : label}
      className={cn(
        "pdv-secondary h-10 justify-start gap-2 rounded-sm px-3 text-sm font-normal [&_svg]:size-4 [&_svg]:text-muted-foreground",
        active && "border-primary/40 bg-accent/60",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="truncate">{label}</span>
      {kbd ? (
        <Kbd className="ml-auto">{kbd}</Kbd>
      ) : badge ? (
        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[0.6875rem] leading-none font-semibold text-primary-foreground tabular">
          {badge}
        </span>
      ) : null}
    </Button>
  );
}

function formatQtd(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
