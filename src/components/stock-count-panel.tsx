import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { DataTable, EmptyState, KpiCard, Td, Th } from "@/components/shared";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import {
  divergenceValue,
  STOCK_COUNT_STATUS_LABELS,
  summarize,
  type StockCountStatus,
} from "@/lib/stock-count";
import { searchPosFn } from "@/lib/server/catalog";
import {
  applyStockCountFn,
  cancelStockCountFn,
  getStockCountFn,
  listStockCountsFn,
  openStockCountFn,
  removeCountItemFn,
  saveCountItemFn,
} from "@/lib/server/stock-count";
import { num } from "@/lib/utils";

type Hit = Awaited<ReturnType<typeof searchPosFn>>[number];

/**
 * Inventario: contar a prateleira e corrigir o saldo.
 *
 * O fluxo e o do balcao, nao o de um formulario: bipar/buscar a peca,
 * digitar quanto TEM na prateleira, Enter, proxima. A lista mostra o que o
 * sistema esperava, o que foi contado e a diferenca -- e so no fim, com o
 * resumo na frente, e que se aplica.
 */
export function StockCountPanel({ storeId }: { storeId: number | null }) {
  const qc = useQueryClient();
  const [abertoId, setAbertoId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [alvo, setAlvo] = useState<Hit | null>(null);
  const [qtd, setQtd] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);

  const lista = useQuery({
    queryKey: ["stock-counts", storeId],
    queryFn: () => listStockCountsFn({ data: { storeId: storeId ?? undefined } }),
  });
  // Sem inventario escolhido na mao, cai no que estiver aberto nesta loja --
  // e o caso comum: a pessoa volta pra tela pra continuar contando.
  const emAberto = num((lista.data ?? []).find((c) => c.status === "aberto")?.id);
  const contagemId = abertoId ?? (emAberto > 0 ? emAberto : null);
  const detalhe = useQuery({
    queryKey: ["stock-count", contagemId],
    queryFn: () => getStockCountFn({ data: { id: contagemId! } }),
    enabled: contagemId != null,
  });

  const itens = (detalhe.data?.items ?? []).map((i) => ({
    variantId: num(i.variant_id),
    expected: num(i.expected),
    counted: num(i.counted),
    cost: num(i.cost),
    nome: [i.name, i.color, i.size].filter(Boolean).join(" · "),
    sku: i.sku == null ? "" : String(i.sku),
    quando: String(i.counted_at ?? ""),
  }));
  const resumo = summarize(itens);
  const valor = divergenceValue(itens);
  const status = String(detalhe.data?.count?.status ?? "") as StockCountStatus;
  const emContagem = status === "aberto";

  async function buscar(texto: string) {
    setQ(texto);
    if (!texto.trim() || !storeId) return setHits([]);
    const rows = await searchPosFn({ data: { q: texto.trim(), storeId } });
    setHits(rows);
    // Codigo de barras bipado casa exatamente um item: ja seleciona e pula
    // pro campo de quantidade, que e o unico lugar onde a pessoa digita.
    if (rows.length === 1 && /^\d{8,}$/.test(texto.trim())) {
      escolher(rows[0]!);
    }
  }

  function escolher(h: Hit) {
    setAlvo(h);
    setHits([]);
    setQ("");
    setQtd("");
    setTimeout(() => qtdRef.current?.focus(), 0);
  }

  async function contar() {
    if (!alvo || contagemId == null) return;
    const n = Number(String(qtd).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    setOcupado(true);
    const ok = await runAction(
      () => saveCountItemFn({ data: { countId: contagemId, variantId: alvo.variantId, counted: n } }),
      { erro: "Não foi possível registrar a contagem." },
    );
    setOcupado(false);
    if (!ok) return;
    setAlvo(null);
    setQtd("");
    void qc.invalidateQueries({ queryKey: ["stock-count", contagemId] });
    buscaRef.current?.focus();
  }

  if (!storeId) {
    return <EmptyState title="Selecione uma loja" description="O inventário é sempre de uma loja." />;
  }

  return (
    <div className="space-y-block">
      {contagemId == null || !emContagem ? (
        <Card className="p-5">
          <p className="ed-title">Novo inventário</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Conte o que existe na prateleira. O sistema guarda o saldo esperado no momento de cada
            contagem e, ao aplicar, lança apenas a <strong className="text-foreground">diferença</strong> —
            por isso a loja pode continuar vendendo enquanto você conta.
          </p>
          <Button
            className="mt-block"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              const ok = await runAction(() => openStockCountFn({ data: { storeId } }), {
                sucesso: "Inventário aberto.",
              });
              setOcupado(false);
              if (!ok) return;
              await qc.invalidateQueries({ queryKey: ["stock-counts"] });
              const nova = await listStockCountsFn({ data: { storeId } });
              setAbertoId(num(nova.find((c) => c.status === "aberto")?.id) || null);
            }}
          >
            Abrir inventário
          </Button>
        </Card>
      ) : null}

      {contagemId != null && emContagem ? (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="ed-title">Inventário #{contagemId} — em contagem</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Bipe o código de barras ou busque pelo nome; digite quanto existe na prateleira.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={ocupado}
                  onClick={async () => {
                    setOcupado(true);
                    const ok = await runAction(
                      () => cancelStockCountFn({ data: { id: contagemId } }),
                      { sucesso: "Inventário cancelado." },
                    );
                    setOcupado(false);
                    if (!ok) return;
                    setAbertoId(null);
                    void qc.invalidateQueries({ queryKey: ["stock-counts"] });
                    void qc.invalidateQueries({ queryKey: ["stock-count", contagemId] });
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  disabled={ocupado || resumo.items === 0}
                  onClick={async () => {
                    setOcupado(true);
                    const ok = await runAction(
                      () => applyStockCountFn({ data: { id: contagemId } }),
                      { sucesso: "Inventário aplicado — o estoque foi corrigido." },
                    );
                    setOcupado(false);
                    if (!ok) return;
                    setAbertoId(null);
                    void qc.invalidateQueries({ queryKey: ["stock-counts"] });
                    void qc.invalidateQueries({ queryKey: ["stock-count", contagemId] });
                    void qc.invalidateQueries({ queryKey: ["stock"] });
                    void qc.invalidateQueries({ queryKey: ["moves"] });
                  }}
                >
                  Aplicar no estoque
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Peça">
                <Input
                  ref={buscaRef}
                  placeholder="Código de barras, SKU ou nome"
                  value={alvo ? [alvo.name, alvo.color, alvo.size].filter(Boolean).join(" · ") : q}
                  onChange={(e) => {
                    if (alvo) setAlvo(null);
                    void buscar(e.target.value);
                  }}
                />
              </Field>
              <Field label="Quantidade na prateleira">
                <div className="flex gap-2">
                  <Input
                    ref={qtdRef}
                    inputMode="decimal"
                    placeholder="0"
                    value={qtd}
                    disabled={!alvo}
                    onChange={(e) => setQtd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void contar();
                    }}
                  />
                  <Button disabled={!alvo || qtd === "" || ocupado} onClick={() => void contar()}>
                    Contar
                  </Button>
                </div>
              </Field>
            </div>

            {hits.length > 0 ? (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
                {hits.map((h) => (
                  <button
                    key={h.variantId}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => escolher(h)}
                  >
                    <span className="truncate">{[h.name, h.color, h.size].filter(Boolean).join(" · ")}</span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      sistema: {formatQty(h.stock)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          <div className="kpi-grid">
            <KpiCard label="Peças contadas" value={String(resumo.items)} />
            <KpiCard
              label="Divergências"
              value={String(resumo.divergentes)}
              tone={resumo.divergentes ? "warning" : "default"}
            />
            <KpiCard
              label="Faltando"
              value={formatQty(resumo.faltas)}
              tone={resumo.faltas ? "danger" : "default"}
              hint={resumo.sobras ? `${formatQty(resumo.sobras)} sobrando` : undefined}
            />
            <KpiCard
              label="Valor da divergência"
              value={formatBRL(valor)}
              tone={valor < 0 ? "danger" : "default"}
              hint="pelo custo"
            />
          </div>
        </>
      ) : null}

      {contagemId != null && itens.length > 0 ? (
        <DataTable
          headers={
            <tr>
              <Th>Peça</Th>
              <Th>SKU</Th>
              <Th className="col-num">Sistema</Th>
              <Th className="col-num">Contado</Th>
              <Th className="col-num">Diferença</Th>
              <Th>Contado em</Th>
              <Th></Th>
            </tr>
          }
        >
          {itens.map((i) => {
            const diff = Number((i.counted - i.expected).toFixed(3));
            return (
              <tr key={i.variantId} className="border-b border-border last:border-0">
                <Td>{i.nome}</Td>
                <Td className="text-muted-foreground">{i.sku || "—"}</Td>
                <Td className="tabular col-num">{formatQty(i.expected)}</Td>
                <Td className="tabular col-num">{formatQty(i.counted)}</Td>
                <Td className="tabular col-num">
                  {diff === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Badge variant={diff < 0 ? "danger" : "warning"}>
                      {diff > 0 ? "+" : ""}
                      {formatQty(diff)}
                    </Badge>
                  )}
                </Td>
                <Td className="text-muted-foreground">{formatDateTime(i.quando)}</Td>
                <Td>
                  {emContagem ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={async () => {
                        // Mesma trava `ocupado` do resto da tela: sem ela, dava
                        // pra remover um item bem no instante em que "Aplicar
                        // no estoque" esta lendo a lista da contagem, ou
                        // disparar dois removes do mesmo item com duplo clique.
                        if (ocupado) return;
                        setOcupado(true);
                        const ok = await runAction(
                          () =>
                            removeCountItemFn({
                              data: { countId: contagemId, variantId: i.variantId },
                            }),
                          { erro: "Não foi possível remover." },
                        );
                        setOcupado(false);
                        if (ok) void qc.invalidateQueries({ queryKey: ["stock-count", contagemId] });
                      }}
                    >
                      Remover
                    </Button>
                  ) : null}
                </Td>
              </tr>
            );
          })}
        </DataTable>
      ) : null}

      <Card className="p-5">
        <p className="ed-title mb-block">Inventários anteriores</p>
        {(lista.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum inventário ainda.</p>
        ) : (
          <div className="space-y-2">
            {(lista.data ?? []).map((c) => (
              <button
                key={String(c.id)}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => setAbertoId(num(c.id))}
              >
                <span className="min-w-0">
                  <span className="font-medium">#{String(c.id)}</span>{" "}
                  <span className="text-muted-foreground">{String(c.store_name)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(String(c.created_at))} · {num(c.items)} peça(s) ·{" "}
                    {num(c.divergentes)} divergência(s)
                  </span>
                </span>
                <Badge
                  variant={
                    c.status === "aplicado" ? "success" : c.status === "aberto" ? "warning" : "muted"
                  }
                >
                  {STOCK_COUNT_STATUS_LABELS[String(c.status) as StockCountStatus] ?? String(c.status)}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
