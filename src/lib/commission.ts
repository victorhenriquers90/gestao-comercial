export const COMMISSION_KINDS = ["percent_sales", "percent_profit", "fixed_unit", "exclude"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

export const TIER_BASES = ["none", "sale", "month"] as const;
export type TierBasis = (typeof TIER_BASES)[number];

export type CommissionTier = { min: number; percent: number };

export type CommissionRule = {
  id: number;
  name: string;
  kind: string;
  sellerId: number | null;
  categoryId: number | null;
  productId: number | null;
  paymentMethod: string | null;
  percent: number;
  minAmount: number;
  skipPromo: boolean;
  onlyPromo: boolean;
  priority: number;
  isActive: boolean;
  tiers: CommissionTier[];
  tierBasis: TierBasis;
};

export type CommissionLineIn = {
  productId: number;
  productName: string;
  categoryId: number | null;
  parentCategoryId: number | null;
  quantity: number;
  total: number;
  costTotal: number;
  discount: number;
};

export type CommissionLineOut = {
  productId: number;
  productName: string;
  base: number;
  percent: number;
  amount: number;
  ruleId: number | null;
  ruleName: string;
  reason: string;
};

export type CommissionVolume = {
  saleTotal: number;
  monthRevenue: number;
};

export type TargetBonusIn = {
  id: number;
  name: string;
  amount: number;
  realized: number;
  bonusKind: string;
  bonusValue: number;
};

export type TargetHint = {
  id: number;
  name: string;
  amount: number;
  realized: number;
  remaining: number;
  progress: number;
  hit: boolean;
  crossing: boolean;
  bonusHint: string;
};

export type CommissionResult = {
  amount: number;
  percent: number;
  ruleId: number | null;
  note: string;
  defaultAmount: number;
  lines: CommissionLineOut[];
  saleTotal: number;
  monthRevenue: number;
  volumeNote: string;
  bonusNote: string;
  targetHints: TargetHint[];
};

function money(n: number): number {
  return Number(n.toFixed(2));
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function isCommissionKind(value: string): value is CommissionKind {
  return (COMMISSION_KINDS as readonly string[]).includes(value);
}

export function isTierBasis(value: string): value is TierBasis {
  return (TIER_BASES as readonly string[]).includes(value);
}

export function normalizeTiers(raw: unknown): CommissionTier[] {
  const src = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(src)) return [];
  const out: CommissionTier[] = [];
  for (const row of src) {
    if (!row || typeof row !== "object") continue;
    const min = Number((row as { min?: unknown }).min);
    const percent = Number((row as { percent?: unknown }).percent);
    if (!Number.isFinite(min) || min < 0) continue;
    if (!Number.isFinite(percent) || percent < 0) continue;
    out.push({ min: money(min), percent: money(percent) });
  }
  out.sort((a, b) => a.min - b.min);
  return out;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function pickTier(tiers: CommissionTier[], volume: number): CommissionTier | null {
  let hit: CommissionTier | null = null;
  for (const t of tiers) {
    if (volume + 0.009 >= t.min) hit = t;
  }
  return hit;
}

export function ruleSpecificity(rule: CommissionRule): number {
  let score = rule.priority * 1000;
  if (rule.productId != null) score += 100;
  if (rule.categoryId != null) score += 50;
  if (rule.sellerId != null) score += 20;
  if (rule.paymentMethod != null) score += 10;
  if (rule.onlyPromo) score += 8;
  if (rule.tiers.length && rule.tierBasis !== "none") score += 6;
  if (rule.minAmount > 0) score += 5;
  if (rule.kind === "fixed_unit") score += 4;
  return score;
}

function volumeFor(rule: CommissionRule, vol: CommissionVolume): number {
  if (rule.tierBasis === "month") return vol.monthRevenue + vol.saleTotal;
  return vol.saleTotal;
}

export function ruleMatches(
  rule: CommissionRule,
  line: CommissionLineIn,
  sellerId: number,
  paymentMethod: string | null,
  vol?: CommissionVolume,
): boolean {
  if (!rule.isActive) return false;
  if (rule.sellerId != null && rule.sellerId !== sellerId) return false;
  if (rule.productId != null && rule.productId !== line.productId) return false;
  if (
    rule.categoryId != null &&
    rule.categoryId !== line.categoryId &&
    rule.categoryId !== line.parentCategoryId
  ) {
    return false;
  }
  if (rule.paymentMethod != null && rule.paymentMethod !== paymentMethod) return false;
  if (rule.minAmount > 0 && line.total + 0.009 < rule.minAmount) return false;
  const isPromo = line.discount > 0.009;
  if (rule.skipPromo && isPromo) return false;
  if (rule.onlyPromo && !isPromo) return false;
  if (rule.tiers.length && rule.tierBasis !== "none") {
    const volume = vol ?? { saleTotal: 0, monthRevenue: 0 };
    if (!pickTier(rule.tiers, volumeFor(rule, volume))) return false;
  }
  return true;
}

export function pickRule(
  rules: CommissionRule[],
  line: CommissionLineIn,
  sellerId: number,
  paymentMethod: string | null,
  vol?: CommissionVolume,
): CommissionRule | null {
  const hits = rules.filter((r) => ruleMatches(r, line, sellerId, paymentMethod, vol));
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const d = ruleSpecificity(b) - ruleSpecificity(a);
    if (d !== 0) return d;
    return b.id - a.id;
  });
  return hits[0] ?? null;
}

