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
  const [openingCaixa, setOpeningCaixa] = useState(false);
  const [closeAmt, setCloseAmt] = useState("");
  const [moveAmt, setMoveAmt] = useState("");
  const [moveDesc, setMoveDesc] = useState("");
  const [movendo, setMovendo] = useState(false);
  const [confirmandoFechamento, setConfirmandoFechamento] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [result, setResult] = useState<{ expected: number; counted: number; diff: number } | null>(null);

  /**
   * Sangria e suprimento partilham este caminho. Antes cada botao chamava
   * cashMoveFn direto, sem try/catch, sem travar o duplo clique e sem validar
   * o valor -- tres buracos no mesmo lugar, e o pior num registro de dinheiro
   * fisico: uma falha do servidor nao dizia NADA (o operador assumia que deu
   * certo), dois cliques lancavam duas retiradas, e o campo vazio virava
   * Number("") = 0, registrando uma movimentacao de R$ 0,00.
   */
  async function registrarMovimento(type: "sangria" | "suprimento") {
    if (movendo) return;
    const valor = Number(moveAmt);
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    setMovendo(true);
    try {
      await cashMoveFn({
        data: { storeId: activeStore, type, amount: valor, description: moveDesc },
      });
      toast.success(type === "sangria" ? "Sangria registrada." : "Suprimento registrado.");
      setMoveAmt("");
      setMoveDesc("");
      void qc.invalidateQueries({ queryKey: ["register"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao registrar a movimentação.");
    } finally {
      setMovendo(false);
    }
  }

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
            disabled={openingCaixa}
            onClick={async () => {
              if (openingCaixa) return;
              setOpeningCaixa(true);
              try {
                await openRegisterFn({ data: { storeId: activeStore, amount: Number(openAmt) } });
                toast.success("Caixa aberto.");
                void qc.invalidateQueries({ queryKey: ["register"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha");
              } finally {
                setOpeningCaixa(false);
              }
            }}
          >
            {openingCaixa ? "Abrindo…" : "Abrir caixa"}
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
                  disabled={movendo}
                  onClick={() => void registrarMovimento("sangria")}
                >
                  {movendo ? "Registrando…" : "Sangria"}
                </Button>
                <Button
                  variant="outline"
                  disabled={movendo}
                  onClick={() => void registrarMovimento("suprimento")}
                >
                  {movendo ? "Registrando…" : "Suprimento"}
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
              {/* Fechar o caixa encerra o dia e nao tem volta (o indice parcial
                  garante um unico caixa aberto por loja), mas estava a um
                  clique so, do lado de campos que o operador acabou de digitar.
                  Confirma antes. */}
              {confirmandoFechamento ? (
                <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
                  <p className="text-sm">
                    Fechar o caixa com {formatBRL(Number(closeAmt) || 0)} em dinheiro conferido? Não dá
                    para reabrir depois.
                  </p>
                  <div className="mt-block flex gap-2">
                    <Button
                      variant="destructive"
                      disabled={fechando}
                      onClick={async () => {
                        setFechando(true);
                        try {
                          const r = await closeRegisterFn({
                            data: { storeId: activeStore, amount: Number(closeAmt) },
                          });
                          setResult({ expected: r.expected, counted: r.counted, diff: r.diff });
                          setConfirmandoFechamento(false);
                          toast.success("Caixa fechado.");
                          void qc.invalidateQueries({ queryKey: ["register"] });
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Falha ao fechar o caixa.");
                        } finally {
                          setFechando(false);
                        }
                      }}
                    >
                      {fechando ? "Fechando…" : "Sim, fechar"}
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmandoFechamento(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button className="mt-4" onClick={() => setConfirmandoFechamento(true)}>
                  Fechar caixa
                </Button>
              )}
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
