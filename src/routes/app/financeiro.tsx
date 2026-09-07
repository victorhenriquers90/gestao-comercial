import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, KpiCard, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { useSelection } from "@/hooks/use-selection";
import { ACCOUNT_STATUS_LABELS, CASH_ACCOUNT_LABELS, EXPENSE_CATEGORIES, PAYMENT_LABELS } from "@/lib/constants";
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
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const range = resolvePeriod("month");
  const [openPay, setOpenPay] = useState(false);
  const [openRec, setOpenRec] = useState(false);
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

      <Tabs defaultValue="pagar">
        <TabsList>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="receber">Contas a receber</TabsTrigger>
          <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
          <TabsTrigger value="desp">Despesas</TabsTrigger>
        </TabsList>
        <TabsContent value="pagar">
          <Button
            className="mb-3"
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
                <Th>Valor</Th>
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
                  <Td className="tabular">{formatBRL(num(r.amount) - num(r.paid_amount))}</Td>
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
        <TabsContent value="receber">
          <Button
            className="mb-3"
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
                <Th>Valor</Th>
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
                  <Td className="tabular">{formatBRL(num(r.amount) - num(r.received_amount))}</Td>
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
                            await settleReceivableFn({
                              data: { id: num(r.id), amount: num(r.amount) - num(r.received_amount) },
                            });
                            toast.success("Recebimento registrado.");
                            void qc.invalidateQueries({ queryKey: ["ar"] });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Falha");
                          }
                        }}
                      >
                        Receber
                      </Button>
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
              const fd = new FormData(e.currentTarget);
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
              e.currentTarget.reset();
            }}
          >
            <Input name="d" placeholder="Descrição" required />
            <Select name="c">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Input name="a" type="number" step="0.01" placeholder="Valor" required />
            <Input name="dt" type="date" required />
            <Button type="submit">Lançar</Button>
          </form>
          <DataTable
            headers={
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th>Categoria</Th>
                <Th>Valor</Th>
              </tr>
            }
          >
            {(expenses.data as Record<string, unknown>[] | undefined)?.map((e) => (
              <tr key={String(e.id)} className="border-b border-border last:border-0">
                <Td>{formatDate(String(e.spent_at))}</Td>
                <Td>{String(e.description)}</Td>
                <Td>{String(e.category ?? "—")}</Td>
                <Td className="tabular">{formatBRL(num(e.amount))}</Td>
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
          <Field label="Descrição" className="mt-3">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Categoria" className="mt-3">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="Compras">Compras</option>
            </Select>
          </Field>
          <Field label="Vencimento" className="mt-3">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Valor" className="mt-3">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            onClick={async () => {
              if (!desc.trim() || !due || !Number(amount)) {
                return toast.error("Preencha descrição, vencimento e valor.");
              }
              await savePayableFn({
                data: {
                  description: desc,
                  dueDate: due,
                  amount: Number(amount),
                  storeId,
                  supplierId: partyId ? Number(partyId) : null,
                  category,
                },
              });
              toast.success("Conta criada.");
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
          <Field label="Descrição" className="mt-3">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Vencimento" className="mt-3">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Valor" className="mt-3">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            onClick={async () => {
              if (!desc.trim() || !due || !Number(amount)) {
                return toast.error("Preencha descrição, vencimento e valor.");
              }
              await saveReceivableFn({
                data: {
                  description: desc,
                  dueDate: due,
                  amount: Number(amount),
                  storeId,
                  customerId: partyId ? Number(partyId) : null,
                },
              });
              toast.success("Título criado.");
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
