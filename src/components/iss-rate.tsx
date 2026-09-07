import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { NativeCheckbox } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format";
import {
  clampIss,
  computeNetCommission,
  ISS_DEFAULT,
  ISS_MAX,
  ISS_NOTE,
  ISS_PRESETS,
  issSellerHint,
  MEI_ISS_NOTE,
  resolveTaxProfile,
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/tax";
import { cn } from "@/lib/utils";
import { listSellersFn, saveSellerFn } from "@/lib/server/party";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function IssPresetButtons({
  value,
  onChange,
  allowEmpty,
  companyRate,
  emptyLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  companyRate?: number;
  emptyLabel?: string;
}) {
  const n = value === "" ? null : Number(value);
  const emptyText =
    emptyLabel ?? (companyRate != null ? `Padrão da loja (${companyRate}%)` : "Padrão da loja");
  return (
    <div className="flex flex-wrap gap-1">
      {ISS_PRESETS.map((p) => {
        const active = n != null && Number.isFinite(n) && Math.abs(n - p) < 0.001;
        return (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            onClick={() => onChange(String(p))}
          >
            {p}%
          </Button>
        );
      })}
      {allowEmpty ? (
        <Button
          type="button"
          size="sm"
          variant={value === "" ? "default" : "outline"}
          aria-pressed={value === ""}
          onClick={() => onChange("")}
        >
          {emptyText}
        </Button>
      ) : null}
    </div>
  );
}

export function IssRateField({
  value,
  onChange,
  placeholder,
  allowEmpty,
  label,
  companyRate,
  emptyLabel,
  hint,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  label?: string;
  companyRate?: number;
  emptyLabel?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label ?? "Alíquota ISS (%)"} className={className}>
      <IssPresetButtons
        value={value}
        onChange={onChange}
        allowEmpty={allowEmpty}
        companyRate={companyRate}
        emptyLabel={emptyLabel}
      />
      <Input
        className="mt-2"
        type="number"
        min={0}
        max={ISS_MAX}
        step="0.01"
        inputMode="decimal"
        placeholder={placeholder ?? `0 a ${ISS_MAX}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (value === "" && allowEmpty) return;
          onChange(String(clampIss(value)));
        }}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Field>
  );
}

type SellerRow = Awaited<ReturnType<typeof listSellersFn>>[number];

function SellerIssRow({
  seller,
  companyIss,
  withhold,
}: {
  seller: SellerRow;
  companyIss: number;
  withhold: boolean;
}) {
  const qc = useQueryClient();
  const [rate, setRate] = useState(seller.iss_rate != null ? String(seller.iss_rate) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRate(seller.iss_rate != null ? String(seller.iss_rate) : "");
  }, [seller.iss_rate]);

  const isMei = seller.tax_regime === "mei";
  const effective = rate === "" ? companyIss : clampIss(rate);
  const preview = useMemo(() => {
    return computeNetCommission({
      gross: 1000,
      profile: resolveTaxProfile({
        regime: seller.tax_regime,
        monthlySalary: seller.monthly_salary,
        dependents: seller.dependents,
        sellerIssRate: rate === "" ? null : clampIss(rate),
        companyIssRate: companyIss,
        companyWithholdIss: withhold,
      }),
    });
  }, [rate, seller.tax_regime, seller.monthly_salary, seller.dependents, companyIss, withhold]);

  async function persist(next: string) {
    setBusy(true);
    try {
      await saveSellerFn({
        data: {
          id: seller.id,
          name: seller.name,
          email: seller.email ?? undefined,
          phone: seller.phone ?? undefined,
          document: seller.document ?? undefined,
          commissionPct: seller.commission_pct,
          storeId: seller.store_id,
          isActive: seller.is_active,
          taxRegime: seller.tax_regime,
          monthlySalary: seller.monthly_salary,
          dependents: seller.dependents,
          issRate: next === "" ? null : clampIss(next),
        },
      });
      toast.success(
        next === ""
          ? isMei
            ? `${seller.name}: DAS, sem ISS na fonte.`
            : `${seller.name}: usando o padrão da loja.`
          : `${seller.name}: ISS ${clampIss(next)}%.`,
      );
      void qc.invalidateQueries({ queryKey: ["sellers"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o ISS.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{seller.name}</p>
        <p className="text-xs text-muted-foreground">
          {TAX_REGIME_LABELS[(seller.tax_regime as TaxRegime) || "none"] ?? seller.tax_regime}
          {" · "}
          {issSellerHint(seller.tax_regime, rate === "" ? null : clampIss(rate), companyIss)}
          {preview.iss > 0 ? ` · em R$ 1.000: ${formatBRL(preview.iss)}` : " · em R$ 1.000: sem retenção"}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        <IssPresetButtons
          value={rate}
          onChange={setRate}
          allowEmpty
          companyRate={companyIss}
          emptyLabel={isMei ? "Sem retenção (DAS)" : undefined}
        />
        <Input
          className="w-20"
          type="number"
          min={0}
          max={ISS_MAX}
          step="0.01"
          inputMode="decimal"
          placeholder={isMei && rate === "" ? "DAS" : `${effective}`}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => {
            if (rate === "") return;
            setRate(String(clampIss(rate)));
          }}
        />
        <Button size="sm" disabled={busy} onClick={() => void persist(rate)}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

export function IssSettingsPanel({
  issRate,
  issWithhold,
  onIssRate,
  onIssWithhold,
  onSave,
}: {
  issRate: string;
  issWithhold: boolean;
  onIssRate: (v: string) => void;
  onIssWithhold: (v: boolean) => void;
  onSave: () => Promise<void>;
}) {
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => listSellersFn() });
  const rate = clampIss(issRate === "" ? ISS_DEFAULT : issRate);
  const preview = useMemo(() => {
    const companyIssRate = rate;
    const companyWithholdIss = issWithhold;
    return {
      autonomo: computeNetCommission({
        gross: 1000,
        profile: resolveTaxProfile({ regime: "autonomo", companyIssRate, companyWithholdIss }),
      }),
      pj: computeNetCommission({
        gross: 1000,
        profile: resolveTaxProfile({ regime: "pj", companyIssRate, companyWithholdIss }),
      }),
      mei: computeNetCommission({
        gross: 1000,
        profile: resolveTaxProfile({ regime: "mei", companyIssRate, companyWithholdIss }),
      }),
      meiOwn: computeNetCommission({
        gross: 1000,
        profile: resolveTaxProfile({
          regime: "mei",
          sellerIssRate: companyIssRate,
          companyIssRate,
          companyWithholdIss: true,
        }),
      }),
    };
  }, [rate, issWithhold]);

  const issSellers = (sellers.data ?? []).filter((s) =>
    ["autonomo", "pj", "mei"].includes(String(s.tax_regime)),
  );

  return (
    <div className="grid max-w-3xl gap-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Percent className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium">ISS da loja</p>
            <p className="mt-1 text-sm text-muted-foreground">{ISS_NOTE}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">{rate}% vigente</Badge>
          <Badge variant={issWithhold ? "success" : "warning"}>
            {issWithhold ? "Retenção ligada" : "Retenção desligada"}
          </Badge>
        </div>

        <IssRateField value={issRate} onChange={onIssRate} />

        <label className="flex items-start gap-2 text-sm">
          <NativeCheckbox
            className="mt-0.5"
            checked={issWithhold}
            onChange={(e) => onIssWithhold(e.target.checked)}
          />
          <span>
            Reter ISS em RPA e nota de PJ
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Desligue se o município não exige retenção na fonte. MEI continua só com alíquota própria.
            </span>
          </span>
        </label>

        <Button
          onClick={async () => {
            await onSave();
          }}
        >
          Salvar alíquota
        </Button>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Prévia em R$ 1.000 de comissão
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            {(
              [
                ["Autônomo / RPA", preview.autonomo],
                ["PJ / Simples", preview.pj],
                ["MEI no DAS", preview.mei],
                [`MEI se retiver ${rate}%`, preview.meiOwn],
              ] as const
            ).map(([label, tax]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular">
                  ISS {formatBRL(tax.iss)}
                  <span className={cn("ml-3 font-medium", tax.net < 1000 ? "text-foreground" : "text-muted-foreground")}>
                    líquido {formatBRL(tax.net)}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Autônomo também retém INSS 11% ({formatBRL(preview.autonomo.inss)} neste exemplo). {MEI_ISS_NOTE} A
            alíquota entra no próximo pagamento.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <p className="font-medium">Exceção por vendedor</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Autônomo e PJ vazios usam o padrão da loja. MEI vazio fica no DAS, sem retenção — não herda a alíquota da
          loja.
        </p>
        {sellers.isPending ? (
          <p className="mt-3 text-sm text-muted-foreground">Carregando equipe…</p>
        ) : issSellers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum autônomo, PJ ou MEI cadastrado. Defina o regime na ficha do vendedor.
          </p>
        ) : (
          <div className="mt-2">
            {issSellers.map((s) => (
              <SellerIssRow key={s.id} seller={s} companyIss={rate} withhold={issWithhold} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
