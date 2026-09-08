import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, EmptyState, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { useSearchId } from "@/hooks/use-search-id";
import { useSelection } from "@/hooks/use-selection";
import { PURCHASE_STATUS, PURCHASE_STATUS_LABELS } from "@/lib/constants";
import { formatBRL, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { getPurchaseFn, listPurchasesFn, receivePurchaseFn, savePurchaseFn, searchPosFn } from "@/lib/server/catalog";
import { listSuppliersFn } from "@/lib/server/party";

export const Route = createFileRoute("/app/compras")({ component: ComprasPage });

function ComprasPage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const searchId = useSearchId();
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("pedido");
  const [freight, setFreight] = useState("0");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<
    { variantId: number; productId: number; description: string; quantity: number; unitCost: number }[]
  >([]);

  const list = useQuery({
    queryKey: ["purchases", storeId],
    queryFn: () => listPurchasesFn({ data: { storeId: storeId ?? undefined } }),
  });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliersFn({ data: {} }) });
  const detail = useQuery({
    queryKey: ["purchase", detailId],
    queryFn: () => getPurchaseFn({ data: { id: detailId! } }),
    enabled: detailId != null,
  });

  useEffect(() => {
    if (searchId) setDetailId(searchId);
  }, [searchId]);

  if (list.isPending) return <PageSkeleton />;

  async function receive(id: number) {
    try {
      await receivePurchaseFn({ data: { id } });
      toast.success("Pedido recebido. Estoque e contas atualizados.");
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      void qc.invalidateQueries({ queryKey: ["purchase"] });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["ap"] });
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  const p = detail.data?.purchase;

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Pedidos, recebimento e atualização automática de estoque e custo."
        actions={<Button onClick={() => setOpen(true)}>Novo pedido</Button>}
      />
      {!list.data?.length ? (
        <EmptyState title="Nenhum pedido de compra." description="Crie o primeiro pedido para abastecer o estoque." />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Nº</Th>
              <Th>Fornecedor</Th>
              <Th>Status</Th>
              <Th>Total</Th>
              <Th>Previsão</Th>
              <Th></Th>
            </tr>
          }
        >
          {list.data.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              onClick={() => setDetailId(row.id)}
            >
              <Td className="tabular">{row.number}</Td>
              <Td>{row.supplierName ?? "—"}</Td>
              <Td>
                <Badge variant={statusBadgeVariant(row.status)}>
                  {PURCHASE_STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </Td>
              <Td className="tabular">{formatBRL(row.total)}</Td>
              <Td>{formatDate(row.expectedAt)}</Td>
              <Td>
                {row.status !== "recebido" && row.status !== "cancelado" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      void receive(row.id);
                    }}
                  >
                    Receber
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pedido de compra</DialogTitle>
          </DialogHeader>
          <Field label="Fornecedor">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.tradeName || s.legalName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" className="mt-block">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {PURCHASE_STATUS.map((s) => (
                <option key={s} value={s}>
                  {PURCHASE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Frete" className="mt-block">
            <Input value={freight} onChange={(e) => setFreight(e.target.value)} />
          </Field>
          <Field label="Adicionar produto" className="mt-block">
            <Input
              placeholder="Buscar e Enter"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key !== "Enter" || !storeId || !q.trim()) return;
                const hits = await searchPosFn({ data: { q, storeId } });
                if (!hits[0]) return toast.error("Produto não encontrado.");
                const h = hits[0];
                setItems((prev) => [
                  ...prev,
                  {
                    variantId: h.variantId,
                    productId: h.productId,
                    description: h.label,
                    quantity: 1,
                    unitCost: h.cost,
                  },
                ]);
                setQ("");
              }}
            />
          </Field>
          <div className="mt-2 space-y-1 text-sm">
            {items.map((i, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">{i.description}</span>
                <Input
                  className="h-8 w-16"
                  type="number"
                  min={1}
                  value={i.quantity}
                  onChange={(e) => {
                    const quantity = Math.max(1, Number(e.target.value) || 1);
                    setItems((prev) => prev.map((x, j) => (j === idx ? { ...x, quantity } : x)));
                  }}
                />
                <Input
                  className="h-8 w-24"
                  value={i.unitCost}
                  onChange={(e) => {
                    const unitCost = Number(e.target.value) || 0;
                    setItems((prev) => prev.map((x, j) => (j === idx ? { ...x, unitCost } : x)));
                  }}
                />
                <span className="w-20 text-right tabular">{formatBRL(i.unitCost * i.quantity)}</span>
              </div>
            ))}
          </div>
          <Button
            className="mt-4 w-full"
            onClick={async () => {
              if (!storeId) return toast.error("Selecione a loja.");
              if (!items.length) return toast.error("Inclua itens.");
              try {
                await savePurchaseFn({
                  data: {
                    storeId,
                    supplierId: supplierId ? Number(supplierId) : null,
                    status,
                    freight: Number(freight),
                    items,
                  },
                });
                toast.success("Pedido salvo.");
                setOpen(false);
                setItems([]);
                void qc.invalidateQueries({ queryKey: ["purchases"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha");
              }
            }}
          >
            Salvar pedido
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailId != null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{p ? `Pedido nº ${p.number}` : "Pedido"}</DialogTitle>
          </DialogHeader>
          {!p ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="space-y-block text-sm">
              <p className="text-muted-foreground">
                {p.supplierName ?? "Sem fornecedor"} · {p.storeName}
                {p.createdAt ? ` · ${formatDateTime(p.createdAt)}` : ""}
              </p>
              <Badge variant={statusBadgeVariant(p.status)}>
                {PURCHASE_STATUS_LABELS[p.status] ?? p.status}
              </Badge>
              <ul className="divide-y divide-border">
                {(detail.data?.items ?? []).map((i) => (
                  <li key={i.id} className="flex justify-between py-2">
                    <span>
                      {i.description} · {formatQty(i.quantity)}
                    </span>
                    <span className="tabular">{formatBRL(i.total)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 border-t border-border pt-2">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular">{formatBRL(p.subtotal)}</span>
                </div>
                {p.freight ? (
                  <div className="flex justify-between">
                    <span>Frete</span>
                    <span className="tabular">{formatBRL(p.freight)}</span>
                  </div>
                ) : null}
                {p.discount ? (
                  <div className="flex justify-between">
                    <span>Desconto</span>
                    <span className="tabular">−{formatBRL(p.discount)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span className="tabular">{formatBRL(p.total)}</span>
                </div>
              </div>
              {p.status !== "recebido" && p.status !== "cancelado" ? (
                <Button className="w-full" onClick={() => void receive(p.id)}>
                  Receber pedido
                </Button>
              ) : p.receivedAt ? (
                <p className="text-xs text-muted-foreground">Recebido em {formatDateTime(p.receivedAt)}</p>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
