import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/shared";
import { CASH_DENOMINATIONS, DIFFERENCE_LABELS } from "@/lib/cash-count";
import { formatBRL, formatDateTime } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { explainCashDifferenceFn, listCashClosuresFn } from "@/lib/server/finance";

/**
 * Historico de fechamentos.
 *
 * Antes o resultado da conferencia aparecia uma vez, pra quem fechou, e
 * sumia da tela. Conferencia que ninguem revisita nao controla nada: o que
 * denuncia um problema nao e uma falta de R$ 20 -- e tres faltas de R$ 20
 * no mesmo turno da semana. So da pra ver isso em lista.
 */
export function CashClosuresPanel({ storeId }: { storeId: number | null }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);

  const dados = useQuery({
    queryKey: ["cash-closures", storeId],
    queryFn: () => listCashClosuresFn({ data: { storeId: storeId ?? undefined } }),
  });

  if (dados.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!dados.data?.length) {
    return (
      <EmptyState
        title="Nenhum caixa fechado ainda"
        description="Cada fechamento fica aqui com o contado, o esperado e a diferença."
      />
    );
  }

  return (
    <div className="space-y-2">
      {dados.data.map((f) => (
        <div key={f.id} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                {f.closedAt ? formatDateTime(f.closedAt) : "—"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Abriu {f.openedBy ?? "—"} · Fechou {f.closedBy ?? "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Um fechamento em que o esperado ja tinha sido revelado nao
                  prova a mesma coisa que um cego. Quem revisa precisa ver
                  essa diferenca antes de tirar conclusao da diferenca. */}
              {f.cego ? null : <Badge variant="outline">Esperado revelado antes</Badge>}
              <Badge
                variant={
                  f.kind === "exato" ? "success" : f.kind === "falta" ? "danger" : "warning"
                }
              >
                {DIFFERENCE_LABELS[f.kind]}
                {f.kind === "exato" ? "" : ` ${formatBRL(Math.abs(f.diff))}`}
              </Badge>
            </div>
          </div>

          <div className="mt-block grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="ed-label">Esperado</p>
              <p className="tabular mt-0.5">{formatBRL(f.expected)}</p>
            </div>
            <div>
              <p className="ed-label">Contado</p>
              <p className="tabular mt-0.5">{formatBRL(f.counted)}</p>
            </div>
            <div>
              <p className="ed-label">Diferença</p>
              <p
                className={`tabular mt-0.5 ${
                  f.diff < 0 ? "text-destructive" : f.diff > 0 ? "text-warning" : ""
                }`}
              >
                {formatBRL(f.diff)}
              </p>
            </div>
          </div>

          {f.breakdown ? <Breakdown map={f.breakdown} /> : null}

          {f.reason ? (
            <p className="mt-block text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Explicação:</span> {f.reason}
              {f.explainedBy ? ` — ${f.explainedBy}` : ""}
            </p>
          ) : f.pendente ? (
            <div className="mt-block rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="text-sm font-medium">Esta diferença ainda não foi explicada.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Vale mais o que aconteceu do que o valor: troco errado, sangria não lançada,
                venda registrada com o meio de pagamento trocado. Só dá pra escrever uma vez.
              </p>
              <Textarea
                className="mt-block"
                placeholder="O que aconteceu"
                value={texto[f.id] ?? ""}
                onChange={(e) => setTexto({ ...texto, [f.id]: e.target.value })}
              />
              <Button
                className="mt-block"
                size="sm"
                disabled={ocupado != null}
                onClick={async () => {
                  setOcupado(f.id);
                  const ok = await runAction(
                    () =>
                      explainCashDifferenceFn({
                        data: { registerId: f.id, reason: texto[f.id] ?? "" },
                      }),
                    { sucesso: "Explicação registrada." },
                  );
                  setOcupado(null);
                  if (!ok) return;
                  setTexto({ ...texto, [f.id]: "" });
                  void qc.invalidateQueries({ queryKey: ["cash-closures"] });
                  void qc.invalidateQueries({ queryKey: ["notifications"] });
                }}
              >
                {ocupado === f.id ? "Registrando…" : "Registrar explicação"}
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** As cedulas que o caixa disse ter contado -- a prova por tras do total. */
function Breakdown({ map }: { map: Record<string, number> }) {
  const linhas = CASH_DENOMINATIONS.filter((d) => Number(map[String(d.cents)] ?? 0) > 0);
  if (!linhas.length) return null;
  return (
    <p className="mt-block text-sm text-muted-foreground">
      {linhas.map((d) => `${map[String(d.cents)]} × ${d.label}`).join(" · ")}
    </p>
  );
}
