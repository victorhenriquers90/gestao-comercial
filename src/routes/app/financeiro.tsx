import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { DataTable, EmptyState, KpiCard, Pager, PageHeader, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { type PickedSupplier, SupplierPicker } from "@/components/supplier-picker";
import { useSelection } from "@/hooks/use-selection";
import {
  ACCOUNT_STATUS_LABELS,
  CASH_ACCOUNT_LABELS,
  EXPENSE_CATEGORIES,
  PAYMENT_LABELS,
  RECEIPT_METHOD_LABELS,
  RECEIPT_METHODS,
  type ReceiptMethod,
} from "@/lib/constants";
import { parseMoneyInput } from "@/lib/money-input";
import { runAction } from "@/lib/run-action";
import { CrediarioPanel } from "@/components/crediario-panel";
import { CardSettlementPanel } from "@/components/card-settlement-panel";
import { formatBRL, formatDate } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import {
  cancelExpenseFn,
  cancelPayableFn,
  cancelReceivableFn,
  cashflowFn,
  listExpensesFn,
  listPayablesFn,
  listReceivablesFn,
  reverseSettlementFn,
  saveExpenseFn,
  savePayableFn,
  saveReceivableFn,
  settlePayableFn,
  settleReceivableFn,
} from "@/lib/server/finance";
import { cn, num } from "@/lib/utils";

export const Route = createFileRoute("/app/financeiro")({ component: FinanceiroPage });

type CancelTarget = {
  kind: "pagar" | "receber" | "despesa" | "estorno-pagar" | "estorno-receber";
  id: number;
  label: string;
  /** Pago/recebido em dinheiro: o cancelamento ou estorno mexe no caixa aberto. */
  dinheiro?: boolean;
  /** Valor da baixa que o estorno desfaz. */
  valor?: number;
};

function FinanceiroPage() {
  const loc = useLocation();
  const navigate = useNavigate();
  /*
    A aba vem da URL.

    O aviso "Parcelas vencendo hoje" no sino aponta pra
    /app/financeiro?tab=cobranca. Sem isto, o link levava pra tela certa e
    abria a aba de contas a pagar -- avisar e largar a pessoa na aba errada
    e quase pior do que nao avisar.
  */
  const abaPedida =
    typeof (loc.search as { tab?: unknown }).tab === "string"
      ? (loc.search as { tab?: string }).tab
      : new URLSearchParams(loc.searchStr.replace(/^\?/, "")).get("tab");
  const ABAS = ["pagar", "receber", "cobranca", "cartoes", "fluxo", "desp"];
  const aba = abaPedida && ABAS.includes(abaPedida) ? abaPedida : "pagar";
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const range = resolvePeriod("month");
  const [openPay, setOpenPay] = useState(false);
  const [openRec, setOpenRec] = useState(false);
  /** Titulo sendo recebido e como o cliente pagou (sem padrao: aqui pode ser banco). */
  const [recebendoId, setRecebendoId] = useState<number | null>(null);
  const [formaRec, setFormaRec] = useState<ReceiptMethod | "">("");
  /** Trava o envio da despesa: dois cliques gravavam dois lancamentos iguais. */
  const [lancandoDespesa, setLancandoDespesa] = useState(false);
  /**
   * Mesmo problema da despesa, em mais tres lugares: "Pagar", "Confirmar"
   * recebimento e os dois dialogos de "Salvar" so tinham `disabled={!x}`,
   * que nao cobre o clique duplo -- o pedido em voo ainda le a condicao como
   * satisfeita. "Pagar"/"Confirmar" duplicado grava a baixa duas vezes
   * (o servidor agora recusa baixa acima do saldo, mas o segundo pedido ainda
   * chegaria a ser enviado e o operador veria um erro depois de um sucesso);
   * no recebimento em dinheiro o duplicado lancaria o dinheiro duas vezes no
   * caixa, inflando a gaveta com uma "sobra" fantasma no fechamento. "Salvar" duplicado cria a conta/titulo duas
   * vezes.
   */
  const [pagandoId, setPagandoId] = useState<number | null>(null);
  /** Como a loja pagou o fornecedor (sem padrao: pode ser banco) -- mesma pergunta do recebimento, em dinheiro sai do caixa aberto. */
  const [formaPag, setFormaPag] = useState<ReceiptMethod | "">("");
  const [confirmandoPagamento, setConfirmandoPagamento] = useState(false);
  const [confirmandoRecebimento, setConfirmandoRecebimento] = useState(false);
  const [salvandoConta, setSalvandoConta] = useState(false);
  const [salvandoTitulo, setSalvandoTitulo] = useState(false);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [paySupplier, setPaySupplier] = useState<PickedSupplier | null>(null);
  const [recCustomer, setRecCustomer] = useState<PickedCustomer | null>(null);
  const [category, setCategory] = useState("Compras");
  /** Lancamento que a pessoa esta cancelando e o motivo (obrigatorio: vai pra Auditoria). */
  const [cancelando, setCancelando] = useState<CancelTarget | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const pay = useQuery({
    queryKey: ["ap", storeId],
    queryFn: () => listPayablesFn({ data: { storeId: storeId ?? undefined } }),
  });
  const rec = useQuery({
    queryKey: ["ar", storeId],
    queryFn: () => listReceivablesFn({ data: { storeId: storeId ?? undefined } }),
  });
  const flow = useQuery({
    queryKey: ["flow", storeId, range.from, range.to],
    queryFn: () => cashflowFn({ data: { from: range.from, to: range.to, storeId: storeId ?? undefined } }),
  });
  const [expensesPage, setExpensesPage] = useState(0);
  const EXPENSES_PAGE_SIZE = 100;
  const expenses = useQuery({
    queryKey: ["expenses", storeId, expensesPage],
    queryFn: () =>
      listExpensesFn({
        data: { storeId: storeId ?? undefined, limit: EXPENSES_PAGE_SIZE, offset: expensesPage * EXPENSES_PAGE_SIZE },
      }),
    placeholderData: keepPreviousData,
  });
  const expenseItems = expenses.data?.items ?? [];
  const expensesTotal = expenses.data?.total ?? 0;
  const expensesPaginaVazia =
    !expenses.isPlaceholderData && expenses.data != null && expenseItems.length === 0 && expensesPage > 0;
  useEffect(() => {
    if (expensesPaginaVazia) setExpensesPage(0);
  }, [expensesPaginaVazia]);

  if (pay.isPending) return <PageSkeleton />;
  if (pay.error) return <QueryError error={pay.error} fallback="Erro ao carregar o financeiro." />;

  function pedirCancelamento(alvo: CancelTarget) {
    setMotivo("");
    setCancelando(alvo);
  }

  async function confirmarCancelamento() {
    if (!cancelando || confirmandoCancelamento) return;
    if (!motivo.trim()) return toast.error("Informe o motivo do cancelamento.");
    const alvo = cancelando;
    setConfirmandoCancelamento(true);
    try {
      const data = { id: alvo.id, reason: motivo };
      const ok = await runAction(
        () => {
          switch (alvo.kind) {
            case "pagar":
              return cancelPayableFn({ data });
            case "receber":
              return cancelReceivableFn({ data });
            case "estorno-pagar":
              return reverseSettlementFn({ data: { kind: "payable", ...data } });
            case "estorno-receber":
              return reverseSettlementFn({ data: { kind: "receivable", ...data } });
            default:
              return cancelExpenseFn({ data });
          }
        },
        {
          sucesso:
            alvo.kind === "despesa"
              ? alvo.dinheiro
                ? "Despesa cancelada e dinheiro devolvido ao caixa."
                : "Despesa cancelada."
              : alvo.kind === "estorno-pagar"
                ? alvo.dinheiro
                  ? "Pagamento estornado e dinheiro devolvido ao caixa."
                  : "Pagamento estornado."
                : alvo.kind === "estorno-receber"
                  ? alvo.dinheiro
                    ? "Recebimento estornado e dinheiro retirado do caixa."
                    : "Recebimento estornado."
                  : "Conta cancelada.",
        },
      );
      if (!ok) return;
      setCancelando(null);
      for (const key of ["ap", "ar", "expenses", "flow", "register", "crediario", "customers"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    } finally {
      setConfirmandoCancelamento(false);
    }
  }

  const ehEstorno = cancelando?.kind === "estorno-pagar" || cancelando?.kind === "estorno-receber";
  const overduePay = (pay.data ?? []).filter((r) => String(r.status) === "vencido").length;
  const overdueRec = (rec.data ?? []).filter((r) => String(r.status) === "vencido").length;

  return (
    <div>
      <PageHeader title="Financeiro" description="Pagar, receber, despesas e fluxo de caixa." />
      {flow.data ? (
        <div className="mb-5 kpi-grid">
          <KpiCard label="Entradas" value={formatBRL(flow.data.entries)} tone="success" />
          <KpiCard label="Saídas" value={formatBRL(flow.data.exits)} tone="warning" />
          <KpiCard label="Saldo do período" value={formatBRL(flow.data.closing)} />
          <KpiCard
            label="Títulos vencidos"
            value={String(overduePay + overdueRec)}
            tone={overduePay + overdueRec ? "danger" : "default"}
            hint={`${overduePay} a pagar · ${overdueRec} a receber`}
          />
        </div>
      ) : null}

      <Tabs
        value={aba}
        onValueChange={(v) =>
          void navigate({
            to: "/app/financeiro",
            search: (v === "pagar" ? {} : { tab: v }) as never,
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="receber">Contas a receber</TabsTrigger>
          <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
          <TabsTrigger value="cobranca">Cobrança</TabsTrigger>
          <TabsTrigger value="cartoes">Cartões</TabsTrigger>
          <TabsTrigger value="desp">Despesas</TabsTrigger>
        </TabsList>
        <TabsContent value="pagar">
          <Button
            className="mb-block"
            size="sm"
            onClick={() => {
              setDesc("");
              setAmount("");
              setDue("");
              setPaySupplier(null);
              setCategory("Compras");
              setOpenPay(true);
            }}
          >
            Nova conta
          </Button>
          {!pay.data?.length ? (
            <EmptyState
              title="Nenhuma conta a pagar cadastrada."
              description="Lance a primeira conta ou receba um pedido de compra para gerar automaticamente."
              action={
                <Button size="sm" onClick={() => setOpenPay(true)}>
                  Nova conta
                </Button>
              }
            />
          ) : (
          <DataTable
            headers={
              <tr>
                <Th>Descrição</Th>
                <Th>Fornecedor</Th>
                <Th>Vencimento</Th>
                <Th className="col-num">Valor</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            }
          >
            {pay.data.map((r: Record<string, unknown>) => {
              const late = String(r.status) === "vencido";
              return (
                <tr
                  key={String(r.id)}
                  className={cn(
                    "border-b border-border last:border-0",
                    late && "bg-destructive/10",
                  )}
                >
                  <Td>{String(r.description)}</Td>
                  <Td>{String(r.supplier_name ?? "—")}</Td>
                  <Td className={late ? "text-destructive" : undefined}>{formatDate(String(r.due_date))}</Td>
                  <Td className="tabular col-num">{formatBRL(num(r.amount) - num(r.paid_amount))}</Td>
                  <Td>
                    <Badge variant={statusBadgeVariant(String(r.status))}>
                      {ACCOUNT_STATUS_LABELS[String(r.status)] ?? String(r.status)}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                    {r.status !== "pago" && r.status !== "cancelado" ? (
                      pagandoId === num(r.id) ? (
                        // Mesma pergunta do recebimento: em dinheiro (comum
                        // quando o entregador cobra na hora) sai do caixa
                        // aberto da loja; antes a baixa nao lancava nada e a
                        // gaveta fechava com SOBRA sem explicacao.
                        <div className="flex items-center gap-2">
                          <Select
                            className="h-8 w-40"
                            aria-label="Forma de pagamento"
                            value={formaPag}
                            onChange={(e) => setFormaPag(e.target.value as ReceiptMethod | "")}
                          >
                            <option value="">Como pagou?</option>
                            {RECEIPT_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {RECEIPT_METHOD_LABELS[m]}
                              </option>
                            ))}
                          </Select>
                          <Button
                            size="sm"
                            disabled={!formaPag || confirmandoPagamento}
                            onClick={async () => {
                              if (!formaPag || confirmandoPagamento) return;
                              setConfirmandoPagamento(true);
                              try {
                                const ok = await runAction(
                                  () =>
                                    settlePayableFn({
                                      data: {
                                        id: num(r.id),
                                        amount: num(r.amount) - num(r.paid_amount),
                                        method: formaPag,
                                        storeId: storeId ?? null,
                                      },
                                    }),
                                  { sucesso: "Baixa registrada." },
                                );
                                if (!ok) return;
                                setPagandoId(null);
                                void qc.invalidateQueries({ queryKey: ["ap"] });
                                void qc.invalidateQueries({ queryKey: ["register"] });
                              } finally {
                                setConfirmandoPagamento(false);
                              }
                            }}
                          >
                            {confirmandoPagamento ? "Confirmando…" : "Confirmar"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPagandoId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPagandoId(num(r.id));
                            setFormaPag("");
                          }}
                        >
                          Pagar
                        </Button>
                      )
                    ) : null}
                    {pagandoId !== num(r.id) && r.last_settlement_amount != null && r.status !== "cancelado" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          pedirCancelamento({
                            kind: "estorno-pagar",
                            id: num(r.id),
                            label: String(r.description),
                            dinheiro: String(r.last_settlement_method) === "dinheiro",
                            valor: num(r.last_settlement_amount),
                          })
                        }
                      >
                        Estornar último pagamento
                      </Button>
                    ) : null}
                    {pagandoId !== num(r.id) &&
                    num(r.paid_amount) < 0.01 &&
                    (r.status === "pendente" || r.status === "vencido") &&
                    r.purchase_id == null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => pedirCancelamento({ kind: "pagar", id: num(r.id), label: String(r.description) })}
                      >
                        Cancelar conta
                      </Button>
                    ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
          )}
        </TabsContent>
        <TabsContent value="cartoes">
          <CardSettlementPanel storeId={storeId ?? null} />
        </TabsContent>
        <TabsContent value="cobranca">
          <CrediarioPanel storeId={storeId ?? null} />
        </TabsContent>
        <TabsContent value="receber">
          <Button
            className="mb-block"
            size="sm"
            onClick={() => {
              setDesc("");
              setAmount("");
              setDue("");
              setRecCustomer(null);
              setOpenRec(true);
            }}
          >
            Novo título
          </Button>
          {!rec.data?.length ? (
            <EmptyState
              title="Nenhuma conta a receber cadastrada."
              description="Lance o primeiro título ou venda a prazo para gerar automaticamente."
              action={
                <Button size="sm" onClick={() => setOpenRec(true)}>
                  Novo título
                </Button>
              }
            />
          ) : (
          <DataTable
            headers={
              <tr>
                <Th>Descrição</Th>
                <Th>Cliente</Th>
                <Th>Vencimento</Th>
                <Th className="col-num">Valor</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            }
          >
            {rec.data.map((r: Record<string, unknown>) => {
              const late = String(r.status) === "vencido";
              return (
                <tr
                  key={String(r.id)}
                  className={cn(
                    "border-b border-border last:border-0",
                    late && "bg-destructive/10",
                  )}
                >
                  <Td>{String(r.description)}</Td>
                  <Td>{String(r.customer_name ?? "—")}</Td>
                  <Td className={late ? "text-destructive" : undefined}>{formatDate(String(r.due_date))}</Td>
                  <Td className="tabular col-num">{formatBRL(num(r.amount) - num(r.received_amount))}</Td>
                  <Td>
                    <Badge variant={statusBadgeVariant(String(r.status))}>
                      {ACCOUNT_STATUS_LABELS[String(r.status)] ?? String(r.status)}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                    {r.status !== "pago" && r.status !== "cancelado" ? (
                      recebendoId === num(r.id) ? (
                        // Pergunta COMO foi pago antes de dar baixa: em dinheiro
                        // o valor entra no caixa aberto; antes a baixa nao
                        // lancava nada e a gaveta fechava com sobra.
                        <div className="flex items-center gap-2">
                          <Select
                            className="h-8 w-40"
                            aria-label="Forma de recebimento"
                            value={formaRec}
                            onChange={(e) => setFormaRec(e.target.value as ReceiptMethod | "")}
                          >
                            <option value="">Como pagou?</option>
                            {RECEIPT_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {RECEIPT_METHOD_LABELS[m]}
                              </option>
                            ))}
                          </Select>
                          <Button
                            size="sm"
                            disabled={!formaRec || confirmandoRecebimento}
                            onClick={async () => {
                              if (!formaRec || confirmandoRecebimento) return;
                              setConfirmandoRecebimento(true);
                              try {
                                const ok = await runAction(
                                  () =>
                                    settleReceivableFn({
                                      data: {
                                        id: num(r.id),
                                        amount: num(r.amount) - num(r.received_amount),
                                        method: formaRec,
                                        storeId: storeId ?? null,
                                      },
                                    }),
                                  { sucesso: "Recebimento registrado." },
                                );
                                if (!ok) return;
                                setRecebendoId(null);
                                void qc.invalidateQueries({ queryKey: ["ar"] });
                                void qc.invalidateQueries({ queryKey: ["register"] });
                              } finally {
                                setConfirmandoRecebimento(false);
                              }
                            }}
                          >
                            {confirmandoRecebimento ? "Confirmando…" : "Confirmar"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRecebendoId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRecebendoId(num(r.id));
                            setFormaRec("");
                          }}
                        >
                          Receber
                        </Button>
                      )
                    ) : null}
                    {recebendoId !== num(r.id) && r.last_settlement_amount != null && r.status !== "cancelado" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          pedirCancelamento({
                            kind: "estorno-receber",
                            id: num(r.id),
                            label: String(r.description),
                            dinheiro: String(r.last_settlement_method) === "dinheiro",
                            valor: num(r.last_settlement_amount),
                          })
                        }
                      >
                        Estornar último recebimento
                      </Button>
                    ) : null}
                    {recebendoId !== num(r.id) &&
                    num(r.received_amount) < 0.01 &&
                    (r.status === "pendente" || r.status === "vencido") &&
                    r.origin === "manual" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          pedirCancelamento({ kind: "receber", id: num(r.id), label: String(r.description) })
                        }
                      >
                        Cancelar conta
                      </Button>
                    ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
          )}
        </TabsContent>
        <TabsContent value="fluxo">
          <div className="space-y-2 text-sm">
            {(flow.data?.inflows ?? []).map((i) => (
              <div key={i.method} className="flex justify-between rounded-lg border border-border bg-card px-4 py-3">
                <span>{PAYMENT_LABELS[i.method as keyof typeof PAYMENT_LABELS] ?? CASH_ACCOUNT_LABELS[i.method] ?? i.method}</span>
                <span className="tabular">{formatBRL(i.total)}</span>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="desp">
          <form
            className="mb-4 flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (lancandoDespesa) return;
              // O <form> precisa ser guardado ANTES do await: depois dele o
              // React zera e.currentTarget, e o reset() estourava
              // "Cannot read properties of null" -- dentro de um handler async
              // sem catch, ou seja, em silencio. Na pratica: aparecia "Despesa
              // lancada." mas os campos continuavam preenchidos, o operador
              // achava que nao tinha salvo e clicava de novo. Sem trava de
              // envio, isso gravava a despesa DUPLICADA.
              const form = e.currentTarget;
              const fd = new FormData(form);
              setLancandoDespesa(true);
              try {
                await saveExpenseFn({
                  data: {
                    description: String(fd.get("d")),
                    category: String(fd.get("c")),
                    amount: Number(fd.get("a")),
                    spentAt: String(fd.get("dt")),
                    method: String(fd.get("m")),
                    storeId: storeId,
                  },
                });
                toast.success("Despesa lançada.");
                void qc.invalidateQueries({ queryKey: ["expenses"] });
                void qc.invalidateQueries({ queryKey: ["flow"] });
                form.reset();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Falha ao lançar a despesa.");
              } finally {
                setLancandoDespesa(false);
              }
            }}
          >
            {/* Os quatro campos nao tinham rotulo nenhum -- e o de data nem
                placeholder: um campo vazio, sem nada dizendo que e a data da
                despesa. E um lancamento de dinheiro SAINDO do caixa. */}
            <Field label="Descrição" className="min-w-48 flex-1">
              <Input name="d" required />
            </Field>
            <Field label="Categoria">
              <Select name="c">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Valor" className="w-36">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input name="a" type="number" step="0.01" min="0.01" className="pl-9" required />
              </div>
            </Field>
            <Field label="Data da despesa">
              <Input name="dt" type="date" required />
            </Field>
            <Field label="Como pagou?">
              <Select name="m" defaultValue="dinheiro">
                {RECEIPT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {RECEIPT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" className="mb-0.5 self-end" disabled={lancandoDespesa}>
              {lancandoDespesa ? "Lançando…" : "Lançar"}
            </Button>
          </form>
          {!expenseItems.length ? (
            <EmptyState
              title="Nenhuma despesa lançada."
              description="Use o formulário acima para lançar a primeira despesa (aluguel, energia, marketing…)."
            />
          ) : (
          <div className={expenses.isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={expenses.isPlaceholderData}>
          <DataTable
            headers={
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th>Categoria</Th>
                <Th className="col-num">Valor</Th>
                <Th></Th>
              </tr>
            }
          >
            {(expenseItems as Record<string, unknown>[]).map((e) => (
              <tr key={String(e.id)} className="border-b border-border last:border-0">
                <Td>{formatDate(String(e.spent_at))}</Td>
                <Td>{String(e.description)}</Td>
                <Td>{String(e.category ?? "—")}</Td>
                <Td className="tabular col-num">{formatBRL(num(e.amount))}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      pedirCancelamento({
                        kind: "despesa",
                        id: num(e.id),
                        label: String(e.description),
                        dinheiro: e.cash_movement_id != null,
                      })
                    }
                  >
                    Cancelar despesa
                  </Button>
                </Td>
              </tr>
            ))}
          </DataTable>
          <Pager page={expensesPage} pageSize={EXPENSES_PAGE_SIZE} shown={expenseItems.length} total={expensesTotal} onPage={setExpensesPage} />
          </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={cancelando != null} onOpenChange={(o) => (o ? null : setCancelando(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelando?.kind === "estorno-pagar"
                ? "Estornar último pagamento"
                : cancelando?.kind === "estorno-receber"
                  ? "Estornar último recebimento"
                  : cancelando?.kind === "despesa"
                    ? "Cancelar despesa"
                    : "Cancelar conta"}
            </DialogTitle>
            <DialogDescription>
              {cancelando ? `“${cancelando.label}”. ` : ""}
              {ehEstorno
                ? `Desfaz a última baixa (${formatBRL(cancelando?.valor ?? 0)}): o título volta a ficar em aberto pelo saldo de antes. O estorno fica registrado na Auditoria com o seu nome e o motivo.`
                : "O lançamento deixa de contar nos totais e fica registrado na Auditoria com o seu nome e o motivo."}
              {cancelando?.kind === "despesa" && cancelando.dinheiro
                ? " Como foi paga em dinheiro, o valor volta para o caixa aberto da loja."
                : ""}
              {cancelando?.kind === "estorno-pagar" && cancelando.dinheiro
                ? " Como foi pago em dinheiro, o valor volta para o caixa aberto da loja."
                : ""}
              {cancelando?.kind === "estorno-receber" && cancelando.dinheiro
                ? " Como foi recebido em dinheiro, o valor sai do caixa aberto da loja."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Field label={ehEstorno ? "Motivo do estorno" : "Motivo do cancelamento"}>
            <Input
              value={motivo}
              maxLength={200}
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmarCancelamento();
              }}
            />
          </Field>
          <div className="mt-4 flex gap-2">
            <Button
              variant="destructive"
              disabled={!motivo.trim() || confirmandoCancelamento}
              onClick={() => void confirmarCancelamento()}
            >
              {confirmandoCancelamento
                ? ehEstorno
                  ? "Estornando…"
                  : "Cancelando…"
                : ehEstorno
                  ? "Confirmar estorno"
                  : "Confirmar cancelamento"}
            </Button>
            <Button variant="ghost" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={openPay} onOpenChange={setOpenPay}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conta a pagar</DialogTitle>
          </DialogHeader>
          <Field label="Fornecedor">
            <SupplierPicker
              placeholder="Sem fornecedor (opcional) — digite para buscar"
              value={paySupplier}
              onChange={setPaySupplier}
            />
          </Field>
          <Field label="Descrição" className="mt-block">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Categoria" className="mt-block">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="Compras">Compras</option>
            </Select>
          </Field>
          <Field label="Vencimento" className="mt-block">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Valor" className="mt-block">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            disabled={salvandoConta}
            onClick={async () => {
              if (salvandoConta) return;
              if (!desc.trim() || !due) {
                return toast.error("Preencha descrição e vencimento.");
              }
              // parseMoneyInput, nao Number(): "1.500,00" dava NaN, e a
              // mensagem antiga ("preencha o valor") acusava a pessoa de nao
              // ter preenchido o campo que ela tinha acabado de preencher.
              const valor = parseMoneyInput(amount);
              if (!Number.isFinite(valor) || valor <= 0) {
                return toast.error("Informe um valor maior que zero.");
              }
              setSalvandoConta(true);
              try {
                const ok = await runAction(
                  () =>
                    savePayableFn({
                      data: {
                        description: desc,
                        dueDate: due,
                        amount: valor,
                        storeId,
                        supplierId: paySupplier?.id ?? null,
                        category,
                      },
                    }),
                  { sucesso: "Conta criada." },
                );
                if (!ok) return;
                setOpenPay(false);
                void qc.invalidateQueries({ queryKey: ["ap"] });
              } finally {
                setSalvandoConta(false);
              }
            }}
          >
            {salvandoConta ? "Salvando…" : "Salvar"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={openRec} onOpenChange={setOpenRec}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conta a receber</DialogTitle>
          </DialogHeader>
          <Field label="Cliente">
            <CustomerPicker placeholder="Sem cliente (opcional) — digite para buscar" value={recCustomer} onChange={setRecCustomer} />
          </Field>
          <Field label="Descrição" className="mt-block">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Vencimento" className="mt-block">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Valor" className="mt-block">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            disabled={salvandoTitulo}
            onClick={async () => {
              if (salvandoTitulo) return;
              if (!desc.trim() || !due) {
                return toast.error("Preencha descrição e vencimento.");
              }
              const valor = parseMoneyInput(amount);
              if (!Number.isFinite(valor) || valor <= 0) {
                return toast.error("Informe um valor maior que zero.");
              }
              setSalvandoTitulo(true);
              try {
                const ok = await runAction(
                  () =>
                    saveReceivableFn({
                      data: {
                        description: desc,
                        dueDate: due,
                        amount: valor,
                        storeId,
                        customerId: recCustomer?.id ?? null,
                      },
                    }),
                  { sucesso: "Título criado." },
                );
                if (!ok) return;
                setOpenRec(false);
                void qc.invalidateQueries({ queryKey: ["ar"] });
              } finally {
                setSalvandoTitulo(false);
              }
            }}
          >
            {salvandoTitulo ? "Salvando…" : "Salvar"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
