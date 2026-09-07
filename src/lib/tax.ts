export const TAX_REGIMES = ["none", "clt", "autonomo", "mei", "pj"] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  none: "Sem retenção",
  clt: "CLT (folha)",
  autonomo: "Autônomo / RPA",
  mei: "MEI",
  pj: "PJ / Simples",
};

export const TAX_TABLE_NOTE =
  "Tabelas INSS e IRRF de 2026 (Portaria MPS/MF 13/2026 e Leis 15.191 e 15.270/2025). Estimativa para conferência — o valor oficial sai da folha ou do RPA com o contador.";

export const INSS_CEILING = 8475.55;
export const INSS_AUTONOMO_RATE = 0.11;
export const FGTS_RATE = 0.08;
export const EMPLOYER_INSS_RATE = 0.2;
export const PJ_WITHHOLD_465 = 0.0465;
export const PJ_IRRF_RATE = 0.015;
export const DEPENDENT_DEDUCTION = 189.59;
export const SIMPLIFIED_DEDUCTION = 607.2;
export const IR_REDUCTION_K = 978.62;
export const IR_REDUCTION_SLOPE = 0.133145;
export const IR_REDUCTION_END = 7350;

export const ISS_MAX = 5;
export const ISS_DEFAULT = 5;
export const ISS_PRESETS = [2, 3, 4, 5] as const;
export const ISS_NOTE =
  "ISS municipal, teto de 5% (LC 116). A alíquota da loja vale para autônomo e PJ. MEI não herda esse percentual — só retém com alíquota própria. CLT não sofre ISS. Vale para as próximas vendas e pagamentos — o que já foi lançado mantém o cálculo da época.";

export const MEI_ISS_NOTE =
  "O MEI já recolhe ISS no DAS. A loja não retém na fonte, a menos que este vendedor tenha alíquota própria — quando o município exige retenção.";

const INSS_BANDS: { cap: number; rate: number }[] = [
  { cap: 1621, rate: 0.075 },
  { cap: 2902.84, rate: 0.09 },
  { cap: 4354.27, rate: 0.12 },
  { cap: INSS_CEILING, rate: 0.14 },
];

const IRRF_BANDS: { cap: number; rate: number; ded: number }[] = [
  { cap: 2428.8, rate: 0, ded: 0 },
  { cap: 2826.65, rate: 0.075, ded: 182.16 },
  { cap: 3751.05, rate: 0.15, ded: 394.16 },
  { cap: 4664.68, rate: 0.225, ded: 675.49 },
  { cap: Number.POSITIVE_INFINITY, rate: 0.275, ded: 908.73 },
];

export type TaxProfile = {
  regime: TaxRegime;
  monthlySalary: number;
  dependents: number;
  issRate: number;
  withholdIss: boolean;
};

export type TaxLine = {
  key: string;
  label: string;
  amount: number;
  note: string;
};

export type TaxResult = {
  regime: TaxRegime;
  gross: number;
  inss: number;
  irrf: number;
  iss: number;
  other: number;
  otherLabel: string;
  totalTax: number;
  net: number;
  employerInss: number;
  employerFgts: number;
  employerCost: number;
  lines: TaxLine[];
  note: string;
};

export type TaxSplit = {
  gross: number;
  inss: number;
  irrf: number;
  iss: number;
  other: number;
  net: number;
};

export function isTaxRegime(value: string): value is TaxRegime {
  return (TAX_REGIMES as readonly string[]).includes(value);
}

export function money(n: number): number {
  return Math.round(n * 100 + 1e-6) / 100;
}

export function clampIss(n: number | string | null | undefined): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return money(Math.min(ISS_MAX, Math.max(0, v)));
}

/** Empty MEI field means DAS (no withholding), not the store rate. */
export function issFieldValue(
  regime: string | null | undefined,
  sellerIss: number | null | undefined,
  companyIss: number,
): string {
  if (sellerIss != null) return String(sellerIss);
  if (regime === "mei") return "";
  return String(companyIss);
}

export function issSellerHint(
  regime: string | null | undefined,
  sellerIss: number | null | undefined,
  companyIss: number,
): string {
  const raw = regime ?? "none";
  if (raw === "mei") {
    return sellerIss != null && Number(sellerIss) > 0
      ? `ISS ${clampIss(sellerIss)}% próprio`
      : "DAS, sem ISS na fonte";
  }
  if (raw === "autonomo" || raw === "pj") {
    return sellerIss != null ? `ISS ${clampIss(sellerIss)}%` : `ISS ${clampIss(companyIss)}% loja`;
  }
  return "Sem ISS";
}


