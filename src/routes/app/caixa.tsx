import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { CashClosuresPanel } from "@/components/cash-closures-panel";
import { CashCountSheet, type CountMode } from "@/components/cash-count-sheet";
import { KpiCard, PageHeader, PageSkeleton, QueryError } from "@/components/shared";
import { useSelection } from "@/hooks/use-selection";
import {
  CASH_DIFFERENCE_TOLERANCE,
  DIFFERENCE_LABELS,
  breakdownTotal,
  classifyDifference,
  isRegisterStale,
  normalizeBreakdown,
  parseQty,
  registerAgeLabel,
} from "@/lib/cash-count";
import { CASH_MOVE_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { can, type Role } from "@/lib/permissions";
import { runAction } from "@/lib/run-action";
import {
  cashMoveFn,
  closeRegisterFn,
  getRegisterFn,
  openRegisterFn,
  revealExpectedCashFn,
} from "@/lib/server/finance";
import { getTenantFn } from "@/lib/server/session";
import { num } from "@/lib/utils";

export const Route = createFileRoute("/app/caixa")({ component: CaixaPage });

type CloseResult = {
  expected: number;
  counted: number;
  diff: number;
  cego: boolean;
  precisaExplicacao: boolean;
};

function CaixaPage() {
  const storeId = useSelection((s) => s.storeId);
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const activeStore = storeId ?? tenant.data?.defaultStoreId ?? 0;
  const role = (tenant.data?.role ?? "pdv") as Role;
  const qc = useQueryClient();
  const [openAmt, setOpenAmt] = useState("350");
  const [openingCaixa, setOpeningCaixa] = useState(false);
  const [moveAmt, setMoveAmt] = useState("");
  const [moveDesc, setMoveDesc] = useState("");
  const [movendo, setMovendo] = useState(false);
  const [modo, setModo] = useState<CountMode>("cedula");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [totalDireto, setTotalDireto] = useState("");
  const [confirmandoFechamento, setConfirmandoFechamento] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [revelando, setRevelando] = useState(false);
  const [result, setResult] = useState<CloseResult | null>(null);

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
  const podeFechar = can(role, "cash.write");
  const podeRevelar = can(role, "cash.reveal");
  const esperado = d?.summary?.cash?.expectedCash ?? null;

  // O que vale como contagem depende do modo. Em "por cédula" o total sai da
  // ficha; em "só o total" sai do campo — e "350,00" precisa virar 350, nao
  // NaN, por isso parseMoneyInput e nao Number().
  const contado = modo === "cedula" ? breakdownTotal(qtys) : parseMoneyInput(totalDireto);
  const fichaVazia = Object.values(qtys).every((v) => parseQty(v) === 0);
  const fichaInvalida = Object.values(qtys).some((v) => !Number.isFinite(parseQty(v)));
  /*
    Ficha em branco NAO fecha o caixa com R$ 0,00.

    Gaveta zerada existe (sangria levou tudo), mas nesse caso o zero tem de
    ser digitado em "Só o total" -- um ato deliberado. Aceitar a ficha vazia
    como zero transformaria um clique distraido num fechamento com falta do
    valor inteiro do turno, e nao ha como reabrir: sobraria uma diferenca
    falsa, permanente, exigindo explicacao pra um erro que nunca aconteceu.
  */
  const contagemValida =
    Number.isFinite(contado) &&
    contado >= 0 &&
    (modo === "cedula" ? !fichaVazia && !fichaInvalida : totalDireto.trim() !== "");

  async function fechar() {
    if (fechando) return;
    setFechando(true);
    try {
      // A ficha e normalizada aqui tambem pra o erro ("Quantidade inválida em
      // R$ 50") chegar ao operador apontando a linha, em vez de voltar do
      // servidor como recusa generica depois do clique de confirmacao.
      const breakdown = modo === "cedula" ? normalizeBreakdown(qtys) : null;
      const r = await closeRegisterFn({
        data: {
          storeId: activeStore,
          counted: modo === "cedula" ? undefined : contado,
          breakdown,
        },
      });
      setResult({
        expected: r.expected,
        counted: r.counted,
        diff: r.diff,
        cego: r.cego,
        precisaExplicacao: r.precisaExplicacao,
      });
      setConfirmandoFechamento(false);
      setQtys({});
      setTotalDireto("");
      toast.success("Caixa fechado.");
      void qc.invalidateQueries({ queryKey: ["register"] });
      void qc.invalidateQueries({ queryKey: ["cash-closures"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao fechar o caixa.");
    } finally {
      setFechando(false);
    }
  }

  return (
    <div>
      <PageHeader title="Caixa" description="Abertura, sangria, suprimento e conferência de fechamento." />

      {result ? <ResultadoFechamento r={result} /> : null}

      {!d?.register ? (
        <Card className="max-w-md p-5">
          <p className="text-sm text-muted-foreground">Nenhum caixa aberto nesta loja.</p>
          <Field label="Fundo inicial" className="mt-4">
            <Input value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            disabled={openingCaixa || !podeFechar}
            onClick={async () => {
              if (openingCaixa) return;
              setOpeningCaixa(true);
              const ok = await runAction(
                () => openRegisterFn({ data: { storeId: activeStore, amount: Number(openAmt) } }),
                { sucesso: "Caixa aberto." },
              );
              setOpeningCaixa(false);
              if (!ok) return;
              setResult(null);
              void qc.invalidateQueries({ queryKey: ["register"] });
            }}
          >
            {openingCaixa ? "Abrindo…" : "Abrir caixa"}
          </Button>
        </Card>
      ) : (
        <>
          {/* Aviso ANTES dos KPIs: enquanto o caixa nao fecha, todo numero
              desta tela e um acumulado de varios dias, e ler qualquer um
              deles como "o turno" e ler errado. */}
          {isRegisterStale(d.register.days_open) ? (
            <Card className="mb-4 border-destructive/40 bg-destructive/5 p-4">
              <p className="ed-title">
                Caixa {registerAgeLabel(d.register.days_open)}, sem fechar
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                O dinheiro esperado soma {d.register.days_open + 1} dias de vendas, mas a gaveta é a
                de hoje — a conferência do turno deixou de existir. Pior: uma falta de um dia
                específico some diluída no período, sem hora nem responsável.
              </p>
              <p className="mt-block text-sm">
                Feche este caixa para voltar ao ciclo diário. <strong>A diferença vai ser grande</strong>{" "}
                nesta primeira vez, porque cobre o período inteiro — escreva isso na explicação, e a
                partir do próximo fechamento o número passa a significar alguma coisa.
              </p>
            </Card>
          ) : null}

          <div className="kpi-grid">
            <KpiCard label="Fundo" value={formatBRL(num(d.register.opening_amount))} />
            <KpiCard label="Vendas no turno" value={String(d.summary?.salesCount ?? 0)} />
            <KpiCard label="PIX" value={formatBRL(d.summary?.pix ?? 0)} />
            <KpiCard label="Cartões" value={formatBRL(d.summary?.cards ?? 0)} />
          </div>

          {/* O dinheiro esperado NAO aparece aqui. Ver cash-count.ts: com o
              numero na tela, o fechamento vira transcricao. Quem supervisiona
              pode revelar — e o fechamento passa a registrar que foi
              revelado. */}
          {esperado != null ? (
            <Card className="mt-4 border-warning/40 bg-warning/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="ed-label">Dinheiro esperado na gaveta</p>
                  <p className="tabular mt-1 font-display text-2xl font-semibold">
                    {formatBRL(esperado)}
                  </p>
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">
                  A conferência deste turno deixou de ser cega. O fechamento vai registrar isso.
                </p>
              </div>
            </Card>
          ) : podeRevelar ? (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={revelando}
                onClick={async () => {
                  setRevelando(true);
                  const ok = await runAction(
                    () => revealExpectedCashFn({ data: { storeId: activeStore } }),
                    { sucesso: "Esperado revelado — o fechamento vai registrar." },
                  );
                  setRevelando(false);
                  if (!ok) return;
                  void qc.invalidateQueries({ queryKey: ["register"] });
                }}
              >
                {revelando ? "Revelando…" : "Revelar o dinheiro esperado"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Fica registrado no fechamento como conferência não cega.
              </p>
            </div>
          ) : null}

          <div className="ops-stage mt-4">
            <Card className="ops-primary p-5">
              <p className="ed-title">Sangria / suprimento</p>
              <Field label="Valor" className="mt-block">
                <Input value={moveAmt} onChange={(e) => setMoveAmt(e.target.value)} />
              </Field>
              <Field label="Descrição" className="mt-block">
                <Input value={moveDesc} onChange={(e) => setMoveDesc(e.target.value)} />
              </Field>
              <div className="mt-block flex gap-2">
                <Button
                  variant="outline"
                  disabled={movendo || !podeFechar}
                  onClick={() => void registrarMovimento("sangria")}
                >
                  {movendo ? "Registrando…" : "Sangria"}
                </Button>
                <Button
                  variant="outline"
                  disabled={movendo || !podeFechar}
                  onClick={() => void registrarMovimento("suprimento")}
                >
                  {movendo ? "Registrando…" : "Suprimento"}
                </Button>
              </div>
            </Card>

            <Card className="ops-secondary p-5">
              <p className="mb-block ed-title">Movimentações</p>
              {/* Vendas nao entram nesta lista enquanto o caixa esta aberto:
                  somar as linhas daria o dinheiro esperado, que e justamente o
                  que a conferencia cega esconde. Sangria, suprimento e
                  devolucao ficam — foi o operador que lancou e ele precisa
                  conferir se lancou certo. */}
              {(d.movements as Record<string, unknown>[]).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma sangria, suprimento ou devolução neste turno.
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  {(d.movements as Record<string, unknown>[]).map((m) => (
                    <div key={String(m.id)} className="flex justify-between">
                      <span>
                        {CASH_MOVE_LABELS[String(m.type)] ?? String(m.type)} ·{" "}
                        {String(m.description ?? m.method ?? "")}
                      </span>
                      <span className="tabular">{formatBRL(num(m.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <p className="ed-title">Fechamento</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aberto em {formatDateTime(String(d.register.opened_at))} · conte a gaveta e lance
              abaixo. O esperado aparece depois.
            </p>

            <div className="mt-block">
              <CashCountSheet
                modo={modo}
                onModo={setModo}
                qtys={qtys}
                onQtys={setQtys}
                totalDireto={totalDireto}
                onTotalDireto={setTotalDireto}
                disabled={!podeFechar || fechando}
              />
            </div>

            <div className="mt-block flex items-baseline justify-between border-t border-border pt-3">
              <span className="ed-label">Total contado</span>
              <span className="tabular font-display text-2xl font-semibold">
                {contagemValida ? formatBRL(contado) : "—"}
              </span>
            </div>

            {confirmandoFechamento ? (
              <div className="mt-block rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="text-sm">
                  Fechar o caixa com {formatBRL(contado)} contados?
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Depois de confirmar, o sistema mostra o esperado — e a contagem não pode mais
                  ser alterada. É isso que faz a conferência valer.
                </p>
                <div className="mt-block flex gap-2">
                  <Button variant="destructive" disabled={fechando} onClick={() => void fechar()}>
                    {fechando ? "Fechando…" : "Sim, fechar"}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmandoFechamento(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                className="mt-block"
                disabled={!podeFechar || !contagemValida}
                onClick={() => setConfirmandoFechamento(true)}
              >
                Fechar caixa e conferir
              </Button>
            )}
          </Card>
        </>
      )}

      <Card className="mt-4 p-5">
        <p className="mb-block ed-title">Fechamentos recentes</p>
        <CashClosuresPanel storeId={activeStore} />
      </Card>
    </div>
  );
}

/**
 * O resultado da conferencia: contado primeiro, esperado depois.
 *
 * A ordem na tela repete a ordem dos fatos. O numero que o operador
 * produziu vem antes do numero que o sistema calculou -- ler ao contrario
 * sugeriria que a contagem existe pra bater com o esperado, que e
 * exatamente a leitura errada.
 */
function ResultadoFechamento({ r }: { r: CloseResult }) {
  const { kind } = classifyDifference(r.diff);
  return (
    <Card
      className={`mb-4 p-5 ${
        kind === "exato"
          ? "border-success/40 bg-success/5"
          : r.precisaExplicacao
            ? "border-destructive/40 bg-destructive/5"
            : "border-warning/40 bg-warning/5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="ed-title">Caixa fechado</p>
        <div className="flex items-center gap-2">
          {r.cego ? (
            <Badge variant="muted">Conferência cega</Badge>
          ) : (
            <Badge variant="outline">Esperado revelado antes</Badge>
          )}
          <Badge
            variant={kind === "exato" ? "success" : kind === "falta" ? "danger" : "warning"}
          >
            {DIFFERENCE_LABELS[kind]}
            {kind === "exato" ? "" : ` ${formatBRL(Math.abs(r.diff))}`}
          </Badge>
        </div>
      </div>
      {/* Empilha no celular: medido a 375px, as tres colunas davam 92px e
          "R$ 1.170,00" quebrava em duas linhas ("R$" / "1.170,00") nos tres
          numeros -- justo os numeros que a tela existe pra deixar obvios. */}
      <div className="mt-block grid gap-3 sm:grid-cols-3">
        <div>
          <p className="ed-label">Contado</p>
          <p className="tabular mt-0.5 font-display text-xl font-semibold">
            {formatBRL(r.counted)}
          </p>
        </div>
        <div>
          <p className="ed-label">Esperado</p>
          <p className="tabular mt-0.5 font-display text-xl font-semibold">
            {formatBRL(r.expected)}
          </p>
        </div>
        <div>
          <p className="ed-label">Diferença</p>
          <p className="tabular mt-0.5 font-display text-xl font-semibold">
            {formatBRL(r.diff)}
          </p>
        </div>
      </div>
      {r.precisaExplicacao ? (
        <p className="mt-block text-sm">
          Acima de {formatBRL(CASH_DIFFERENCE_TOLERANCE)} a diferença precisa de explicação
          escrita. Registre em <strong>Fechamentos recentes</strong>, logo abaixo — enquanto não
          for explicada, ela fica pendente no sino.
        </p>
      ) : null}
      <Button className="mt-block" variant="outline" size="sm" onClick={() => window.print()}>
        Imprimir fechamento
      </Button>
    </Card>
  );
}
