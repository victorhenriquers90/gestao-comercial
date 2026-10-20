import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CustomerPanel } from "@/components/customer-panel";
import { Card } from "@/components/ui/card";
import { NativeCheckbox } from "@/components/ui/select";
import { KpiCard, PageHeader, PageSkeleton, QueryError } from "@/components/shared";
import { CRM_STAGE_LABELS, CRM_STAGES, type CrmStage } from "@/lib/constants";
import { runAction } from "@/lib/run-action";
import { formatBRL, formatDate } from "@/lib/format";
import { crmBoardFn, listCrmTasksFn, moveCrmFn, toggleCrmTaskFn } from "@/lib/server/party";

const FUNNEL_STAGES = CRM_STAGES.filter((s) => s !== "venda" && s !== "perdido");

/**
 * Cor de topo por coluna do quadro -- progressao do funil, nao decoracao
 * aleatoria: fria/neutra no inicio, esquenta conforme avanca, verde quando
 * fecha, vermelho quando perde. Ajuda a "ler" o quadro de longe (qual coluna
 * e qual) sem precisar do texto do cabecalho.
 */
const CRM_STAGE_ACCENT: Record<CrmStage, string> = {
  novo: "var(--info)",
  interessado: "var(--color-chart-2)",
  orcamento: "var(--color-chart-3)",
  negociacao: "var(--warning)",
  venda: "var(--success)",
  perdido: "var(--destructive)",
};

export const Route = createFileRoute("/app/crm")({ component: CrmPage });

function CrmPage() {
  const qc = useQueryClient();
  const [detailId, setDetailId] = useState<number | null>(null);
  // Contagens e valores vem do servidor sobre TODOS os clientes; so os cartoes
  // de cada coluna sao limitados (CRM_BOARD_CARDS).
  const list = useQuery({
    queryKey: ["customers", "board"],
    queryFn: () => crmBoardFn(),
  });
  const tasks = useQuery({
    queryKey: ["crm-tasks"],
    queryFn: () => listCrmTasksFn({ data: { openOnly: true } }),
  });

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar o CRM." />;

  const { stages, openTasks, overdueTasks } = list.data;
  const pipelineCount = FUNNEL_STAGES.reduce((a, s) => a + stages[s].count, 0);
  const pipelineValue = FUNNEL_STAGES.reduce((a, s) => a + stages[s].totalBought, 0);

  return (
    <div>
      <PageHeader
        title="CRM comercial"
        description="Funil, follow-ups e ficha completa do cliente."
      />
      <div className="mb-5 kpi-grid">
        <KpiCard label="No funil" value={String(pipelineCount)} />
        <KpiCard label="Valor no funil" value={formatBRL(pipelineValue)} />
        <KpiCard label="Tarefas abertas" value={String(openTasks)} />
        <KpiCard
          label="Atrasadas"
          value={String(overdueTasks)}
          tone={overdueTasks ? "warning" : "default"}
        />
      </div>

      {(tasks.data ?? []).length ? (
        <Card className="enter-fade mb-5 p-5">
          <p className="mb-3 ed-title">Agenda de follow-ups</p>
          <ul className="space-y-2">
            {(tasks.data ?? []).slice(0, 8).map((t) => {
              const late = Boolean(t.dueAt && new Date(t.dueAt).getTime() < Date.now());
              return (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <NativeCheckbox
                    checked={false}
                    onChange={async () => {
                      // toggleCrmTaskFn passou a exigir crm.write: sem o
                      // runAction, quem nao tem a permissao clicava e nao
                      // acontecia NADA -- nem a marcacao, nem uma mensagem.
                      const ok = await runAction(
                        () => toggleCrmTaskFn({ data: { id: t.id, done: true } }),
                        { erro: "Não foi possível concluir a tarefa." },
                      );
                      if (!ok) return;
                      void qc.invalidateQueries({ queryKey: ["crm-tasks"] });
                      void qc.invalidateQueries({ queryKey: ["customers"] });
                    }}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left hover:underline"
                    onClick={() => setDetailId(t.customerId)}
                  >
                    <span className={late ? "text-destructive" : ""}>{t.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.customerName}
                      {t.dueAt ? ` · ${formatDate(t.dueAt)}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {openTasks > 8 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Mostrando as 8 mais próximas de {openTasks} tarefas abertas.
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="board-grid">
        {CRM_STAGES.map((stage) => {
          const col = stages[stage];
          return (
            <div
              key={stage}
              className="board-col rounded-xl border-t-4 bg-muted/50 p-2"
              style={{ borderTopColor: CRM_STAGE_ACCENT[stage] }}
            >
              <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">
                {CRM_STAGE_LABELS[stage]} · {col.count}
              </p>
              <p className="px-2 pb-2 text-xs tabular text-muted-foreground">{formatBRL(col.totalBought)}</p>
              <div className="board-cards">
                {col.cards.map((c) => (
                  <Card
                    key={c.id}
                    className="cursor-pointer p-3 shadow-none hover:bg-muted/40"
                    onClick={() => setDetailId(c.id)}
                  >
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.phone ?? c.city ?? "—"}</p>
                    <p className="mt-1 text-xs tabular">{formatBRL(c.total_bought)}</p>
                    {c.open_balance > 0 ? (
                      <p className="text-xs text-warning">Em aberto {formatBRL(c.open_balance)}</p>
                    ) : null}
                    {c.open_tasks > 0 ? (
                      <p className="text-xs text-primary">
                        {c.open_tasks} tarefa{c.open_tasks > 1 ? "s" : ""}
                        {c.next_due ? ` · ${formatDate(c.next_due)}` : ""}
                      </p>
                    ) : null}
                    <select
                      className="mt-2 h-8 w-full rounded-md border border-border bg-card text-xs"
                      value={c.crm_stage}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        try {
                          await moveCrmFn({ data: { customerId: c.id, stage: e.target.value } });
                          void qc.invalidateQueries({ queryKey: ["customers"] });
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Falha");
                        }
                      }}
                    >
                      {CRM_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {CRM_STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </Card>
                ))}
                {col.count > col.cards.length ? (
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    Mostrando {col.cards.length} de {col.count}.{" "}
                    <Link to="/app/clientes" search={{ etapa: stage }} className="text-primary underline">
                      Ver todos em Clientes
                    </Link>
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <CustomerPanel
        customerId={detailId}
        open={detailId != null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      />
    </div>
  );
}