export function slipTitle(regime: TaxRegime): string {
  if (regime === "clt") return "Demonstrativo de comissão";
  if (regime === "autonomo") return "RPA — Recibo de pagamento a autônomo";
  if (regime === "pj") return "Recibo de pagamento a PJ";
  if (regime === "mei") return "Recibo de pagamento a MEI";
  return "Recibo de comissão";
}

export function resolveTaxProfile(input: {
  regime?: string | null;
  monthlySalary?: number | null;
  dependents?: number | null;
  sellerIssRate?: number | null;
  companyIssRate?: number | null;
  companyWithholdIss?: boolean | null;
}): TaxProfile {
  const raw = input.regime ?? "none";
  const regime: TaxRegime = isTaxRegime(raw) ? raw : "none";
  const companyIss = clampIss(input.companyIssRate ?? ISS_DEFAULT);
  const sellerIss = input.sellerIssRate == null ? null : clampIss(input.sellerIssRate);
  const issRate = sellerIss ?? companyIss;
  const companyWithhold = input.companyWithholdIss !== false;
  let withholdIss = false;
  if (regime === "autonomo" || regime === "pj") {
    withholdIss = companyWithhold && issRate > 0;
  } else if (regime === "mei") {
    withholdIss = sellerIss != null && sellerIss > 0;
  }
  return {
    regime,
    monthlySalary: Math.max(0, Number(input.monthlySalary) || 0),
    dependents: Math.max(0, Math.floor(Number(input.dependents) || 0)),
    issRate,
    withholdIss,
  };
}

export function inssClt(base: number): number {
  const v = Math.min(Math.max(0, base), INSS_CEILING);
  let prev = 0;
  let tax = 0;
  for (const b of INSS_BANDS) {
    if (v <= prev) break;
    const slice = Math.min(v, b.cap) - prev;
    tax += slice * b.rate;
    prev = b.cap;
  }
  return money(tax);
}

export function inssAutonomo(base: number): number {
  const v = Math.min(Math.max(0, base), INSS_CEILING);
  return money(v * INSS_AUTONOMO_RATE);
}

export function irrfFromTable(base: number): number {
  const v = Math.max(0, base);
  for (const b of IRRF_BANDS) {
    if (v <= b.cap) return money(Math.max(0, v * b.rate - b.ded));
  }
  return 0;
}

export function irrfMonthly(gross: number, inss: number, dependents: number): number {
  const g = Math.max(0, gross);
  if (g <= 5000) return 0;
  const dep = Math.max(0, dependents) * DEPENDENT_DEDUCTION;
  const deduction = Math.max(SIMPLIFIED_DEDUCTION, inss + dep);
  const base = Math.max(0, g - deduction);
  const table = irrfFromTable(base);
  if (g >= IR_REDUCTION_END) return table;
  const reduction = Math.max(0, IR_REDUCTION_K - IR_REDUCTION_SLOPE * g);
  return money(Math.max(0, table - reduction));
}

function emptyResult(g: number, regime: TaxRegime, note: string): TaxResult {
  return {
    regime,
    gross: g,
    inss: 0,
    irrf: 0,
    iss: 0,
    other: 0,
    otherLabel: "",
    totalTax: 0,
    net: g,
    employerInss: 0,
    employerFgts: 0,
    employerCost: g,
    lines: [],
    note,
  };
}

function pack(
  partial: Omit<TaxResult, "totalTax" | "net" | "employerCost"> & { employerCost?: number },
): TaxResult {
  const totalTax = money(partial.inss + partial.irrf + partial.iss + partial.other);
  const net = money(Math.max(0, partial.gross - totalTax));
  const employerCost =
    partial.employerCost ?? money(partial.gross + partial.employerInss + partial.employerFgts);
  return { ...partial, totalTax, net, employerCost };
}

