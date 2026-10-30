import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, EmptyState, KpiCard, PageHeader, Pager, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { StockCountPanel } from "@/components/stock-count-panel";
import { useDebounced } from "@/hooks/use-debounced";
import { useSelection } from "@/hooks/use-selection";
import { STOCK_TYPE_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { adjustStockFn, listMovementsFn, listStockFn, transferStockFn } from "@/lib/server/catalog";
import { getTenantFn } from "@/lib/server/session";
import { num } from "@/lib/utils";

export const Route = createFileRoute("/app/estoque")({ component: EstoquePage });

const PAGE_SIZE = 100;

function EstoquePage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [movPage, setMovPage] = useState(0);
  const [filter, setFilter] = useState<"all" | "low" | "zero" | "stale">("all");
  const [adj, setAdj] = useState<{ variantId: number; name: string } | null>(null);
  const [type, setType] = useState<"entrada" | "saida" | "ajuste" | "perda">("entrada");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [toStore, setToStore] = useState("");
  const [registrando, setRegistrando] = useState(false);

  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  // keepPreviousData: sem ele cada letra digitada derrubava a pagina inteira
  // para o esqueleto e o campo de busca perdia o foco.
  const termo = useDebounced(q.trim(), 250);
  const stock = useQuery({
    queryKey: ["stock", storeId, termo, filter, page],
    queryFn: () =>
      listStockFn({
        data: {
          storeId: storeId ?? undefined,
          q: termo || undefined,
          filter,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const items = stock.data?.items ?? [];
  const total = stock.data?.total ?? 0;
  const kpis = stock.data?.kpis;
  const paginaVazia = !stock.isPlaceholderData && stock.data != null && items.length === 0 && page > 0;
  useEffect(() => {
    if (paginaVazia) setPage(0);
  }, [paginaVazia]);
  const moves = useQuery({
    queryKey: ["moves", storeId, movPage],
    queryFn: () =>
      listMovementsFn({
        data: { storeId: storeId ?? undefined, limit: PAGE_SIZE, offset: movPage * PAGE_SIZE },
      }),
    placeholderData: keepPreviousData,
  });
  const movItems = moves.data?.items ?? [];
  const movTotal = moves.data?.total ?? 0;
  const movPaginaVazia = !moves.isPlaceholderData && moves.data != null && movItems.length === 0 && movPage > 0;
  useEffect(() => {
    if (movPaginaVazia) setMovPage(0);
  }, [movPaginaVazia]);

  if (stock.isPending) return <PageSkeleton />;
  if (stock.error) return <QueryError error={stock.error} fallback="Erro ao carregar o estoque." />;

  return (
    <div>
      <PageHeader title="Estoque" description="Saldos, movimentações e transferência entre lojas." />
      {kpis ? (
        <div className="mb-5 kpi-grid">
          <KpiCard label="Itens em estoque" value={String(kpis.itemsCount)} />
          <KpiCard label="Valor em estoque" value={formatBRL(kpis.stockValue)} />
          <KpiCard
            label="Abaixo do mínimo"
            value={String(kpis.lowCount)}
            tone={kpis.lowCount ? "warning" : "default"}
          />
          <KpiCard
            label="Zerados"
            value={String(kpis.zeroCount)}
            tone={kpis.zeroCount ? "danger" : "default"}
          />
        </div>
      ) : null}
      <Tabs defaultValue="saldo">
        <TabsList>
          <TabsTrigger value="saldo">Saldos</TabsTrigger>
          <TabsTrigger value="mov">Movimentações</TabsTrigger>
          <TabsTrigger value="inv">Inventário</TabsTrigger>
        </TabsList>
        <TabsContent value="saldo">
          <div className="mb-4 flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="Buscar"
              aria-label="Buscar no estoque"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
            <Select
              className="w-auto min-w-48"
              aria-label="Filtro de estoque"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as typeof filter);
                setPage(0);
              }}
            >
              <option value="all">Todos</option>
              <option value="low">Abaixo do mínimo</option>
              <option value="zero">Zerados</option>
              <option value="stale">Sem giro (45 dias)</option>
            </Select>
          </div>
          {!items.length ? (
            // Filtro ou busca sem resultado nao e "estoque vazio".
            termo || filter !== "all" ? (
              <EmptyState
                title="Nenhum item neste filtro."
                description={
                  termo
                    ? `Nada encontrado para “${termo}” com o filtro escolhido.`
                    : "Nenhum item atende a este filtro agora."
                }
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQ("");
                      setFilter("all");
                      setPage(0);
                    }}
                  >
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <EmptyState title="Nenhum item em estoque." description="Cadastre produtos e dê entrada para ver os saldos." />
            )
          ) : (
            <div className={stock.isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={stock.isPlaceholderData}>
            <DataTable
              headers={
                <tr>
                  <Th>Produto</Th>
                  <Th>Loja</Th>
                  <Th className="col-num">Qtd</Th>
                  <Th className="col-num">Mínimo</Th>
                  <Th className="col-num">Custo</Th>
                  <Th></Th>
                </tr>
              }
            >
              {items.map((r) => (
                <tr key={`${r.variantId}-${r.storeId}`} className="border-b border-border last:border-0">
                  <Td>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[r.color, r.size, r.sku].filter(Boolean).join(" · ")}
                    </p>
                  </Td>
                  <Td>{r.storeName ?? "—"}</Td>
                  <Td className="tabular col-num">
                    {r.quantity <= r.minStock && r.minStock > 0 ? (
                      <Badge variant="warning">{formatQty(r.quantity)}</Badge>
                    ) : (
                      formatQty(r.quantity)
                    )}
                  </Td>
                  <Td className="tabular col-num">{formatQty(r.minStock)}</Td>
                  <Td className="tabular col-num">{formatBRL(r.cost)}</Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => setAdj({ variantId: r.variantId, name: r.name })}>
                      Ajustar
                    </Button>
                  </Td>
                </tr>
              ))}
            </DataTable>
            <Pager page={page} pageSize={PAGE_SIZE} shown={items.length} total={total} onPage={setPage} />
            </div>
          )}
        </TabsContent>
        <TabsContent value="mov">
          {!movItems.length ? (
            <EmptyState title="Nenhuma movimentação ainda." description="Entradas, saídas, ajustes e transferências aparecem aqui." />
          ) : (
            <div className={moves.isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={moves.isPlaceholderData}>
              <DataTable
                headers={
                  <tr>
                    <Th>Quando</Th>
                    <Th>Produto</Th>
                    <Th>Tipo</Th>
                    <Th className="col-num">Qtd</Th>
                    <Th className="col-num">Antes</Th>
                    <Th className="col-num">Depois</Th>
                    <Th>Obs.</Th>
                  </tr>
                }
              >
                {movItems.map((m) => (
                  <tr key={String(m.id)} className="border-b border-border last:border-0">
                    <Td>{formatDateTime(String(m.created_at))}</Td>
                    <Td>
                      {String(m.name)} {[m.color, m.size].filter(Boolean).join(" ")}
                    </Td>
                    <Td>{STOCK_TYPE_LABELS[String(m.type)] ?? String(m.type)}</Td>
                    <Td className="tabular col-num">{formatQty(num(m.quantity))}</Td>
                    <Td className="tabular col-num">{formatQty(num(m.previous_qty))}</Td>
                    <Td className="tabular col-num">{formatQty(num(m.new_qty))}</Td>
                    <Td className="text-muted-foreground">{String(m.note ?? "")}</Td>
                  </tr>
                ))}
              </DataTable>
              <Pager page={movPage} pageSize={PAGE_SIZE} shown={movItems.length} total={movTotal} onPage={setMovPage} />
            </div>
          )}
        </TabsContent>
        <TabsContent value="inv">
          <StockCountPanel storeId={storeId ?? tenant.data?.defaultStoreId ?? null} />
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
            {type === "ajuste" && !toStore ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Pode ser negativo, pra corrigir a contagem pra baixo (ex. -3).
              </p>
            ) : null}
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
            disabled={registrando}
            onClick={async () => {
              if (!adj || !storeId || registrando) return;
              if (!note.trim() && !toStore) return toast.error("Informe o motivo.");
              // Quantidade validada: campo vazio virava Number("") = 0 e
              // registrava uma movimentacao de 0 unidade. E a trava evita que
              // dois cliques movimentem o estoque duas vezes -- numa loja de
              // roupa, estoque a mais que o real vira venda de peca que nao
              // existe.
              //
              // "ajuste" sem transferencia aceita negativo (corrige contagem
              // pra baixo -- ver parseStockDelta/adjustStockFn); os outros
              // tipos e a transferencia continuam exigindo positivo, porque
              // a direcao deles ja vem do tipo escolhido.
              const quantidade = Number(qty);
              const ajusteLivre = type === "ajuste" && !toStore;
              if (!Number.isFinite(quantidade) || (ajusteLivre ? quantidade === 0 : quantidade <= 0)) {
                return toast.error(
                  ajusteLivre ? "Informe um ajuste diferente de zero." : "Informe uma quantidade maior que zero.",
                );
              }
              setRegistrando(true);
              try {
                if (toStore) {
                  await transferStockFn({
                    data: {
                      fromStoreId: storeId,
                      toStoreId: Number(toStore),
                      variantId: adj.variantId,
                      quantity: quantidade,
                      note,
                    },
                  });
                } else {
                  await adjustStockFn({
                    data: {
                      storeId,
                      variantId: adj.variantId,
                      type,
                      quantity: quantidade,
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
              } finally {
                setRegistrando(false);
              }
            }}
          >
            {registrando ? "Registrando…" : "Registrar"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
