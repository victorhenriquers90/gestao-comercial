import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { DataTable, EmptyState, KpiCard, Td, Th } from "@/components/shared";
import { formatBRL, formatQty } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { savePurchaseFn } from "@/lib/server/catalog";
import { suggestPurchaseFn } from "@/lib/server/purchase-suggestion";

/**
 * Sugestao de compra: o alerta "Estoque baixo" virando pedido.
 *
 * Agrupado por FORNECEDOR porque e assim que se compra -- ninguem faz um
 * pedido misturando cinco fornecedores. Cada grupo tem o seu botao: vira um
 * ORCAMENTO, ja com os itens e o custo, pra quem compra revisar antes de
 * virar pedido de verdade.
 */
export function PurchaseSuggestionPanel({ storeId }: { storeId: number | null }) {
  const qc = useQueryClient();
  const [cobertura, setCobertura] = useState("30");
  const [janela, setJanela] = useState("60");
  const [gerando, setGerando] = useState<string | null>(null);

  const dados = useQuery({
    queryKey: ["purchase-suggestion", storeId, cobertura, janela],
    queryFn: () =>
      suggestPurchaseFn({
        data: {
          storeId: storeId!,
          coberturaDias: Number(cobertura) || 30,
          janelaDias: Number(janela) || 60,
        },
      }),
    enabled: storeId != null && Number(cobertura) > 0 && Number(janela) > 0,
  });

  if (storeId == null) {
    return <EmptyState title="Selecione uma loja" description="A sugestão olha o estoque de uma loja." />;
  }

  return (
    <div className="space-y-block">
      <Card className="p-5">
        <p className="ed-title">Como a conta é feita</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Para cada peça, o alvo é o <strong className="text-foreground">maior</strong> entre o estoque
          mínimo cadastrado e o quanto ela vende por dia vezes os dias de cobertura. A sugestão é a
          diferença entre esse alvo e o saldo atual — repor só até o mínimo deixaria a loja no mínimo,
          e o alerta dispararia de novo na semana seguinte.
        </p>
        <div className="mt-block grid max-w-md gap-3 sm:grid-cols-2">
          <Field label="Cobertura desejada (dias)">
            <Input
              type="number"
              min={1}
              max={365}
              value={cobertura}
              onChange={(e) => setCobertura(e.target.value)}
            />
          </Field>
          <Field label="Histórico considerado (dias)">
            <Input
              type="number"
              min={1}
              max={365}
              value={janela}
              onChange={(e) => setJanela(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {dados.isPending ? <p className="text-sm text-muted-foreground">Calculando…</p> : null}
      {dados.error ? (
        <p className="text-sm text-destructive">
          {dados.error instanceof Error ? dados.error.message : "Erro ao calcular a sugestão."}
        </p>
      ) : null}

      {dados.data ? (
        <>
          <div className="kpi-grid">
            <KpiCard label="Peças a repor" value={String(dados.data.totalItens)} />
            <KpiCard label="Valor estimado" value={formatBRL(dados.data.totalValor)} hint="pelo custo" />
            <KpiCard label="Fornecedores" value={String(dados.data.grupos.length)} />
            <KpiCard
              label="Cobertura"
              value={`${dados.data.cobertura} dias`}
              hint={`histórico de ${dados.data.janela} dias`}
            />
          </div>

          {dados.data.grupos.length === 0 ? (
            <EmptyState
              title="Nada a repor"
              description="Com a cobertura pedida, todo o estoque ativo está acima do alvo."
            />
          ) : null}

          {dados.data.grupos.map((g) => (
            <Card key={String(g.supplierId ?? "sem")} className="p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="ed-title">{g.supplierName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {g.itens.length} peça(s) · {formatBRL(g.total)} pelo custo
                  </p>
                </div>
                {g.supplierId == null ? (
                  // Sem fornecedor nao da pra montar pedido: o pedido de
                  // compra e sempre PARA alguem. Dizer isso e melhor do que
                  // oferecer um botao que falharia.
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Defina o fornecedor no cadastro destes produtos para gerar o orçamento.
                  </p>
                ) : (
                  <Button
                    disabled={gerando != null}
                    onClick={async () => {
                      setGerando(String(g.supplierId));
                      const ok = await runAction(
                        () =>
                          savePurchaseFn({
                            data: {
                              storeId,
                              supplierId: g.supplierId,
                              // "orcamento" de proposito, nao "pedido": a
                              // sugestao e um ponto de partida, nao uma
                              // decisao de compra. Quem compra revisa
                              // quantidade e custo antes de virar pedido.
                              status: "orcamento",
                              notes: `Gerado da sugestão de compra (cobertura ${dados.data.cobertura} dias)`,
                              items: g.itens.map((i) => ({
                                variantId: i.variantId,
                                productId: i.productId,
                                description: i.descricao,
                                quantity: i.sugerido,
                                unitCost: i.cost,
                              })),
                            },
                          }),
                        { sucesso: "Orçamento criado — revise antes de virar pedido." },
                      );
                      setGerando(null);
                      if (ok) void qc.invalidateQueries({ queryKey: ["purchases"] });
                    }}
                  >
                    Gerar orçamento
                  </Button>
                )}
              </div>

              <div className="mt-block">
                <DataTable
                  headers={
                    <tr>
                      <Th>Peça</Th>
                      <Th className="col-num">Saldo</Th>
                      <Th className="col-num">Mínimo</Th>
                      <Th className="col-num">Giro/dia</Th>
                      <Th className="col-num">Dura</Th>
                      <Th className="col-num">Comprar</Th>
                      <Th className="col-num">Custo</Th>
                    </tr>
                  }
                >
                  {g.itens.map((i) => (
                    <tr key={i.variantId} className="border-b border-border last:border-0">
                      <Td>
                        <span className="block">{i.descricao}</span>
                        {i.motivo === "abaixo-do-minimo" ? (
                          <Badge variant="danger">Abaixo do mínimo</Badge>
                        ) : (
                          <Badge variant="warning">Cobertura curta</Badge>
                        )}
                      </Td>
                      <Td className="tabular col-num">{formatQty(i.saldo)}</Td>
                      <Td className="tabular col-num text-muted-foreground">{formatQty(i.minimo)}</Td>
                      <Td className="tabular col-num text-muted-foreground">
                        {i.consumoDiario > 0 ? formatQty(i.consumoDiario) : "—"}
                      </Td>
                      <Td className="tabular col-num text-muted-foreground">
                        {i.diasDeCobertura == null ? "—" : `${formatQty(i.diasDeCobertura)}d`}
                      </Td>
                      <Td className="tabular col-num font-medium">{formatQty(i.sugerido)}</Td>
                      <Td className="tabular col-num">{formatBRL(i.total)}</Td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
