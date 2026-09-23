import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, KpiCard, PageHeader, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
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
  cashflowFn,
  listExpensesFn,
  listPayablesFn,
  listReceivablesFn,
  saveExpenseFn,
  savePayableFn,
  saveReceivableFn,
  settlePayableFn,
  settleReceivableFn,
} from "@/lib/server/finance";
import { listCustomersFn, listSuppliersFn } from "@/lib/server/party";
import { cn, num } from "@/lib/utils";

export const Route = createFileRoute("/app/financeiro")({ component: FinanceiroPage });

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
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [partyId, setPartyId] = useState("");
  const [category, setCategory] = useState("Compras");

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
  const expenses = useQuery({ queryKey: ["expenses"], queryFn: () => listExpensesFn() });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliersFn({ data: {} }) });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => listCustomersFn({ data: {} }) });

  if (pay.isPending) return <PageSkeleton />;
  if (pay.error) return <QueryError error={pay.error} fallback="Erro ao carregar o financeiro." />;

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
              setPartyId("");
              setCategory("Compras");
              setOpenPay(true);
            }}
          >
            Nova conta
          </Button>
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
            {(pay.data ?? []).map((r: Record<string, unknown>) => {
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
                    {r.status !== "pago" && r.status !== "cancelado" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await settlePayableFn({
                              data: { id: num(r.id), amount: num(r.amount) - num(r.paid_amount) },
                            });
                            toast.success("Baixa registrada.");
                            void qc.invalidateQueries({ queryKey: ["ap"] });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Falha");
                          }
                        }}
                      >
                        Pagar
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
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
              setPartyId("");
              setOpenRec(true);
            }}
          >
            Novo título
          </Button>
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
            {(rec.data ?? []).map((r: Record<string, unknown>) => {
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
                            disabled={!formaRec}
                            onClick={async () => {
                              if (!formaRec) return;
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
                            }}
                          >
                            Confirmar
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
                  </Td>
                </tr>
              );
            })}
          </DataTable>
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
                <Input name="a" type="number" step="0.01" className="pl-9" required />
              </div>
            </Field>
            <Field label="Data da despesa">
              <Input name="dt" type="date" required />
            </Field>
            <Button type="submit" className="mb-0.5 self-end" disabled={lancandoDespesa}>
              {lancandoDespesa ? "Lançando…" : "Lançar"}
            </Button>
          </form>
          <DataTable
            headers={
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th>Categoria</Th>
                <Th className="col-num">Valor</Th>
              </tr>
            }
          >
            {(expenses.data as Record<string, unknown>[] | undefined)?.map((e) => (
              <tr key={String(e.id)} className="border-b border-border last:border-0">
                <Td>{formatDate(String(e.spent_at))}</Td>
                <Td>{String(e.description)}</Td>
                <Td>{String(e.category ?? "—")}</Td>
                <Td className="tabular col-num">{formatBRL(num(e.amount))}</Td>
              </tr>
            ))}
          </DataTable>
        </TabsContent>
      </Tabs>

      <Dialog open={openPay} onOpenChange={setOpenPay}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conta a pagar</DialogTitle>
          </DialogHeader>
          <Field label="Fornecedor">
            <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">—</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.tradeName || s.legalName}
                </option>
              ))}
            </Select>
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
            onClick={async () => {
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
              const ok = await runAction(
                () =>
                  savePayableFn({
                    data: {
                      description: desc,
                      dueDate: due,
                      amount: valor,
                      storeId,
                      supplierId: partyId ? Number(partyId) : null,
                      category,
                    },
                  }),
                { sucesso: "Conta criada." },
              );
              if (!ok) return;
              setOpenPay(false);
              void qc.invalidateQueries({ queryKey: ["ap"] });
            }}
          >
            Salvar
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={openRec} onOpenChange={setOpenRec}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conta a receber</DialogTitle>
          </DialogHeader>
          <Field label="Cliente">
            <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">—</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
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
            onClick={async () => {
              if (!desc.trim() || !due) {
                return toast.error("Preencha descrição e vencimento.");
              }
              const valor = parseMoneyInput(amount);
              if (!Number.isFinite(valor) || valor <= 0) {
                return toast.error("Informe um valor maior que zero.");
              }
              const ok = await runAction(
                () =>
                  saveReceivableFn({
                    data: {
                      description: desc,
                      dueDate: due,
                      amount: valor,
                      storeId,
                      customerId: partyId ? Number(partyId) : null,
                    },
                  }),
                { sucesso: "Título criado." },
              );
              if (!ok) return;
              setOpenRec(false);
              void qc.invalidateQueries({ queryKey: ["ar"] });
            }}
          >
            Salvar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
