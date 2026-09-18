import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, EmptyState, PageHeader, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { RETURN_KIND_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { createReturnFn, getSaleFn, listReturnsFn, listSalesFn } from "@/lib/server/commerce";
import { num } from "@/lib/utils";

export const Route = createFileRoute("/app/devolucoes")({ component: DevolucoesPage });

type Line = {
  saleItemId: number;
  variantId: number;
  description: string;
  remaining: number;
  unit: number;
  qty: number;
};

function DevolucoesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saleNumber, setSaleNumber] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"parcial" | "total" | "troca">("parcial");
  const [saleId, setSaleId] = useState<number | null>(null);
  const [saleLabel, setSaleLabel] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  /**
   * A trava que existia era `disabled={!saleId}` -- impedia confirmar sem
   * venda escolhida, mas nao o duplo clique. Uma devolucao repetida devolve
   * a peca ao estoque duas vezes E devolve o dinheiro duas vezes.
   */
  const [confirmando, setConfirmando] = useState(false);
  const list = useQuery({ queryKey: ["returns"], queryFn: () => listReturnsFn() });
  const recent = useQuery({
    queryKey: ["sales", "returns-pick"],
    queryFn: () => listSalesFn({ data: { status: "finalizada" } }),
    enabled: open,
  });

  async function loadSaleById(id: number, label?: string) {
    const det = await getSaleFn({ data: { id } });
    const next = (det.items as Record<string, unknown>[])
      .map((i) => {
        const remaining = num(i.remaining_qty ?? i.quantity);
        const qty = num(i.quantity);
        const total = num(i.total);
        return {
          saleItemId: num(i.id),
          variantId: num(i.variant_id),
          description: String(i.description ?? ""),
          remaining,
          unit: qty ? total / qty : num(i.unit_price),
          qty: remaining,
        };
      })
      .filter((l) => l.remaining > 0);
    if (!next.length) throw new Error("Nada restante para devolver nesta venda.");
    setSaleId(id);
    setSaleLabel(label ?? `nº ${String((det.sale as { number?: number }).number ?? id)}`);
    setLines(next);
  }

  async function loadSale() {
    if (!saleNumber.trim()) return toast.error("Informe o número da venda.");
    try {
      const sales = await listSalesFn({ data: { q: saleNumber.trim() } });
      const match =
        sales.find((s) => String((s as { number?: number }).number) === saleNumber.trim()) ?? sales[0];
      if (!match) throw new Error("Venda não encontrada.");
      const s = match as { id: number; number: number; customer_name?: string };
      await loadSaleById(num(s.id), `nº ${s.number} · ${s.customer_name ?? "Consumidor"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  const refund = lines.reduce((a, l) => a + l.unit * l.qty, 0);

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar devoluções." />;

  return (
    <div>
      <PageHeader
        title="Devoluções e trocas"
        description="Parcial ou total, com estoque, título e caixa atualizados."
        actions={<Button onClick={() => setOpen(true)}>Nova devolução</Button>}
      />
      {!list.data?.length ? (
        <EmptyState title="Nenhuma devolução registrada." description="As devoluções do PDV e das vendas aparecem aqui." />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Data</Th>
              <Th>Venda</Th>
              <Th>Tipo</Th>
              <Th>Valor</Th>
              <Th>Motivo</Th>
            </tr>
          }
        >
          {(list.data as Record<string, unknown>[]).map((r) => (
            <tr key={String(r.id)} className="border-b border-border last:border-0">
              <Td>{formatDateTime(String(r.created_at))}</Td>
              <Td>nº {String(r.sale_number)}</Td>
              <Td>
                <Badge>{RETURN_KIND_LABELS[String(r.kind)] ?? String(r.kind)}</Badge>
              </Td>
              <Td className="tabular">{formatBRL(num(r.total))}</Td>
              <Td>{String(r.reason)}</Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setSaleId(null);
            setLines([]);
            setReason("");
            setSaleNumber("");
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Devolver venda</DialogTitle>
          </DialogHeader>
          <Field label="Número da venda">
            <div className="flex gap-2">
              <Input
                id="sale-number"
                value={saleNumber}
                onChange={(e) => setSaleNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadSale();
                }}
              />
              <Button type="button" variant="outline" onClick={() => void loadSale()}>
                Buscar
              </Button>
            </div>
          </Field>
          {saleLabel ? <p className="mt-2 text-sm text-muted-foreground">{saleLabel}</p> : null}
          {!saleId && (recent.data ?? []).length ? (
            <div className="mt-block max-h-40 space-y-1 overflow-y-auto text-sm">
              <p className="text-xs text-muted-foreground">Ou escolha uma venda recente</p>
              {(recent.data as Record<string, unknown>[]).slice(0, 8).map((s) => (
                <button
                  key={String(s.id)}
                  type="button"
                  className="flex w-full justify-between rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() =>
                    void loadSaleById(
                      num(s.id),
                      `nº ${String(s.number)} · ${String(s.customer_name ?? "Consumidor")}`,
                    ).catch((e) => toast.error(e instanceof Error ? e.message : "Falha"))
                  }
                >
                  <span>
                    nº {String(s.number)} · {String(s.customer_name ?? "Consumidor")}
                  </span>
                  <span className="tabular text-muted-foreground">{formatBRL(num(s.total))}</span>
                </button>
              ))}
            </div>
          ) : null}
          {lines.length ? (
            <div className="mt-block space-y-2">
              {lines.map((l) => (
                <div key={l.saleItemId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.description}</span>
                  <span className="text-xs text-muted-foreground">até {formatQty(l.remaining)}</span>
                  <Input
                    className="h-8 w-20"
                    type="number"
                    min={0}
                    max={l.remaining}
                    step="1"
                    value={l.qty}
                    onChange={(e) => {
                      const qty = Math.min(l.remaining, Math.max(0, Number(e.target.value)));
                      setLines((prev) => prev.map((x) => (x.saleItemId === l.saleItemId ? { ...x, qty } : x)));
                    }}
                  />
                </div>
              ))}
              <p className="text-sm font-medium tabular">Estorno {formatBRL(refund)}</p>
            </div>
          ) : null}
          <Field label="Tipo" className="mt-block">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="parcial">Devolução parcial</option>
              <option value="total">Devolução total</option>
              <option value="troca">Troca</option>
            </Select>
          </Field>
          <Field label="Motivo" className="mt-block">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            className="mt-4"
            disabled={!saleId || confirmando}
            onClick={async () => {
              if (!reason.trim()) return toast.error("Informe o motivo.");
              if (!saleId || confirmando) return;
              const items = lines
                .filter((l) => l.qty > 0)
                .map((l) => ({
                  saleItemId: l.saleItemId,
                  variantId: l.variantId,
                  quantity: l.qty,
                  amount: Number((l.unit * l.qty).toFixed(2)),
                }));
              if (!items.length) return toast.error("Informe a quantidade a devolver.");
              setConfirmando(true);
              try {
                await createReturnFn({ data: { saleId, kind, reason, items } });
                toast.success("Devolução registrada. Estoque e financeiro atualizados.");
                setOpen(false);
                setSaleId(null);
                setLines([]);
                void qc.invalidateQueries({ queryKey: ["returns"] });
                void qc.invalidateQueries({ queryKey: ["sales"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha");
              } finally {
                setConfirmando(false);
              }
            }}
          >
            {confirmando ? "Confirmando…" : "Confirmar"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
