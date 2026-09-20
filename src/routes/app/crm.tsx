import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CustomerPanel } from "@/components/customer-panel";
import { Card } from "@/components/ui/card";
import { NativeCheckbox } from "@/components/ui/select";
import { KpiCard, PageHeader, PageSkeleton, QueryError } from "@/components/shared";
import { CRM_STAGE_LABELS, CRM_STAGES } from "@/lib/constants";
import { runAction } from "@/lib/run-action";
import { formatBRL, formatDate } from "@/lib/format";
import { listCrmTasksFn, listCustomersFn, moveCrmFn, toggleCrmTaskFn } from "@/lib/server/party";

export const Route = createFileRoute("/app/crm")({ component: CrmPage });

function CrmPage() {
  const qc = useQueryClient();
  const [detailId, setDetailId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ["customers", "crm"],
    queryFn: () => listCustomersFn({ data: {} }),
  });
  const tasks = useQuery({
    queryKey: ["crm-tasks"],
    queryFn: () => listCrmTasksFn({ data: { openOnly: true } }),
  });

  const rows = list.data ?? [];
  const pipeline = useMemo(
    () => rows.filter((c) => c.crm_stage !== "venda" && c.crm_stage !== "perdido"),
    [rows],
  );
  const overdue = (tasks.data ?? []).filter((t) => t.dueAt && new Date(t.dueAt).getTime() < Date.now());

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar o CRM." />;

  return (
    <div>
      <PageHeader
        title="CRM comercial"
        description="Funil, follow-ups e ficha completa do cliente."
      />
      <div className="mb-5 kpi-grid">
        <KpiCard label="No funil" value={String(pipeline.length)} />
        <KpiCard
          label="Valor no funil"
          value={formatBRL(pipeline.reduce((a, c) => a + c.total_bought, 0))}
        />
        <KpiCard label="Tarefas abertas" value={String(tasks.data?.length ?? 0)} />
        <KpiCard
          label="Atrasadas"
          value={String(overdue.length)}
          tone={overdue.length ? "warning" : "default"}
        />
      </div>

      {(tasks.data ?? []).length ? (
        <Card className="mb-5 p-4">
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
        </Card>
      ) : null}

      <div className="board-grid">
        {CRM_STAGES.map((stage) => {
          const col = rows.filter((c) => c.crm_stage === stage);
          const sum = col.reduce((a, c) => a + c.total_bought, 0);
          return (
            <div key={stage} className="board-col rounded-xl bg-muted/50 p-2">
              <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">
                {CRM_STAGE_LABELS[stage]} · {col.length}
              </p>
              <p className="px-2 pb-2 text-xs tabular text-muted-foreground">{formatBRL(sum)}</p>
              <div className="board-cards">
                {col.map((c) => (
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
