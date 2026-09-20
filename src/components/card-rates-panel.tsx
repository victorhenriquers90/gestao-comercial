import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CARD_BRANDS } from "@/lib/constants";
import { DEFAULT_CARD_RATES, MAX_INSTALLMENTS, MAX_SETTLEMENT_DAYS } from "@/lib/card";
import { listCardRatesFn, saveCardRatesFn } from "@/lib/server/commerce";

type Linha = {
  method: string;
  brand: string;
  minInstallments: number;
  maxInstallments: number;
  feePct: string;
  settlementDays: number;
};

const novaLinha = (): Linha => ({
  method: "credito",
  brand: "",
  minInstallments: 1,
  maxInstallments: 1,
  feePct: "",
  settlementDays: DEFAULT_CARD_RATES.credito.settlementDays,
});

/**
 * Taxa da maquininha e prazo de recebimento, por bandeira e faixa de
 * parcelas.
 *
 * Estes numeros nao sao decoracao: e com eles que a venda no cartao vira
 * conta a receber pelo LIQUIDO e na data em que o dinheiro cai. Sem nenhuma
 * linha aqui, o sistema usa prazo padrao (D+1 no debito, D+30 no credito) e
 * taxa ZERO -- o prazo vale pra qualquer loja, mas o percentual e negociado
 * caso a caso e inventar um numero seria criar despesa que ninguem conferiu.
 */
export function CardRatesPanel() {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: ["card-rates"], queryFn: () => listCardRatesFn() });
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!consulta.data) return;
    setLinhas(
      consulta.data.rates.map((r) => ({
        method: r.method,
        brand: r.brand ?? "",
        minInstallments: r.minInstallments,
        maxInstallments: r.maxInstallments,
        feePct: String(r.feePct),
        settlementDays: r.settlementDays,
      })),
    );
  }, [consulta.data]);

  function alterar(idx: number, patch: Partial<Linha>) {
    setLinhas((atual) =>
      atual.map((l, i) => {
        if (i !== idx) return l;
        const proxima = { ...l, ...patch };
        // Debito nao parcela: manter a faixa em 1 a 1 evita o erro chegar no
        // servidor e voltar como mensagem.
        if (proxima.method === "debito") {
          proxima.minInstallments = 1;
          proxima.maxInstallments = 1;
        }
        return proxima;
      }),
    );
  }

  async function salvar() {
    setSalvando(true);
    try {
      const r = await saveCardRatesFn({
        data: {
          rates: linhas.map((l) => ({
            method: l.method,
            brand: l.brand,
            minInstallments: Number(l.minInstallments),
            maxInstallments: Number(l.maxInstallments),
            feePct: Number(String(l.feePct).replace(",", ".")),
            settlementDays: Number(l.settlementDays),
          })),
        },
      });
      await qc.invalidateQueries({ queryKey: ["card-rates"] });
      toast.success(r.total === 0 ? "Taxas removidas — voltou ao padrão." : "Taxas salvas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar as taxas.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="space-y-block p-5">
      <div>
        <p className="text-sm text-muted-foreground">
          O que a adquirente retém e em quantos dias deposita. É com isto que a venda no cartão vira
          conta a receber pelo valor líquido, na data em que o dinheiro realmente cai.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sem nenhuma linha abaixo, valem os padrões: débito em{" "}
          <strong className="text-foreground">D+{DEFAULT_CARD_RATES.debito.settlementDays}</strong> e
          crédito em{" "}
          <strong className="text-foreground">D+{DEFAULT_CARD_RATES.credito.settlementDays}</strong>,
          ambos com <strong className="text-foreground">taxa zero</strong> — o prazo vale para
          qualquer loja, mas a taxa é a que você negociou, então o sistema não inventa uma.
        </p>
      </div>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma taxa cadastrada. Adicione as do seu contrato com a maquininha.
        </p>
      ) : null}

      {linhas.map((l, idx) => (
        <div key={idx} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 lg:grid-cols-6">
          <Field label="Cartão">
            <Select value={l.method} onChange={(e) => alterar(idx, { method: e.target.value })}>
              <option value="credito">Crédito</option>
              <option value="debito">Débito</option>
            </Select>
          </Field>
          <Field label="Bandeira">
            <Select value={l.brand} onChange={(e) => alterar(idx, { brand: e.target.value })}>
              <option value="">Todas</option>
              {CARD_BRANDS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </Field>
          <Field label="Parcelas de">
            <Input
              type="number"
              min={1}
              max={MAX_INSTALLMENTS}
              disabled={l.method === "debito"}
              value={l.minInstallments}
              onChange={(e) => alterar(idx, { minInstallments: Number(e.target.value) })}
            />
          </Field>
          <Field label="até">
            <Input
              type="number"
              min={1}
              max={MAX_INSTALLMENTS}
              disabled={l.method === "debito"}
              value={l.maxInstallments}
              onChange={(e) => alterar(idx, { maxInstallments: Number(e.target.value) })}
            />
          </Field>
          <Field label="Taxa (%)">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={l.feePct}
              onChange={(e) => alterar(idx, { feePct: e.target.value })}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Prazo (dias)" className="flex-1">
              <Input
                type="number"
                min={0}
                max={MAX_SETTLEMENT_DAYS}
                value={l.settlementDays}
                onChange={(e) => alterar(idx, { settlementDays: Number(e.target.value) })}
              />
            </Field>
            <Button
              variant="ghost"
              aria-label="Remover esta taxa"
              onClick={() => setLinhas(linhas.filter((_, i) => i !== idx))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setLinhas([...linhas, novaLinha()])}>
          <Plus className="size-4" />
          Adicionar taxa
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando || consulta.isPending}>
          {salvando ? "Salvando…" : "Salvar taxas"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Quando mais de uma linha serve, vale a mais específica: bandeira escolhida ganha de
        &ldquo;Todas&rdquo;, e faixa de parcelas mais estreita ganha da mais larga.
      </p>
    </Card>
  );
}
