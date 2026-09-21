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
import { HANDOVER_LABELS, safeAmount, type HandoverCheck } from "@/lib/shift-handover";
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
  ficaNaGaveta: number;
  vaiProCofre: number;
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
  /* Estado proprio pra ficha da ABERTURA, separado do fechamento de
     proposito: reaproveitar o mesmo qtys deixaria a contagem da gaveta
     recebida pre-preenchida no fechamento do turno -- ancorando justo a
     contagem que precisa ser cega. */
  const [abrirModo, setAbrirModo] = useState<CountMode>("cedula");
  const [abrirQtys, setAbrirQtys] = useState<Record<string, string>>({});
  const [abrirTotal, setAbrirTotal] = useState("");
  const [handoverResult, setHandoverResult] = useState<HandoverCheck | null>(null);
  const [trocoTurno, setTrocoTurno] = useState("");

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
  // Contagem da ABERTURA: com troca pendente sai da ficha (cega); sem
  // troca e o troco que o operador esta colocando na gaveta e ele sabe
  // quanto e -- nao ha o que conferir contra ninguem.
  const temTroca = Boolean(d?.handover);
  const aberturaContado = !temTroca
    // parseMoneyInput e nao Number(): "350,00" digitado no campo vira NaN no
    // Number(), e o servidor recusa com "Fundo inicial inválido" sem o
    // operador entender o que fez de errado.
    ? parseMoneyInput(openAmt)
    : abrirModo === "cedula"
      ? breakdownTotal(abrirQtys)
      : parseMoneyInput(abrirTotal);
  const aberturaValida =
    Number.isFinite(aberturaContado) &&
    aberturaContado >= 0 &&
    (!temTroca
      ? true
      : abrirModo === "cedula"
        ? Object.values(abrirQtys).some((v) => parseQty(v) > 0) &&
          Object.values(abrirQtys).every((v) => Number.isFinite(parseQty(v)))
        : abrirTotal.trim() !== "");
  const contagemValida =
    Number.isFinite(contado) &&
    contado >= 0 &&
    (modo === "cedula" ? !fichaVazia && !fichaInvalida : totalDireto.trim() !== "");

  // Depois de contagemValida de proposito: so faz sentido comparar o troco
  // com o contado quando o contado ja e um numero legivel.
  const trocaValor = trocoTurno.trim() ? parseMoneyInput(trocoTurno) : 0;
  const trocaInvalida =
    trocoTurno.trim() !== "" &&
    (!Number.isFinite(trocaValor) ||
      trocaValor < 0 ||
      (contagemValida && trocaValor > contado + 0.005));

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
          handover: trocaValor > 0 ? trocaValor : undefined,
        },
      });
      setResult({
        expected: r.expected,
        counted: r.counted,
        diff: r.diff,
        cego: r.cego,
        precisaExplicacao: r.precisaExplicacao,
        ficaNaGaveta: r.ficaNaGaveta,
        vaiProCofre: r.vaiProCofre,
      });
      setConfirmandoFechamento(false);
      setQtys({});
      setTotalDireto("");
      setTrocoTurno("");
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

  /*
    Abrir o caixa -- e, quando ha troco do turno anterior, RECEBER a gaveta.

    A gaveta recebida se conta antes de ver o que o outro declarou. Sem isso
    quem entra so transcreve o numero de quem saiu, herda o erro alheio, e a
    diferenca volta a nao ter dono. E a hora de achar um desencontro e essa,
    com as duas pessoas na frente da gaveta.
  */
  async function abrir() {
    if (openingCaixa) return;
    setOpeningCaixa(true);
    try {
      const breakdown =
        temTroca && abrirModo === "cedula" ? normalizeBreakdown(abrirQtys) : null;
      const r = await openRegisterFn({
        data: {
          storeId: activeStore,
          amount: breakdown ? undefined : aberturaContado,
          breakdown,
        },
      });
      setHandoverResult(r.handover ?? null);
      setResult(null);
      setAbrirQtys({});
      setAbrirTotal("");
      toast.success(r.handover ? "Gaveta conferida e caixa aberto." : "Caixa aberto.");
      void qc.invalidateQueries({ queryKey: ["register"] });
      void qc.invalidateQueries({ queryKey: ["cash-closures"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao abrir o caixa.");
    } finally {
      setOpeningCaixa(false);
    }
  }


  return (
    <div>
      <PageHeader title="Caixa" description="Abertura, sangria, suprimento e conferência de fechamento." />

      {result ? <ResultadoFechamento r={result} /> : null}
      {handoverResult ? <ResultadoTroca h={handoverResult} /> : null}

      {!d?.register ? (
        d.handover ? (
          /* Receber a gaveta e contar a gaveta. O valor que o turno anterior
             declarou nao vem do servidor ainda: quem entra conta primeiro e
             so depois ve. Aceitar o numero do outro herdaria o erro alheio, e
             a diferenca voltaria a nao ter dono.

             max-w-4xl e nao 2xl: medido no laboratorio, a 672px a ficha nao
             divide em duas colunas e o cartao vai a 903px de altura --
             rolagem demais pro momento em que duas pessoas estao paradas na
             frente da gaveta esperando. */
          <Card className="max-w-4xl p-5">
            <p className="ed-title">Receber a gaveta do turno anterior</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {d.handover.by ?? "O turno anterior"} deixou troco na gaveta
              {d.handover.closedAt ? ` em ${formatDateTime(d.handover.closedAt)}` : ""}. Conte o
              que está na gaveta antes de abrir — o valor declarado aparece depois da contagem.
            </p>

            <div className="mt-block">
              <CashCountSheet
                modo={abrirModo}
                onModo={setAbrirModo}
                qtys={abrirQtys}
                onQtys={setAbrirQtys}
                totalDireto={abrirTotal}
                onTotalDireto={setAbrirTotal}
                disabled={!podeFechar || openingCaixa}
              />
            </div>

            <div className="mt-block flex items-baseline justify-between border-t border-border pt-3">
              <span className="ed-label">Contado na gaveta</span>
              <span className="tabular font-display text-2xl font-semibold">
                {aberturaValida ? formatBRL(aberturaContado) : "—"}
              </span>
            </div>

            <Button
              className="mt-block"
              disabled={openingCaixa || !podeFechar || !aberturaValida}
              onClick={() => void abrir()}
            >
              {openingCaixa ? "Abrindo…" : "Conferir e abrir o caixa"}
            </Button>
          </Card>
        ) : (
          <Card className="max-w-md p-5">
            <p className="text-sm text-muted-foreground">Nenhum caixa aberto nesta loja.</p>
            <Field label="Fundo inicial" className="mt-4">
              <Input value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} />
            </Field>
            <Button
              className="mt-4"
              disabled={openingCaixa || !podeFechar}
              onClick={() => void abrir()}
            >
              {openingCaixa ? "Abrindo…" : "Abrir caixa"}
            </Button>
          </Card>
        )
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

            {/* Quanto fica na gaveta nao e informacao cega: e uma decisao de
                quem fecha, sobre dinheiro que ele acabou de contar. Vazio =
                fim do dia, gaveta recolhida. */}
            <div className="mt-block">
              <Field label="Fica na gaveta para o próximo turno (vazio = fim do dia)">
                <Input
                  className="max-w-48"
                  inputMode="decimal"
                  placeholder="0,00"
                  disabled={!podeFechar || fechando}
                  value={trocoTurno}
                  onChange={(e) => setTrocoTurno(e.target.value)}
                />
              </Field>
              {trocaValor > 0 && contagemValida ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Ficam {formatBRL(trocaValor)} na gaveta e{" "}
                  {formatBRL(safeAmount(contado, trocaValor))} saem para o cofre. Quem assumir o
                  próximo turno vai contar a gaveta antes de abrir.
                </p>
              ) : null}
              {trocaInvalida ? (
                <p className="mt-1 text-sm text-destructive">
                  Não dá para deixar na gaveta mais do que foi contado.
                </p>
              ) : null}
            </div>

            {confirmandoFechamento ? (
              <div className="mt-block rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="text-sm">
                  Fechar o caixa com {formatBRL(contado)} contados?
                  {trocaValor > 0
                    ? ` Ficam ${formatBRL(trocaValor)} na gaveta para o próximo turno.`
                    : " A gaveta é recolhida inteira (fim do dia)."}
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
                disabled={!podeFechar || !contagemValida || trocaInvalida}
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
      <p className="mt-block text-sm text-muted-foreground">
        {r.ficaNaGaveta > 0 ? (
          <>
            Ficam <strong className="text-foreground">{formatBRL(r.ficaNaGaveta)}</strong> na gaveta
            para o próximo turno e {formatBRL(r.vaiProCofre)} saem para o cofre. Quem assumir vai
            contar a gaveta antes de abrir — é nessa segunda contagem que um desencontro aparece.
          </>
        ) : (
          <>Gaveta recolhida inteira: {formatBRL(r.vaiProCofre)} saem para o cofre.</>
        )}
      </p>
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

/**
 * O que as duas contagens da virada disseram.
 *
 * Os dois numeros aparecem lado a lado, com nome: esta diferenca nao e "o
 * sistema contra a gaveta", e uma pessoa contra outra sobre o MESMO
 * dinheiro. Guardar so o resultado apagaria de quem foi cada numero, que e
 * justamente o que a troca de turno existe pra registrar.
 */
function ResultadoTroca({ h }: { h: HandoverCheck }) {
  const bateu = h.kind === "confere" || h.dentroDaTolerancia;
  return (
    <Card
      className={`mb-4 p-5 ${
        bateu ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="ed-title">Gaveta recebida</p>
        <Badge variant={bateu ? "success" : "danger"}>
          {HANDOVER_LABELS[h.kind]}
          {h.kind === "confere" ? "" : ` ${formatBRL(Math.abs(h.diferenca))}`}
        </Badge>
      </div>
      <div className="mt-block grid gap-3 sm:grid-cols-3">
        <div>
          <p className="ed-label">Você contou</p>
          <p className="tabular mt-0.5 font-display text-xl font-semibold">
            {formatBRL(h.recebido)}
          </p>
        </div>
        <div>
          <p className="ed-label">Turno anterior deixou</p>
          <p className="tabular mt-0.5 font-display text-xl font-semibold">
            {formatBRL(h.deixado)}
          </p>
        </div>
        <div>
          <p className="ed-label">Diferença</p>
          <p className="tabular mt-0.5 font-display text-xl font-semibold">
            {formatBRL(h.diferenca)}
          </p>
        </div>
      </div>
      {bateu ? null : (
        <p className="mt-block text-sm">
          Resolva agora, com quem entregou a gaveta ainda por perto. Seu turno começa com{" "}
          <strong>{formatBRL(h.recebido)}</strong> — o que está realmente na gaveta — e essa
          diferença fica registrada na troca, sem entrar no fechamento de nenhum dos dois turnos.
        </p>
      )}
    </Card>
  );
}