export function computeNetCommission(input: {
  gross: number;
  monthCommissionBefore?: number;
  profile: TaxProfile;
}): TaxResult {
  const gross = money(Math.max(0, input.gross));
  const before = money(Math.max(0, input.monthCommissionBefore ?? 0));
  const p = input.profile;

  if (gross <= 0) {
    return emptyResult(0, p.regime, "Sem comissão bruta neste lançamento.");
  }
  if (p.regime === "none") {
    return emptyResult(gross, "none", "Sem regime tributário — o líquido é o bruto.");
  }

  if (p.regime === "mei") {
    const iss = p.withholdIss ? money((gross * p.issRate) / 100) : 0;
    const lines: TaxLine[] = [];
    if (iss > 0) {
      lines.push({
        key: "iss",
        label: `ISS ${p.issRate}%`,
        amount: iss,
        note: "Retenção municipal configurada para este MEI.",
      });
    }
    return pack({
      regime: "mei",
      gross,
      inss: 0,
      irrf: 0,
      iss,
      other: 0,
      otherLabel: "",
      employerInss: 0,
      employerFgts: 0,
      lines,
      note: iss
        ? "MEI sem INSS/IRRF na fonte. ISS retido só porque este vendedor tem alíquota própria."
        : "MEI sem INSS/IRRF na fonte. ISS fica no DAS — a loja não retém.",
    });
  }

  if (p.regime === "pj") {
    const iss = p.withholdIss ? money((gross * p.issRate) / 100) : 0;
    const other = money(gross * PJ_WITHHOLD_465);
    const irrf = money(gross * PJ_IRRF_RATE);
    const lines: TaxLine[] = [];
    if (other > 0) {
      lines.push({
        key: "other",
        label: "PIS / COFINS / CSLL 4,65%",
        amount: other,
        note: "Retenção federal em nota de pessoa jurídica.",
      });
    }
    if (irrf > 0) {
      lines.push({
        key: "irrf",
        label: "IR 1,5%",
        amount: irrf,
        note: "IRRF sobre o serviço de PJ.",
      });
    }
    if (iss > 0) {
      lines.push({
        key: "iss",
        label: `ISS ${p.issRate}%`,
        amount: iss,
        note: "ISS municipal retido na fonte.",
      });
    }
    return pack({
      regime: "pj",
      gross,
      inss: 0,
      irrf,
      iss,
      other,
      otherLabel: "PIS / COFINS / CSLL",
      employerInss: 0,
      employerFgts: 0,
      lines,
      note: "PJ: a loja retém 4,65% (PIS/COFINS/CSLL), IR 1,5% e ISS quando a alíquota da loja estiver ligada.",
    });
  }

  if (p.regime === "clt") {
    const prevBase = money(p.monthlySalary + before);
    const base = money(prevBase + gross);
    const inss = money(inssClt(base) - inssClt(prevBase));
    const irrf = money(
      irrfMonthly(base, inssClt(base), p.dependents) - irrfMonthly(prevBase, inssClt(prevBase), p.dependents),
    );
    const employerInss = money(gross * EMPLOYER_INSS_RATE);
    const employerFgts = money(gross * FGTS_RATE);
    const lines: TaxLine[] = [];
    if (inss > 0) {
      lines.push({
        key: "inss",
        label: "INSS (folha)",
        amount: inss,
        note: "Diferença de INSS desta comissão sobre o salário do mês.",
      });
    }
    if (irrf > 0) {
      lines.push({
        key: "irrf",
        label: "IRRF",
        amount: irrf,
        note: "Diferença de IRRF desta comissão, com isenção até R$ 5.000.",
      });
    }
    return pack({
      regime: "clt",
      gross,
      inss,
      irrf,
      iss: 0,
      other: 0,
      otherLabel: "",
      employerInss,
      employerFgts,
      lines,
      note: "CLT: a comissão entra na folha. A loja recolhe 20% de INSS patronal e 8% de FGTS sobre o bruto.",
    });
  }

  const prevGross = before;
  const monthGross = money(before + gross);
  const inss = money(inssAutonomo(monthGross) - inssAutonomo(prevGross));
  const irrf = money(
    irrfMonthly(monthGross, inssAutonomo(monthGross), p.dependents) -
      irrfMonthly(prevGross, inssAutonomo(prevGross), p.dependents),
  );
  const iss = p.withholdIss ? money((gross * p.issRate) / 100) : 0;
  const employerInss = money(gross * EMPLOYER_INSS_RATE);
  const lines: TaxLine[] = [];
  if (inss > 0) {
    lines.push({
      key: "inss",
      label: "INSS 11%",
      amount: inss,
      note: "RPA: 11% sobre o bruto, limitado ao teto mensal.",
    });
  }
  if (irrf > 0) {
    lines.push({
      key: "irrf",
      label: "IRRF",
      amount: irrf,
      note: "IRRF do RPA, com isenção até R$ 5.000 no mês.",
    });
  }
  if (iss > 0) {
    lines.push({
      key: "iss",
      label: `ISS ${p.issRate}%`,
      amount: iss,
      note: "ISS municipal retido na fonte.",
    });
  }
  return pack({
    regime: "autonomo",
    gross,
    inss,
    irrf,
    iss,
    other: 0,
    otherLabel: "",
    employerInss,
    employerFgts: 0,
    lines,
    note: "RPA: a loja retém INSS 11% (e ISS/IR se couber) e ainda recolhe 20% de INSS patronal.",
  });
}

