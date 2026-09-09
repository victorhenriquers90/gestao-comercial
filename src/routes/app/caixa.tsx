import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { KpiCard, PageHeader, PageSkeleton, QueryError } from "@/components/shared";
import { useSelection } from "@/hooks/use-selection";
import { CASH_MOVE_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime } from "@/lib/format";
import { cashMoveFn, closeRegisterFn, getRegisterFn, openRegisterFn } from "@/lib/server/finance";
import { getTenantFn } from "@/lib/server/session";
import { num } from "@/lib/utils";

export const Route = createFileRoute("/app/caixa")({ component: CaixaPage });

function CaixaPage() {
  const storeId = useSelection((s) => s.storeId);
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const activeStore = storeId ?? tenant.data?.defaultStoreId ?? 0;
  const qc = useQueryClient();
  const [openAmt, setOpenAmt] = useState("350");
  const [closeAmt, setCloseAmt] = useState("");
  const [moveAmt, setMoveAmt] = useState("");
  const [moveDesc, setMoveDesc] = useState("");
  const [result, setResult] = useState<{ expected: number; counted: number; diff: number } | null>(null);

  const reg = useQuery({
    queryKey: ["register", activeStore],
    queryFn: () => getRegisterFn({ data: { storeId: activeStore } }),
    enabled: Boolean(activeStore),
  });

  if (!activeStore) return <p className="text-sm text-muted-foreground">Selecione uma loja.</p>;
  if (reg.isPending) return <PageSkeleton />;
  if (reg.error) return <QueryError error={reg.error} fallback="Erro ao carregar o caixa." />;
  const d = reg.data;

  return (
    <div>
      <PageHeader title="Caixa" description="Abertura, sangria, suprimento e conferência de fechamento." />
      {!d?.register ? (
        <Card className="max-w-md p-5">
          <p className="text-sm text-muted-foreground">Nenhum caixa aberto nesta loja.</p>
          <Field label="Fundo inicial" className="mt-4">
            <Input value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            onClick={async () => {
              try {
                await openRegisterFn({ data: { storeId: activeStore, amount: Number(openAmt) } });
                toast.success("Caixa aberto.");
                void qc.invalidateQueries({ queryKey: ["register"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha");
              }
            }}
          >
            Abrir caixa
          </Button>
        </Card>
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard label="Fundo" value={formatBRL(num(d.register.opening_amount))} />
            <KpiCard label="Dinheiro esperado" value={formatBRL(d.summary?.expectedCash ?? 0)} />
            <KpiCard label="PIX" value={formatBRL(d.summary?.pix ?? 0)} />
            <KpiCard label="Cartões" value={formatBRL(d.summary?.cards ?? 0)} />
          </div>
          <div className="ops-stage mt-4">
            <Card className="ops-primary p-5">
              <p className="text-sm font-medium">Sangria / suprimento</p>
              <Field label="Valor" className="mt-block">
                <Input value={moveAmt} onChange={(e) => setMoveAmt(e.target.value)} />
              </Field>
              <Field label="Descrição" className="mt-block">
                <Input value={moveDesc} onChange={(e) => setMoveDesc(e.target.value)} />
              </Field>
              <div className="mt-block flex gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    await cashMoveFn({
                      data: { storeId: activeStore, type: "sangria", amount: Number(moveAmt), description: moveDesc },
                    });
                    toast.success("Sangria registrada.");
                    void qc.invalidateQueries({ queryKey: ["register"] });
                  }}
                >
                  Sangria
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await cashMoveFn({
                      data: { storeId: activeStore, type: "suprimento", amount: Number(moveAmt), description: moveDesc },
                    });
                    toast.success("Suprimento registrado.");
                    void qc.invalidateQueries({ queryKey: ["register"] });
                  }}
                >
                  Suprimento
                </Button>
              </div>
            </Card>
            <Card className="ops-secondary p-5">
              <p className="text-sm font-medium">Fechamento</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aberto em {formatDateTime(String(d.register.opened_at))}
              </p>
              <Field label="Dinheiro informado" className="mt-block">
                <Input value={closeAmt} onChange={(e) => setCloseAmt(e.target.value)} />
              </Field>
              <Button
                className="mt-4"
                onClick={async () => {
                  try {
                    const r = await closeRegisterFn({ data: { storeId: activeStore, amount: Number(closeAmt) } });
                    setResult({ expected: r.expected, counted: r.counted, diff: r.diff });
                    toast.success("Caixa fechado.");
                    void qc.invalidateQueries({ queryKey: ["register"] });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Falha");
                  }
                }}
              >
                Fechar caixa
              </Button>
              {result ? (
                <div className="mt-4 space-y-1 text-sm">
                  <p>Esperado: {formatBRL(result.expected)}</p>
                  <p>Informado: {formatBRL(result.counted)}</p>
                  <p>Diferença: {formatBRL(result.diff)}</p>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    Imprimir fechamento
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>
          <Card className="mt-4 p-5">
            <p className="mb-block text-sm font-medium">Movimentações</p>
            <div className="space-y-2 text-sm">
              {(d.movements as Record<string, unknown>[]).map((m) => (
                <div key={String(m.id)} className="flex justify-between">
                  <span>
                    {CASH_MOVE_LABELS[String(m.type)] ?? String(m.type)} · {String(m.description ?? m.method ?? "")}
                  </span>
                  <span className="tabular">{formatBRL(num(m.amount))}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