function resolvedPercent(rule: CommissionRule, vol: CommissionVolume): number {
  if (rule.kind === "exclude") return 0;
  if (rule.tiers.length && rule.tierBasis !== "none") {
    const hit = pickTier(rule.tiers, volumeFor(rule, vol));
    if (hit) return hit.percent;
  }
  return rule.percent;
}

function applyRule(
  rule: CommissionRule | null,
  line: CommissionLineIn,
  sellerPercent: number,
  vol: CommissionVolume,
): { base: number; percent: number; amount: number } {
  if (rule?.kind === "exclude") {
    return { base: 0, percent: 0, amount: 0 };
  }
  if (rule?.kind === "fixed_unit") {
    const qty = Math.max(0, line.quantity);
    const unit = rule.percent;
    return { base: qty, percent: unit, amount: money(qty * unit) };
  }
  const kind = rule?.kind ?? "percent_sales";
  const percent = rule ? resolvedPercent(rule, vol) : sellerPercent;
  const base = kind === "percent_profit" ? Math.max(0, line.total - line.costTotal) : line.total;
  return { base, percent, amount: money((base * percent) / 100) };
}

function describeRule(
  rule: CommissionRule | null,
  sellerPercent: number,
  sellerName: string,
  vol: CommissionVolume,
): { ruleId: number | null; ruleName: string; reason: string } {
  if (!rule) {
    return {
      ruleId: null,
      ruleName: `Padrão ${sellerPercent}%`,
      reason: `Nenhuma regra específica — usa o percentual de ${sellerName || "vendedor"} (${sellerPercent}%).`,
    };
  }
  if (rule.kind === "exclude") {
    return { ruleId: rule.id, ruleName: rule.name || "Sem comissão", reason: "Esta regra zera a comissão do item." };
  }
  const bits: string[] = [];
  if (rule.productId != null) bits.push("produto");
  if (rule.categoryId != null) bits.push("categoria");
  if (rule.sellerId != null) bits.push("vendedor");
  if (rule.paymentMethod != null) bits.push("pagamento");
  if (rule.onlyPromo) bits.push("só promoção");
  if (rule.kind === "fixed_unit") bits.push("valor por peça");
  if (rule.tiers.length && rule.tierBasis !== "none") {
    const volume = volumeFor(rule, vol);
    const hit = pickTier(rule.tiers, volume);
    bits.push(rule.tierBasis === "month" ? "faixa do mês" : "faixa da venda");
    const scope = bits.length ? bits.join(" + ") : "geral";
    return {
      ruleId: rule.id,
      ruleName: rule.name || `${hit?.percent ?? rule.percent}%`,
      reason: `Regra de ${scope} · volume ${brl(volume)} atinge ${hit?.percent ?? rule.percent}%.`,
    };
  }
  const scope = bits.length ? bits.join(" + ") : "geral";
  const base =
    rule.kind === "percent_profit" ? "sobre o lucro" : rule.kind === "fixed_unit" ? "por unidade" : "sobre a venda";
  return {
    ruleId: rule.id,
    ruleName: rule.name || `${rule.percent}%`,
    reason: `Regra de ${scope} vence o padrão ${sellerPercent}% · ${base}.`,
  };
}

function volumeNote(rulesUsed: CommissionRule[], vol: CommissionVolume): string {
  const tiered = rulesUsed.find((r) => r.tiers.length && r.tierBasis !== "none");
  if (!tiered) return "";
  const volume = volumeFor(tiered, vol);
  const hit = pickTier(tiered.tiers, volume);
  if (!hit) return "";
  if (tiered.tierBasis === "month") {
    return `No mês o vendedor já soma ${brl(vol.monthRevenue)} e esta venda leva a ${brl(volume)} → faixa ${hit.percent}%.`;
  }
  return `Total desta venda ${brl(vol.saleTotal)} → faixa ${hit.percent}%.`;
}

function reached(realized: number, saleTotal: number, goal: number): boolean {
  return realized + saleTotal + 0.009 >= goal;
}

function isCrossing(realized: number, saleTotal: number, goal: number): boolean {
  return realized + 0.009 < goal && reached(realized, saleTotal, goal);
}

