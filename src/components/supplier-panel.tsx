import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/components/shared";
import { ACCOUNT_STATUS_LABELS, PURCHASE_STATUS_LABELS } from "@/lib/constants";
import { maskCnpj } from "@/lib/document";
import { formatBRL, formatDate, formatDateTime, formatDoc } from "@/lib/format";
import { getSupplierFn, saveSupplierFn } from "@/lib/server/party";

export function SupplierPanel({
  supplierId,
  open,
  onOpenChange,
}: {
  supplierId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState({
    legalName: "",
    tradeName: "",
    document: "",
    phone: "",
    email: "",
    representative: "",
    city: "",
    state: "",
    address: "",
    notes: "",
  });
  const detail = useQuery({
    queryKey: ["supplier", supplierId],
    queryFn: () => getSupplierFn({ data: { id: supplierId! } }),
    enabled: open && supplierId != null,
  });

  const s = detail.data?.supplier;
  useEffect(() => {
    if (!s) return;
    setEdit({
      legalName: s.legalName,
      tradeName: s.tradeName ?? "",
      document: maskCnpj(s.document ?? ""),
      phone: s.phone ?? "",
      email: s.email ?? "",
      representative: s.representative ?? "",
      city: s.city ?? "",
      state: s.state ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
    });
  }, [
    s?.id,
    s?.legalName,
    s?.tradeName,
    s?.document,
    s?.phone,
    s?.email,
    s?.representative,
    s?.city,
    s?.state,
    s?.address,
    s?.notes,
  ]);

  async function refresh() {
    void qc.invalidateQueries({ queryKey: ["supplier", supplierId] });
    void qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  const openPay = (detail.data?.payables ?? []).reduce(
    (a, r) => a + Math.max(0, r.amount - r.paid),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{s?.tradeName || s?.legalName || "Fornecedor"}</DialogTitle>
        </DialogHeader>
        {!detail.data || !s ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {s.legalName}
              {s.document ? ` · ${formatDoc(s.document)}` : ""}
              {s.phone ? ` · ${s.phone}` : ""}
              {s.city ? ` · ${s.city}${s.state ? "/" + s.state : ""}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <KpiCard label="Comprado" value={formatBRL(detail.data.stats.total)} />
              <KpiCard label="Pedidos" value={String(detail.data.stats.count)} />
              <KpiCard
                label="A pagar"
                value={formatBRL(openPay)}
                tone={openPay > 0 ? "warning" : "default"}
              />
            </div>

            <Tabs defaultValue="dados">
              <TabsList className="flex-wrap">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="compras">Pedidos</TabsTrigger>
                <TabsTrigger value="mix">Mix</TabsTrigger>
                <TabsTrigger value="fin">Financeiro</TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Razão social">
                    <Input
                      value={edit.legalName}
                      onChange={(e) => setEdit({ ...edit, legalName: e.target.value })}
                    />
                  </Field>
                  <Field label="Nome fantasia">
                    <Input
                      value={edit.tradeName}
                      onChange={(e) => setEdit({ ...edit, tradeName: e.target.value })}
                    />
                  </Field>
                  <Field label="CNPJ">
                    <Input
                      value={edit.document}
                      inputMode="numeric"
                      placeholder="00.000.000/0000-00"
                      onChange={(e) => setEdit({ ...edit, document: maskCnpj(e.target.value) })}
                    />
                  </Field>
                  <Field label="Telefone">
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
                  <Field label="Representante">
                    <Input
                      value={edit.representative}
                      onChange={(e) => setEdit({ ...edit, representative: e.target.value })}
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      value={edit.city}
                      onChange={(e) => setEdit({ ...edit, city: e.target.value })}
                    />
                  </Field>
                  <Field label="UF">
                    <Input
                      value={edit.state}
                      maxLength={2}
                      onChange={(e) => setEdit({ ...edit, state: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Endereço">
                    <Input
                      value={edit.address}
                      onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                    />
                  </Field>
                </div>
                <Textarea
                  placeholder="Observações"
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await saveSupplierFn({
                        data: {
                          id: s.id,
                          legalName: edit.legalName,
                          tradeName: edit.tradeName || undefined,
                          document: edit.document || undefined,
                          email: edit.email || undefined,
                          phone: edit.phone || undefined,
                          whatsapp: s.whatsapp ?? undefined,
                          address: edit.address || undefined,
                          city: edit.city || undefined,
                          state: edit.state || undefined,
                          zip: s.zip ?? undefined,
                          representative: edit.representative || undefined,
                          notes: edit.notes || undefined,
                        },
                      });
                      toast.success("Fornecedor atualizado.");
                      await refresh();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Falha");
                    }
                  }}
                >
                  Salvar dados
                </Button>
              </TabsContent>
              <TabsContent value="compras">
                {detail.data.purchases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum pedido registrado.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {detail.data.purchases.map((p) => (
                      <li key={p.id} className="flex justify-between py-2">
                        <span>
                          nº {p.number} · {formatDateTime(p.createdAt)}
                        </span>
                        <span className="tabular">
                          {formatBRL(p.total)}{" "}
                          <Badge variant={statusBadgeVariant(p.status)}>
                            {PURCHASE_STATUS_LABELS[p.status] ?? p.status}
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
                      <li key={p.name} className="flex justify-between py-2">
                        <span>
                          {p.name} · {p.times}×
                        </span>
                        <span className="tabular">{formatBRL(p.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="fin">
                {detail.data.payables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum título a pagar.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {detail.data.payables.map((r) => (
                      <li key={r.id} className="flex justify-between py-2">
                        <span>
                          {r.description} · {formatDate(r.dueDate)}
                        </span>
                        <span className="tabular">
                          {formatBRL(r.amount - r.paid)}{" "}
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
