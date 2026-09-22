import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared";
import { formatNcm } from "@/lib/ncm";
import { runAction } from "@/lib/run-action";
import { applyNcmFn, listNcmPendingFn } from "@/lib/server/catalog";

/**
 * NCM em lote, por categoria.
 *
 * E assim que a resposta chega do contador: "camiseta e 6109.10.00", nao um
 * codigo por SKU. Preencher peca a peca e o caminho mais curto pra ninguem
 * preencher -- e enquanto nao preenche, nenhuma nota sai.
 *
 * Mas categoria NAO garante mesmo NCM: em "Acessorios" convivem bolsa (4202)
 * e cinto (4203). Por isso da pra abrir a categoria e ver exatamente quais
 * pecas vao receber o codigo, e tirar as que nao sao daquele tipo. Aplicar a
 * uma categoria inteira sem olhar e como preencher por preencher: some a
 * pendencia da tela e fica o imposto errado na nota.
 */
export function NcmBulkPanel() {
  const qc = useQueryClient();
  const [ncmPorCat, setNcmPorCat] = useState<Record<string, string>>({});
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [fora, setFora] = useState<Record<number, boolean>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const dados = useQuery({ queryKey: ["ncm-pending"], queryFn: () => listNcmPendingFn() });

  if (dados.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!dados.data?.categorias.length) {
    return (
      <EmptyState
        title="Todos os produtos têm NCM"
        description="A classificação fiscal está completa — esse bloqueio de emissão está resolvido."
      />
    );
  }

  return (
    <div className="space-y-block">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">{dados.data.pendentes}</strong> de {dados.data.total}{" "}
          produto(s) sem classificação fiscal. O código de cada tipo de peça é o contador quem
          informa — o sistema não sugere nenhum.
        </p>
        <p className="mt-1">
          Um NCM por categoria só vale se as peças forem do mesmo tipo fiscal. Bolsa e cinto, por
          exemplo, não são: abra a categoria e desmarque o que não se encaixa.
        </p>
      </div>

      {dados.data.categorias.map((g) => {
        const selecionados = g.pendentes.filter((p) => !fora[p.id]);
        const texto = ncmPorCat[g.categoria] ?? "";
        const aberta = abertas[g.categoria] === true;
        return (
          <div key={g.categoria} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{g.categoria}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {g.pendentes.length} sem NCM de {g.total} produto(s)
                </p>
              </div>
              <Badge variant={selecionados.length === g.pendentes.length ? "warning" : "muted"}>
                {selecionados.length} selecionado(s)
              </Badge>
            </div>

            <div className="mt-block flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5">
                <span className="ed-label">NCM para estas peças</span>
                <Input
                  className="w-44"
                  inputMode="numeric"
                  placeholder="6109.10.00"
                  value={texto}
                  onChange={(e) => setNcmPorCat({ ...ncmPorCat, [g.categoria]: e.target.value })}
                />
              </label>
              <Button
                disabled={ocupado != null || !texto.trim() || selecionados.length === 0}
                onClick={async () => {
                  setOcupado(g.categoria);
                  const ok = await runAction(
                    () =>
                      applyNcmFn({
                        data: { ncm: texto, productIds: selecionados.map((p) => p.id) },
                      }),
                    { sucesso: `NCM aplicado a ${selecionados.length} produto(s).` },
                  );
                  setOcupado(null);
                  if (!ok) return;
                  setNcmPorCat({ ...ncmPorCat, [g.categoria]: "" });
                  void qc.invalidateQueries({ queryKey: ["ncm-pending"] });
                  void qc.invalidateQueries({ queryKey: ["products"] });
                  void qc.invalidateQueries({ queryKey: ["nfce-readiness"] });
                }}
              >
                {ocupado === g.categoria
                  ? "Aplicando…"
                  : `Aplicar a ${selecionados.length} produto(s)`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAbertas({ ...abertas, [g.categoria]: !aberta })}
              >
                {aberta ? "Esconder as peças" : "Ver as peças"}
              </Button>
            </div>

            {aberta ? (
              <ul className="mt-block space-y-1.5">
                {g.pendentes.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={!fora[p.id]}
                        onChange={(e) => setFora({ ...fora, [p.id]: !e.target.checked })}
                      />
                      <span>{p.name}</span>
                      {p.sku ? (
                        <span className="text-xs text-muted-foreground">{p.sku}</span>
                      ) : null}
                      {/* NCM presente mas invalido: nao conta como preenchido
                          e precisa aparecer, senao o operador acha que o
                          produto esta na lista por engano. */}
                      {p.ncm ? (
                        <span className="text-xs text-destructive">
                          valor inválido: {formatNcm(p.ncm)}
                        </span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
