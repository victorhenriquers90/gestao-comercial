import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { RECEIPT_METHOD_LABELS, RECEIPT_METHODS, type ReceiptMethod } from "@/lib/constants";
import { EmptyState, KpiCard } from "@/components/shared";
import { AGING_LABELS, type AgingBucket } from "@/lib/crediario-aging";
import { formatBRL, formatDate, formatDoc, formatPhone } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { runAction } from "@/lib/run-action";
import { listCrediarioFn } from "@/lib/server/crediario";
import { settleReceivableFn } from "@/lib/server/finance";

/**
 * Lista de cobranca.
 *
 * Ordenada pela divida mais VELHA, nao por valor nem por nome: o que decide
 * a ligacao e ha quanto tempo o dinheiro esta fora, porque divida velha e a
 * que menos volta. O telefone fica ao lado de cada cliente -- cobranca em
 * loja pequena e telefonema, nao relatorio.
 */
export function CrediarioPanel({ storeId }: { storeId: number | null }) {
  const qc = useQueryClient();
  const [apenasVencidos, setApenasVencidos] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [recebendo, setRecebendo] = useState<number | null>(null);
  const [valor, setValor] = useState("");
  /**
   * Mesmo bug do "Confirmar" de financeiro.tsx, aqui numa segunda porta de
   * entrada pro mesmo settleReceivableFn: sem trava sincrona, duplo clique
   * soma a baixa duas vezes e, em dinheiro (a forma padrao aqui), duplica
   * o lancamento em cash_movements -- gaveta com "sobra" fantasma.
   */
  const [confirmando, setConfirmando] = useState(false);
  // Dinheiro por padrao: e o caso do balcao. Em dinheiro a parcela entra no
  // caixa aberto da loja (e sem caixa aberto o servidor recusa).
  const [forma, setForma] = useState<ReceiptMethod>("dinheiro");

  const dados = useQuery({
    queryKey: ["crediario", storeId, apenasVencidos],
    queryFn: () =>
      listCrediarioFn({ data: { storeId: storeId ?? undefined, apenasVencidos } }),
  });

  const t = dados.data?.totais;

  return (
    <div className="space-y-block">
      {t ? (
        <div className="kpi-grid">
          <KpiCard label="Total a receber" value={formatBRL(t.total)} hint={`${t.clientes} cliente(s)`} />
          <KpiCard
            label="Vencido"
            value={formatBRL(t.vencido)}
            tone={t.vencido > 0 ? "danger" : "default"}
            hint={t.total > 0 ? `${Math.round((t.vencido / t.total) * 100)}% da carteira` : undefined}
          />
          <KpiCard label="A vencer" value={formatBRL(t.aVencer)} />
          <KpiCard
            label="Mais de 60 dias"
            value={formatBRL(t.porFaixa.acima_60)}
            tone={t.porFaixa.acima_60 > 0 ? "danger" : "default"}
            hint="o que menos volta"
          />
        </div>
      ) : null}

      {t && t.total > 0 ? (
        <Card className="p-5">
          <p className="ed-title mb-block">Carteira por idade</p>
          <div className="space-y-2">
            {(Object.keys(AGING_LABELS) as AgingBucket[]).map((f) => {
              const v = t.porFaixa[f];
              const pct = t.total > 0 ? (v / t.total) * 100 : 0;
              const atraso = f !== "a_vencer" && f !== "hoje";
              return (
                <div key={f} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-muted-foreground">{AGING_LABELS[f]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${atraso ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 whitespace-nowrap text-right tabular">{formatBRL(v)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <NativeCheckbox
          checked={apenasVencidos}
          onChange={(e) => setApenasVencidos(e.target.checked)}
        />
        Mostrar só quem está em atraso
      </label>

      {dados.isPending ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}

      {dados.data && dados.data.clientes.length === 0 ? (
        <EmptyState
          title={apenasVencidos ? "Ninguém em atraso" : "Nenhum crediário em aberto"}
          description={
            apenasVencidos
              ? "Todas as parcelas estão em dia."
              : "Vendas no crediário aparecem aqui até serem quitadas."
          }
        />
      ) : null}

      {(dados.data?.clientes ?? []).map((c) => {
        const expandido = aberto === c.customerId;
        return (
          <Card key={c.customerId} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setAberto(expandido ? null : c.customerId)}
                >
                  <span className="ed-title">{c.nome}</span>
                </button>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {c.documento ? <span>{formatDoc(c.documento)}</span> : null}
                  {c.telefone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3.5" aria-hidden />
                      {formatPhone(c.telefone)}
                    </span>
                  ) : (
                    <span className="text-warning">sem telefone cadastrado</span>
                  )}
                  <span>
                    {c.resumo.parcelas} parcela(s) em aberto
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl font-semibold tabular">{formatBRL(c.resumo.total)}</p>
                {c.resumo.vencido > 0 ? (
                  <Badge variant="danger">
                    {formatBRL(c.resumo.vencido)} vencido · {c.resumo.diasAtraso} dia(s)
                  </Badge>
                ) : (
                  <Badge variant="success">Em dia</Badge>
                )}
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setAberto(expandido ? null : c.customerId)}
            >
              {expandido ? "Ocultar parcelas" : "Ver parcelas"}
            </Button>

            {expandido ? (
              <div className="mt-block space-y-2">
                {c.parcelas.map((p) => {
                  const atrasada = p.faixa !== "a_vencer" && p.faixa !== "hoje";
                  return (
                    <div
                      key={p.id}
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm ${
                        atrasada ? "border-destructive/40 bg-destructive/5" : "border-border"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate">{p.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          vence {formatDate(p.dueDate)} · {AGING_LABELS[p.faixa]}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap tabular font-medium">{formatBRL(p.open)}</span>
                        {recebendo === p.id ? (
                          <>
                            <Input
                              className="w-28"
                              inputMode="decimal"
                              autoFocus
                              placeholder={String(p.open).replace(".", ",")}
                              value={valor}
                              onChange={(e) => setValor(e.target.value)}
                            />
                            <Select
                              className="w-40"
                              aria-label="Forma de recebimento"
                              value={forma}
                              onChange={(e) => setForma(e.target.value as ReceiptMethod)}
                            >
                              {RECEIPT_METHODS.map((m) => (
                                <option key={m} value={m}>
                                  {RECEIPT_METHOD_LABELS[m]}
                                </option>
                              ))}
                            </Select>
                            <Button
                              size="sm"
                              disabled={confirmando}
                              onClick={async () => {
                                if (confirmando) return;
                                // Vazio significa "recebi tudo": e o caso
                                // comum, e obrigar a redigitar o valor que ja
                                // esta na tela so cria chance de errar.
                                const v = valor.trim() ? parseMoneyInput(valor) : p.open;
                                if (!Number.isFinite(v) || v <= 0) return;
                                setConfirmando(true);
                                try {
                                  const ok = await runAction(
                                    () =>
                                      settleReceivableFn({ data: { id: p.id, amount: v, method: forma, storeId } }),
                                    { sucesso: "Recebimento registrado." },
                                  );
                                  if (!ok) return;
                                  setRecebendo(null);
                                  setValor("");
                                  void qc.invalidateQueries({ queryKey: ["crediario"] });
                                  void qc.invalidateQueries({ queryKey: ["ar"] });
                                  void qc.invalidateQueries({ queryKey: ["customers"] });
                                  void qc.invalidateQueries({ queryKey: ["register"] });
                                } finally {
                                  setConfirmando(false);
                                }
                              }}
                            >
                              {confirmando ? "Confirmando…" : "Confirmar"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRecebendo(null)}>
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRecebendo(p.id);
                              setValor("");
                              setForma("dinheiro");
                            }}
                          >
                            Receber
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
