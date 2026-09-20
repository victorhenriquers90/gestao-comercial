import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/components/shared";
import { ACCOUNT_STATUS_LABELS, CRM_STAGE_LABELS, CRM_STAGES, SALE_STATUS_LABELS } from "@/lib/constants";
import { runAction } from "@/lib/run-action";
import { formatBRL, formatDate, formatDateTime, formatDoc, formatQty } from "@/lib/format";
import {
  addCustomerNoteFn,
  getCustomerFn,
  moveCrmFn,
  saveCrmTaskFn,
  saveCustomerFn,
  toggleCrmTaskFn,
} from "@/lib/server/party";

export function CustomerPanel({
  customerId,
  open,
  onOpenChange,
}: {
  customerId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [task, setTask] = useState("");
  const [due, setDue] = useState("");
  const [edit, setEdit] = useState({ phone: "", email: "", creditLimit: 0, city: "" });
  const detail = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => getCustomerFn({ data: { id: customerId! } }),
    enabled: open && customerId != null,
  });

  const c = detail.data?.customer;
  useEffect(() => {
    if (!c) return;
    setEdit({
      phone: c.phone ?? "",
      email: c.email ?? "",
      creditLimit: c.creditLimit,
      city: c.city ?? "",
    });
  }, [c?.id, c?.phone, c?.email, c?.creditLimit, c?.city]);

  async function refresh() {
    void qc.invalidateQueries({ queryKey: ["customer", customerId] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["crm-tasks"] });
  }

  const openRec = (detail.data?.receivables ?? []).reduce(
    (a, r) => a + Math.max(0, r.amount - r.received),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{c?.name ?? "Cliente"}</DialogTitle>
        </DialogHeader>
        {!detail.data || !c ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {formatDoc(c.document)} · {c.phone ?? "sem telefone"}
              {c.city ? ` · ${c.city}${c.state ? "/" + c.state : ""}` : ""}
            </p>
            <div className="kpi-grid">
              <KpiCard label="Total comprado" value={formatBRL(detail.data.stats.total)} />
              <KpiCard label="Compras" value={String(detail.data.stats.count)} />
              <KpiCard label="Ticket" value={formatBRL(detail.data.stats.avg)} />
              <KpiCard
                label="Em aberto"
                value={formatBRL(openRec)}
                tone={openRec > c.creditLimit && c.creditLimit > 0 ? "danger" : "default"}
                hint={c.creditLimit ? `limite ${formatBRL(c.creditLimit)}` : undefined}
              />
            </div>
            <Field label="Estágio no funil">
              <Select
                value={c.crmStage}
                onChange={async (e) => {
                  try {
                    await moveCrmFn({ data: { customerId: c.id, stage: e.target.value } });
                    await refresh();
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
              </Select>
            </Field>

            <Tabs defaultValue="dados">
              <TabsList className="flex-wrap">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="crm">CRM</TabsTrigger>
                <TabsTrigger value="compras">Compras</TabsTrigger>
                <TabsTrigger value="mix">Mix</TabsTrigger>
                <TabsTrigger value="fin">Financeiro</TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Telefone / WhatsApp">
                    <Input
                      value={edit.phone}
                      onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      value={edit.email}
                      onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      value={edit.city}
                      onChange={(e) => setEdit({ ...edit, city: e.target.value })}
                    />
                  </Field>
                  <Field label="Limite de crédito">
                    <Input
                      type="number"
                      step="0.01"
                      value={edit.creditLimit}
                      onChange={(e) => setEdit({ ...edit, creditLimit: Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await saveCustomerFn({
                        data: {
                          id: c.id,
                          kind: c.kind,
                          name: c.name,
                          tradeName: c.tradeName ?? undefined,
                          document: c.document ?? undefined,
                          email: edit.email || undefined,
                          phone: edit.phone || undefined,
                          whatsapp: edit.phone || undefined,
                          city: edit.city || undefined,
                          state: c.state ?? undefined,
                          address: c.address ?? undefined,
                          creditLimit: edit.creditLimit,
                          notes: c.notes ?? undefined,
                          crmStage: c.crmStage,
                          sellerId: c.sellerId,
                        },
                      });
                      toast.success("Cliente atualizado.");
                      await refresh();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Falha");
                    }
                  }}
                >
                  Salvar dados
                </Button>
              </TabsContent>
              <TabsContent value="crm" className="space-y-4">
                <div>
                  <p className="mb-2 ed-title">Tarefas</p>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Input
                      placeholder="Follow-up"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                    />
                    <Input type="date" className="w-40" value={due} onChange={(e) => setDue(e.target.value)} />
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!task.trim()) return;
                        try {
                          await saveCrmTaskFn({
                            data: {
                              customerId: c.id,
                              title: task.trim(),
                              dueAt: due ? `${due}T12:00:00` : null,
                            },
                          });
                          setTask("");
                          setDue("");
                          toast.success("Tarefa criada.");
                          await refresh();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Falha");
                        }
                      }}
                    >
                      Agendar
                    </Button>
                  </div>
                  <ul className="space-y-2">
                    {detail.data.tasks.length === 0 ? (
                      <li className="text-sm text-muted-foreground">Nenhuma tarefa.</li>
                    ) : (
                      detail.data.tasks.map((t) => (
                        <li key={t.id} className="flex items-start gap-2 text-sm">
                          <NativeCheckbox
                            className="mt-0.5"
                            checked={Boolean(t.doneAt)}
                            onChange={async (e) => {
                              const ok = await runAction(
                                () => toggleCrmTaskFn({ data: { id: t.id, done: e.target.checked } }),
                                { erro: "Não foi possível atualizar a tarefa." },
                              );
                              if (!ok) return;
                              await refresh();
                            }}
                          />
                          <span className={t.doneAt ? "text-muted-foreground line-through" : ""}>
                            {t.title}
                            {t.dueAt ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {formatDate(t.dueAt)}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 ed-title">Anotações</p>
                  <Textarea
                    placeholder="Registrar conversa, visita ou acordo"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!note.trim()) return;
                      const ok = await runAction(
                        () => addCustomerNoteFn({ data: { customerId: c.id, body: note.trim() } }),
                        { sucesso: "Nota salva.", erro: "Não foi possível salvar a nota." },
                      );
                      // O campo so e limpo quando a nota REALMENTE foi salva:
                      // limpar antes perderia o texto que a pessoa escreveu.
                      if (!ok) return;
                      setNote("");
                      await refresh();
                    }}
                  >
                    Salvar nota
                  </Button>
                  <div className="mt-3 space-y-2">
                    {detail.data.notes.map((n) => (
                      <div key={n.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                        <p>{n.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="compras">
                {detail.data.sales.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem compras registradas.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {detail.data.sales.map((s) => (
                      <li key={s.id} className="flex justify-between py-2">
                        <span>
                          nº {s.number} · {formatDateTime(s.soldAt)}
                        </span>
                        <span className="tabular">
                          {formatBRL(s.total)}{" "}
                          <Badge variant={statusBadgeVariant(s.status)}>
                            {SALE_STATUS_LABELS[s.status] ?? s.status}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="mix">
                {detail.data.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ainda sem mix comprado.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {detail.data.products.map((p) => (
                      <li key={p.description} className="flex justify-between py-2">
                        <span>
                          {p.description} · {formatQty(p.qty)}
                        </span>
                        <span className="tabular">{formatBRL(p.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="fin">
                {detail.data.receivables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum título a receber.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {detail.data.receivables.map((r) => (
                      <li key={r.id} className="flex justify-between py-2">
                        <span>
                          {r.description} · {formatDate(r.dueDate)}
                        </span>
                        <span className="tabular">
                          {formatBRL(r.amount - r.received)}{" "}
                          <Badge variant={statusBadgeVariant(r.status)}>
                            {ACCOUNT_STATUS_LABELS[r.status] ?? r.status}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
