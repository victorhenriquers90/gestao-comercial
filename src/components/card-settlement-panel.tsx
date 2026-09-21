import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, KpiCard } from "@/components/shared";
import { BATCH_STATUS_LABELS, compareDeposit, effectiveFeePct } from "@/lib/card-settlement";
import { formatBRL, formatDate } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { runAction } from "@/lib/run-action";
import { listCardSettlementsFn, settleCardBatchFn } from "@/lib/server/card-settlement";

/**
 * Conciliacao de cartao.
 *
 * Um lote por data de liquidacao, porque e assim que o dinheiro chega: um
 * deposito por dia juntando dezenas de vendas. O campo "quanto caiu" e
 * opcional e serve pra CONFERIR -- ele nao muda a baixa, so mostra a
 * diferenca e a taxa efetiva que ela revela.
 */
export function CardSettlementPanel({ storeId }: { storeId: number | null }) {
  const qc = useQueryClient();
  const [informado, setInformado] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const dados = useQuery({
    queryKey: ["card-settlements", storeId],
    queryFn: () => listCardSettlementsFn({ data: { storeId: storeId ?? undefined } }),
  });

  const t = dados.data?.totais;

  return (
    <div className="space-y-block">
      {t ? (
        <div className="kpi-grid">
          <KpiCard label="A receber do cartão" value={formatBRL(t.aReceber)} hint={`${t.lotes} lote(s)`} />
          <KpiCard label="Cai hoje" value={formatBRL(t.hoje)} />
          <KpiCard
            label="Não caiu"
            value={formatBRL(t.atrasado)}
            tone={t.atrasado > 0 ? "danger" : "default"}
            hint={t.atrasado > 0 ? "cobrar explicação da adquirente" : undefined}
          />
          <KpiCard label="Lotes pendentes" value={String(t.lotes)} />
        </div>
      ) : null}

      {dados.isPending ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}

      {dados.data && dados.data.lotes.length === 0 ? (
        <EmptyState
          title="Nada pendente do cartão"
          description="Vendas no cartão aparecem aqui agrupadas pela data em que o dinheiro cai."
        />
      ) : null}

      {(dados.data?.lotes ?? []).map((l) => {
        const texto = informado[l.dueDate] ?? "";
        const valor = texto.trim() ? parseMoneyInput(texto) : null;
        const cmp = valor != null && Number.isFinite(valor) ? compareDeposit(l.liquido, valor) : null;
        const taxaEfetiva =
          cmp && l.bruto > 0 ? effectiveFeePct(l.bruto, cmp.informado) : null;
        return (
          <Card key={l.dueDate} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="ed-title">{formatDate(l.dueDate)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {l.parcelas} parcela(s){l.bandeiras ? ` · ${l.bandeiras}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl font-semibold tabular">{formatBRL(l.liquido)}</p>
                <Badge
                  variant={
                    l.status === "atrasado" ? "danger" : l.status === "hoje" ? "warning" : "muted"
                  }
                >
                  {BATCH_STATUS_LABELS[l.status]}
                </Badge>
              </div>
            </div>

            <div className="mt-block flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5">
                <span className="ed-label">Quanto caiu na conta (opcional)</span>
                <Input
                  className="w-44"
                  inputMode="decimal"
                  placeholder={formatBRL(l.liquido)}
                  value={texto}
                  onChange={(e) => setInformado({ ...informado, [l.dueDate]: e.target.value })}
                />
              </label>
              <Button
                disabled={ocupado != null}
                onClick={async () => {
                  setOcupado(l.dueDate);
                  const ok = await runAction(
                    () =>
                      settleCardBatchFn({
                        data: { dueDate: l.dueDate, storeId: storeId ?? undefined },
                      }),
                    { sucesso: "Lote conciliado." },
                  );
                  setOcupado(null);
                  if (!ok) return;
                  void qc.invalidateQueries({ queryKey: ["card-settlements"] });
                  void qc.invalidateQueries({ queryKey: ["ar"] });
                  void qc.invalidateQueries({ queryKey: ["flow"] });
                }}
              >
                Confirmar recebimento
              </Button>
            </div>

            {cmp && cmp.relevante ? (
              <div
                className={`mt-block rounded-lg border p-3 text-sm ${
                  cmp.diferenca < 0
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-warning/40 bg-warning/5"
                }`}
              >
                <p className="font-medium">
                  Diferença de {formatBRL(Math.abs(cmp.diferenca))}{" "}
                  {cmp.diferenca < 0 ? "a menos" : "a mais"} que o esperado.
                </p>
                <p className="mt-1 text-muted-foreground">
                  {taxaEfetiva != null ? (
                    <>
                      A adquirente reteve <strong className="text-foreground">{taxaEfetiva}%</strong> sobre
                      o bruto deste lote. Se isso se repetir, ajuste a taxa em Configurações → Cartões —
                      é ela que define o valor que o sistema espera receber.
                    </>
                  ) : (
                    <>
                      Causas comuns: taxa diferente da cadastrada, antecipação ou estorno. A baixa é
                      sempre pelo valor esperado — o sistema não rateia a diferença sozinho.
                    </>
                  )}
                </p>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