export function applyTargetBonuses(targets: TargetBonusIn[], saleTotal: number): CommissionLineOut[] {
  const extra: CommissionLineOut[] = [];
  for (const t of targets) {
    if (t.bonusValue <= 0) continue;
    const hit = reached(t.realized, saleTotal, t.amount);
    const crossing = isCrossing(t.realized, saleTotal, t.amount);
    if (t.bonusKind === "extra_percent" && hit && saleTotal > 0.009) {
      extra.push({
        productId: 0,
        productName: `Bônus · ${t.name}`,
        base: saleTotal,
        percent: t.bonusValue,
        amount: money((saleTotal * t.bonusValue) / 100),
        ruleId: null,
        ruleName: `Meta +${t.bonusValue}%`,
        reason: `Meta ${t.name} atingida (${brl(t.realized + saleTotal)} de ${brl(t.amount)}) — +${t.bonusValue}% sobre esta venda.`,
      });
    }
    if (t.bonusKind === "extra_fixed" && crossing) {
      extra.push({
        productId: 0,
        productName: `Bônus · ${t.name}`,
        base: t.bonusValue,
        percent: 0,
        amount: money(t.bonusValue),
        ruleId: null,
        ruleName: `Meta +${brl(t.bonusValue)}`,
        reason: `Esta venda cruzou a meta ${t.name} — bônus fixo de ${brl(t.bonusValue)}.`,
      });
    }
  }
  return extra;
}

export function describeTargetHints(targets: TargetBonusIn[], saleTotal: number): TargetHint[] {
  return targets.map((t) => {
    const after = money(t.realized + saleTotal);
    const hit = reached(t.realized, saleTotal, t.amount);
    const crossing = isCrossing(t.realized, saleTotal, t.amount);
    const remaining = money(Math.max(0, t.amount - after));
    const progress = t.amount > 0 ? (after / t.amount) * 100 : 0;
    let bonusHint: string;
    if (t.bonusKind === "extra_percent" && t.bonusValue > 0) {
      bonusHint = hit
        ? `Meta batida — +${t.bonusValue}% nesta venda.`
        : `Faltam ${brl(remaining)} para +${t.bonusValue}% de bônus.`;
    } else if (t.bonusKind === "extra_fixed" && t.bonusValue > 0) {
      if (crossing) bonusHint = `Cruzou a meta — bônus de ${brl(t.bonusValue)} nesta venda.`;
      else if (hit) bonusHint = `Meta já batida — o bônus fixo vale só no cruzamento.`;
      else bonusHint = `Faltam ${brl(remaining)} para o bônus de ${brl(t.bonusValue)}.`;
    } else {
      bonusHint = hit ? "Meta batida." : `Faltam ${brl(remaining)}.`;
    }
    return {
      id: t.id,
      name: t.name,
      amount: t.amount,
      realized: money(t.realized),
      remaining,
      progress,
      hit,
      crossing,
      bonusHint,
    };
  });
}

export function computeCommission(input: {
  sellerId: number;
  sellerPercent: number;
  sellerName?: string;
  paymentMethod: string | null;
  headerDiscount?: number;
  monthRevenue?: number;
  rules: CommissionRule[];
  items: CommissionLineIn[];
  targets?: TargetBonusIn[];
}): CommissionResult {
  const header = Math.max(0, input.headerDiscount ?? 0);
  const subtotal = input.items.reduce((a, i) => a + i.total, 0);
  const adjusted: CommissionLineIn[] = input.items.map((line) => {
    const share = subtotal > 0 ? line.total / subtotal : 0;
    return { ...line, total: money(Math.max(0, line.total - header * share)) };
  });

  const saleTotal = money(adjusted.reduce((a, l) => a + l.total, 0));
  const monthRevenue = money(Math.max(0, input.monthRevenue ?? 0));
  const vol: CommissionVolume = { saleTotal, monthRevenue };

  const used: CommissionRule[] = [];
  const lines: CommissionLineOut[] = adjusted.map((line) => {
    const rule = pickRule(input.rules, line, input.sellerId, input.paymentMethod, vol);
    if (rule) used.push(rule);
    const applied = applyRule(rule, line, input.sellerPercent, vol);
    const desc = describeRule(rule, input.sellerPercent, input.sellerName ?? "vendedor", vol);
    return {
      productId: line.productId,
      productName: line.productName,
      base: money(applied.base),
      percent: applied.percent,
      amount: applied.amount,
      ruleId: desc.ruleId,
      ruleName: desc.ruleName,
      reason: desc.reason,
    };
  });

  const extra = applyTargetBonuses(input.targets ?? [], saleTotal);
  const allLines = [...lines, ...extra];
  const amount = money(allLines.reduce((a, l) => a + l.amount, 0));
  const percent = saleTotal > 0 ? money((amount / saleTotal) * 100) : 0;
  const defaultAmount = money((saleTotal * input.sellerPercent) / 100);
  const names = [...new Set(allLines.map((l) => l.ruleName))];
  const uniqueIds = [...new Set(lines.map((l) => l.ruleId))];
  return {
    amount,
    percent,
    ruleId: uniqueIds.length === 1 ? (uniqueIds[0] ?? null) : null,
    note: names.join(" · ") || `Padrão ${input.sellerPercent}%`,
    defaultAmount,
    lines: allLines,
    saleTotal,
    monthRevenue,
    volumeNote: volumeNote(used, vol),
    bonusNote: extra.map((l) => `${l.ruleName} (${brl(l.amount)})`).join(" · "),
    targetHints: describeTargetHints(input.targets ?? [], saleTotal),
  };
}
