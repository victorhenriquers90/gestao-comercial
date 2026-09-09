import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, EmptyState, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { useSelection } from "@/hooks/use-selection";
import { STOCK_TYPE_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { adjustStockFn, listMovementsFn, listStockFn, transferStockFn } from "@/lib/server/catalog";
import { getTenantFn } from "@/lib/server/session";
import { num } from "@/lib/utils";

export const Route = createFileRoute("/app/estoque")({ component: EstoquePage });

function EstoquePage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "zero" | "stale">("all");
  const [adj, setAdj] = useState<{ variantId: number; name: string } | null>(null);
  const [type, setType] = useState<"entrada" | "saida" | "ajuste" | "perda">("entrada");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [toStore, setToStore] = useState("");

  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const stock = useQuery({
    queryKey: ["stock", storeId, q, filter],
    queryFn: () =>
      listStockFn({ data: { storeId: storeId ?? undefined, q: q || undefined, filter } }),
  });
  const moves = useQuery({
    queryKey: ["moves", storeId],
    queryFn: () => listMovementsFn({ data: { storeId: storeId ?? undefined } }),
  });

  if (stock.isPending) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Estoque" description="Saldos, movimentações e transferência entre lojas." />
      <Tabs defaultValue="saldo">
        <TabsList>
          <TabsTrigger value="saldo">Saldos</TabsTrigger>
          <TabsTrigger value="mov">Movimentações</TabsTrigger>
        </TabsList>
        <TabsContent value="saldo">
          <div className="mb-4 flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">Todos</option>
              <option value="low">Abaixo do mínimo</option>
              <option value="zero">Zerados</option>
              <option value="stale">Sem giro (45 dias)</option>
            </Select>
          </div>
          {!stock.data?.length ? (
            <EmptyState title="Nenhum item em estoque." description="Cadastre produtos e dê entrada para ver os saldos." />
          ) : (
            <DataTable
              headers={
                <tr>
                  <Th>Produto</Th>
                  <Th>Loja</Th>
                  <Th>Qtd</Th>
                  <Th>Mínimo</Th>
                  <Th>Custo</Th>
                  <Th></Th>
                </tr>
              }
            >
              {stock.data.map((r) => (
                <tr key={`${r.variantId}-${r.storeId}`} className="border-b border-border last:border-0">
                  <Td>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[r.color, r.size, r.sku].filter(Boolean).join(" · ")}
                    </p>
                  </Td>
                  <Td>{r.storeName ?? "—"}</Td>
                  <Td className="tabular">
                    {r.quantity <= r.minStock && r.minStock > 0 ? (
                      <Badge variant="warning">{formatQty(r.quantity)}</Badge>
                    ) : (
                      formatQty(r.quantity)
                    )}
                  </Td>
                  <Td className="tabular">{formatQty(r.minStock)}</Td>
                  <Td className="tabular">{formatBRL(r.cost)}</Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => setAdj({ variantId: r.variantId, name: r.name })}>
                      Ajustar
                    </Button>
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </TabsContent>
        <TabsContent value="mov">
          <DataTable
            headers={
              <tr>
                <Th>Quando</Th>
                <Th>Produto</Th>
                <Th>Tipo</Th>
                <Th>Qtd</Th>
                <Th>Antes</Th>
                <Th>Depois</Th>
                <Th>Obs.</Th>
              </tr>
            }
          >
            {(moves.data as Record<string, unknown>[] | undefined)?.map((m) => (
              <tr key={String(m.id)} className="border-b border-border last:border-0">
                <Td>{formatDateTime(String(m.created_at))}</Td>
                <Td>
                  {String(m.name)} {[m.color, m.size].filter(Boolean).join(" ")}
                </Td>
                <Td>{STOCK_TYPE_LABELS[String(m.type)] ?? String(m.type)}</Td>
                <Td className="tabular">{formatQty(num(m.quantity))}</Td>
                <Td className="tabular">{formatQty(num(m.previous_qty))}</Td>
                <Td className="tabular">{formatQty(num(m.new_qty))}</Td>
                <Td className="text-muted-foreground">{String(m.note ?? "")}</Td>
              </tr>
            ))}
          </DataTable>
        </TabsContent>
      </Tabs>

      <Dialog open={!!adj} onOpenChange={() => setAdj(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movimentar {adj?.name}</DialogTitle>
          </DialogHeader>
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
              <option value="ajuste">Ajuste (define delta)</option>
              <option value="perda">Perda</option>
            </Select>
          </Field>
          <Field label="Quantidade" className="mt-block">
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Motivo" className="mt-block">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Transferir para loja" className="mt-block">
            <Select value={toStore} onChange={(e) => setToStore(e.target.value)}>
              <option value="">Não transferir</option>
              {(tenant.data?.stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            className="mt-4 w-full"
            onClick={async () => {
              if (!adj || !storeId) return;
              if (!note.trim() && !toStore) return toast.error("Informe o motivo.");
              try {
                if (toStore) {
                  await transferStockFn({
                    data: {
                      fromStoreId: storeId,
                      toStoreId: Number(toStore),
                      variantId: adj.variantId,
                      quantity: Number(qty),
                      note,
                    },
                  });
                } else {
                  await adjustStockFn({
                    data: {
                      storeId,
                      variantId: adj.variantId,
                      type,
                      quantity: Number(qty),
                      note,
                    },
                  });
                }
                toast.success("Estoque atualizado.");
                setAdj(null);
                void qc.invalidateQueries({ queryKey: ["stock"] });
                void qc.invalidateQueries({ queryKey: ["moves"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha");
              }
            }}
          >
            Registrar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
