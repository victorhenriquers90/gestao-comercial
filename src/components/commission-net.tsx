import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CommissionSlip, type CommissionSlipData } from "@/components/commission-slip";
import { IssRateField } from "@/components/iss-rate";
import { TaxBreakdown } from "@/components/tax-breakdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { KpiCard } from "@/components/shared";
import { formatBRL } from "@/lib/format";
import {
  isTaxRegime,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  TAX_TABLE_NOTE,
  computeNetCommission,
  issFieldValue,
  MEI_ISS_NOTE,
  resolveTaxProfile,
  type TaxRegime,
} from "@/lib/tax";

export type NetSeller = {
  id: number;
  name: string;
  phone?: string | null;
  document?: string | null;
  tax_regime?: string;
  monthly_salary?: number;
  dependents?: number;
  iss_rate?: number | null;
  month_commission?: number;
  pending_commission?: number;
};

export function CommissionNetTab({
  sellers,
  companyIssRate = 5,
  companyWithholdIss = true,
  company,
}: {
  sellers: NetSeller[];
  companyIssRate?: number;
  companyWithholdIss?: boolean;
  company?: {
    companyName: string;
    companyDocument: string | null;
    companyCity: string | null;
    companyState: string | null;
  };
}) {
  const [sellerId, setSellerId] = useState(sellers[0] ? String(sellers[0].id) : "");
  const seller = sellers.find((s) => String(s.id) === sellerId);
  // "none", nao "autonomo": e o padrao que o resto do sistema usa pra
  // vendedor sem regime configurado (party.ts grava e le "none"). Antes,
  // a selecao INICIAL de um vendedor sem regime simulava como autonomo
  // (retendo INSS/IRRF/ISS) e trocar de vendedor e voltar pro mesmo,
  // via pickSeller, passava a simular como "none" (retencao zero) -- o
  // mesmo vendedor e o mesmo valor bruto dando dois liquidos diferentes
  // so pela ordem de cliques.
  const [regime, setRegime] = useState<string>(seller?.tax_regime || "none");
  const [salary, setSalary] = useState(seller?.monthly_salary ? String(seller.monthly_salary) : "");
  const [dependents, setDependents] = useState(seller?.dependents ? String(seller.dependents) : "0");
  const [issRate, setIssRate] = useState(
    issFieldValue(seller?.tax_regime, seller?.iss_rate, companyIssRate),
  );
  const [gross, setGross] = useState("");
  const [includeMonth, setIncludeMonth] = useState(true);
  const [fromPending, setFromPending] = useState(false);
  const [preview, setPreview] = useState(false);

  function pickSeller(id: string) {
    setSellerId(id);
    const s = sellers.find((x) => String(x.id) === id);
    if (!s) return;
    setRegime(s.tax_regime || "none");
    setSalary(s.monthly_salary ? String(s.monthly_salary) : "");
    setDependents(String(s.dependents ?? 0));
    setIssRate(issFieldValue(s.tax_regime, s.iss_rate, companyIssRate));
    if (s.pending_commission && s.pending_commission > 0.009) {
      setGross((Math.round(s.pending_commission * 100) / 100).toFixed(2));
      setFromPending(true);
    } else {
      setFromPending(false);
    }
  }

  const tax = useMemo(() => {
    const profile = resolveTaxProfile({
      regime,
      monthlySalary: Number(salary) || 0,
      dependents: Number(dependents) || 0,
      sellerIssRate: issRate === "" ? null : Number(issRate),
      companyIssRate,
      companyWithholdIss,
    });
    let monthBefore = 0;
    if (includeMonth && seller) {
      const monthAll = seller.month_commission ?? 0;
      const pending = seller.pending_commission ?? 0;
      monthBefore = fromPending ? Math.max(0, monthAll - pending) : monthAll;
    }
    return computeNetCommission({
      gross: Number(gross) || 0,
      monthCommissionBefore: monthBefore,
      profile,
    });
  }, [regime, salary, dependents, issRate, gross, includeMonth, seller, companyIssRate, companyWithholdIss, fromPending]);

  const showSalary = regime === "clt";
  const showIss = regime === "autonomo" || regime === "pj" || regime === "mei";

  return (
    <div>
      <Card className="mb-4 p-5">
        <div className="flex items-start gap-3">
          <Calculator className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Do bruto ao valor na conta</p>
            <p className="mt-1">
              Informe o regime do vendedor e o valor bruto. A loja retém INSS, IRRF e ISS quando couber — o
              líquido é o que cai na conta. {TAX_TABLE_NOTE}{" "}
              <Link
                to="/app/configuracoes"
                search={{ tab: "impostos" } as never}
                className="text-primary hover:underline"
              >
                Alíquota ISS da loja: {companyIssRate}%
              </Link>
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendedor">
          <Select value={sellerId} onChange={(e) => pickSeller(e.target.value)}>
            <option value="">Avulso</option>
            {sellers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Regime">
          <Select
            value={regime}
            onChange={(e) => {
              const next = e.target.value;
              setRegime(next);
              if (next !== "clt") setSalary("");
              setIssRate(issFieldValue(next, seller?.iss_rate, companyIssRate));
            }}
          >
            {TAX_REGIMES.map((k) => (
              <option key={k} value={k}>
                {TAX_REGIME_LABELS[k as TaxRegime]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Comissão bruta (R$)">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={gross}
            placeholder="0,00"
            onChange={(e) => {
              setGross(e.target.value);
              setFromPending(false);
            }}
          />
        </Field>
        {showSalary ? (
          <Field label="Salário CLT no mês">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={salary}
              placeholder="0,00"
              onChange={(e) => setSalary(e.target.value)}
            />
          </Field>
        ) : showIss ? (
          <IssRateField
            label={regime === "mei" ? "ISS deste MEI (%)" : "Alíquota ISS (%)"}
            value={issRate}
            onChange={setIssRate}
            companyRate={companyIssRate}
            allowEmpty={regime === "mei"}
            emptyLabel={regime === "mei" ? "Sem retenção (DAS)" : undefined}
            placeholder={
              regime === "mei" ? "Vazio = DAS, sem retenção" : `Padrão da loja (${companyIssRate}%)`
            }
            hint={regime === "mei" ? MEI_ISS_NOTE : undefined}
          />
        ) : (
          <Field label="Dependentes (IRRF)">
            <Input
              type="number"
              min="0"
              step="1"
              value={dependents}
              onChange={(e) => setDependents(e.target.value)}
            />
          </Field>
        )}
        {regime === "clt" || regime === "autonomo" ? (
          <Field label="Dependentes">
            <Input
              type="number"
              min="0"
              step="1"
              value={dependents}
              onChange={(e) => setDependents(e.target.value)}
            />
          </Field>
        ) : null}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <NativeCheckbox checked={includeMonth} onChange={(e) => setIncludeMonth(e.target.checked)} />
        Somar comissões já lançadas no mês
      </label>

      {Number(gross) > 0 ? (
        <>
          <div className="mt-5 kpi-grid">
            <KpiCard label="Bruto" value={formatBRL(tax.gross)} />
            <KpiCard
              label="Retenções"
              value={formatBRL(tax.totalTax)}
              tone={tax.totalTax > 0 ? "warning" : "default"}
            />
            <KpiCard label="Líquido na conta" value={formatBRL(tax.net)} tone="success" />
            <KpiCard
              label="Custo da loja"
              value={formatBRL(tax.employerCost)}
              hint={
                tax.employerCost > tax.gross
                  ? `inclui encargos de ${formatBRL(tax.employerCost - tax.gross)}`
                  : undefined
              }
            />
          </div>
          <div className="mt-4">
            <TaxBreakdown tax={tax} />
          </div>
          <div className="mt-3">
            <Button variant="outline" onClick={() => setPreview(true)}>
              Imprimir prévia
            </Button>
          </div>
          <Dialog open={preview} onOpenChange={setPreview}>
            <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Prévia do demonstrativo</DialogTitle>
              </DialogHeader>
              <CommissionSlip
                preview
                data={
                  {
                    paidAt: new Date().toISOString(),
                    sellerName: seller?.name ?? "Avulso",
                    sellerDocument: seller?.document ?? null,
                    sellerPhone: seller?.phone ?? null,
                    regime: isTaxRegime(regime) ? regime : "none",
                    sales: [{ saleNumber: null, rule: "Simulação", gross: tax.gross, net: tax.net }],
                    tax,
                    companyName: company?.companyName ?? "",
                    companyDocument: company?.companyDocument ?? null,
                    companyCity: company?.companyCity ?? null,
                    companyState: company?.companyState ?? null,
                  } satisfies CommissionSlipData
                }
                onClose={() => setPreview(false)}
              />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Digite um valor bruto — ou escolha um vendedor com comissões pendentes — para ver INSS, IRRF, ISS e o
          líquido.
        </p>
      )}
    </div>
  );
}