export function allocateTax(amounts: number[], tax: TaxResult): TaxSplit[] {
  const values = amounts.map((n) => money(Math.max(0, n)));
  const total = money(values.reduce((a, n) => a + n, 0));
  if (values.length === 0) return [];
  if (total <= 0) {
    return values.map((gross) => ({ gross, inss: 0, irrf: 0, iss: 0, other: 0, net: gross }));
  }
  const used = { inss: 0, irrf: 0, iss: 0, other: 0 };
  return values.map((gross, i) => {
    const last = i === values.length - 1;
    const share = gross / total;
    const inss = last ? money(tax.inss - used.inss) : money(tax.inss * share);
    const irrf = last ? money(tax.irrf - used.irrf) : money(tax.irrf * share);
    const iss = last ? money(tax.iss - used.iss) : money(tax.iss * share);
    const other = last ? money(tax.other - used.other) : money(tax.other * share);
    used.inss = money(used.inss + inss);
    used.irrf = money(used.irrf + irrf);
    used.iss = money(used.iss + iss);
    used.other = money(used.other + other);
    return {
      gross,
      inss,
      irrf,
      iss,
      other,
      net: money(gross - inss - irrf - iss - other),
    };
  });
}

export function taxToJson(tax: TaxResult): Record<string, unknown> {
  return {
    regime: tax.regime,
    gross: tax.gross,
    inss: tax.inss,
    irrf: tax.irrf,
    iss: tax.iss,
    other: tax.other,
    otherLabel: tax.otherLabel,
    totalTax: tax.totalTax,
    net: tax.net,
    employerInss: tax.employerInss,
    employerFgts: tax.employerFgts,
    employerCost: tax.employerCost,
    lines: tax.lines,
    note: tax.note,
  };
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asLines(raw: unknown): TaxLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const amount = asNumber(o.amount, 0);
      if (amount <= 0) return null;
      return {
        key: String(o.key ?? ""),
        label: String(o.label ?? o.key ?? ""),
        amount,
        note: String(o.note ?? ""),
      };
    })
    .filter((l): l is TaxLine => l != null);
}

export function parseTaxBreakdown(
  raw: unknown,
  fallback: {
    amount: number;
    net?: number | null;
    inss?: number | null;
    irrf?: number | null;
    iss?: number | null;
    other?: number | null;
  },
): TaxResult {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const gross = asNumber(o.gross, fallback.amount);
  const inss = asNumber(o.inss, fallback.inss ?? 0);
  const irrf = asNumber(o.irrf, fallback.irrf ?? 0);
  const iss = asNumber(o.iss, fallback.iss ?? 0);
  const other = asNumber(o.other, fallback.other ?? 0);
  const totalTax = asNumber(o.totalTax, money(inss + irrf + iss + other));
  const net = asNumber(o.net, fallback.net ?? money(Math.max(0, gross - totalTax)));
  const regimeRaw = String(o.regime ?? "none");
  const regime: TaxRegime = isTaxRegime(regimeRaw) ? regimeRaw : "none";
  const employerInss = asNumber(o.employerInss, 0);
  const employerFgts = asNumber(o.employerFgts, 0);
  const employerCost = asNumber(o.employerCost, money(gross + employerInss + employerFgts));
  let lines = asLines(o.lines);
  if (lines.length === 0) {
    if (inss > 0) lines.push({ key: "inss", label: "INSS", amount: inss, note: "" });
    if (irrf > 0) lines.push({ key: "irrf", label: "IRRF", amount: irrf, note: "" });
    if (iss > 0) lines.push({ key: "iss", label: "ISS", amount: iss, note: "" });
    if (other > 0) {
      lines.push({
        key: "other",
        label: String(o.otherLabel ?? "Outros"),
        amount: other,
        note: "",
      });
    }
  }
  return {
    regime,
    gross,
    inss,
    irrf,
    iss,
    other,
    otherLabel: String(o.otherLabel ?? ""),
    totalTax,
    net,
    employerInss,
    employerFgts,
    employerCost,
    lines,
    note: String(o.note ?? ""),
  };
}
