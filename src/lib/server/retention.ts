import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { dump } from "@/lib/json";
import { parseTaxBreakdown, TAX_REGIME_LABELS, isTaxRegime, money, type TaxRegime } from "@/lib/tax";
import { num } from "@/lib/utils";
import { requireTenant } from "./context";

export type RetentionSellerRow = {
  sellerId: number;
  sellerName: string;
  document: string | null;
  regime: TaxRegime;
  regimeLabel: string;
  gross: number;
  net: number;
  inss: number;
  irrf: number;
  iss: number;
  other: number;
  withheld: number;
  employerInss: number;
  employerFgts: number;
  employerCost: number;
};

export type RetentionGuidePack = {
  from: string;
  to: string;
  companyName: string;
  companyDocument: string | null;
  companyCity: string | null;
  companyState: string | null;
  rows: RetentionSellerRow[];
  totals: {
    gross: number;
    net: number;
    inss: number;
    irrf: number;
    iss: number;
    other: number;
    withheld: number;
    employerInss: number;
    employerFgts: number;
    gps: number;
    cost: number;
  };
};

function emptyTotals() {
  return {
    gross: 0,
    net: 0,
    inss: 0,
    irrf: 0,
    iss: 0,
    other: 0,
    withheld: 0,
    employerInss: 0,
    employerFgts: 0,
    gps: 0,
    cost: 0,
  };
}

export async function loadRetentionGuide(
  sql: Sql,
  companyId: number,
  from: string,
  to: string,
  sellerId?: number | null,
): Promise<RetentionGuidePack> {
  const [company] = await sql<{
    name: string;
    trade_name: string | null;
    document: string | null;
    city: string | null;
    state: string | null;
  }>`
    select name, trade_name, document, city, state from companies where id = ${companyId}
  `;
  const lines = await sql.query<{
    seller_id: number;
    seller_name: string;
    document: string | null;
    tax_regime: string | null;
    amount: string | number;
    net_amount: string | number | null;
    tax_inss: string | number | null;
    tax_irrf: string | number | null;
    tax_iss: string | number | null;
    tax_other: string | number | null;
    tax_breakdown: unknown;
  }>(
    `select c.seller_id, sl.name as seller_name, sl.document, sl.tax_regime,
            c.amount, c.net_amount, c.tax_inss, c.tax_irrf, c.tax_iss, c.tax_other, c.tax_breakdown
       from commissions c
       join sellers sl on sl.id = c.seller_id
      where c.company_id = $1 and c.status = 'pago'
        and coalesce(c.paid_at, c.created_at) >= $2::date
        and coalesce(c.paid_at, c.created_at) < ($3::date + interval '1 day')
        and ($4::int is null or c.seller_id = $4)
      order by sl.name, c.id`,
    [companyId, from, to, sellerId ?? null],
  );

  const bySeller = new Map<number, RetentionSellerRow>();
  for (const line of lines) {
    const tax = parseTaxBreakdown(line.tax_breakdown, {
      amount: num(line.amount),
      net: line.net_amount == null ? null : num(line.net_amount),
      inss: num(line.tax_inss),
      irrf: num(line.tax_irrf),
      iss: num(line.tax_iss),
      other: num(line.tax_other),
    });
    const sellerIdNum = num(line.seller_id);
    const prev = bySeller.get(sellerIdNum);
    const regime: TaxRegime = isTaxRegime(String(line.tax_regime ?? tax.regime))
      ? (String(line.tax_regime ?? tax.regime) as TaxRegime)
      : tax.regime;
    const next: RetentionSellerRow = {
      sellerId: sellerIdNum,
      sellerName: String(line.seller_name ?? prev?.sellerName ?? ""),
      document: line.document == null ? (prev?.document ?? null) : String(line.document),
      regime,
      regimeLabel: TAX_REGIME_LABELS[regime],
      gross: money((prev?.gross ?? 0) + tax.gross),
      net: money((prev?.net ?? 0) + tax.net),
      inss: money((prev?.inss ?? 0) + tax.inss),
      irrf: money((prev?.irrf ?? 0) + tax.irrf),
      iss: money((prev?.iss ?? 0) + tax.iss),
      other: money((prev?.other ?? 0) + tax.other),
      withheld: 0,
      employerInss: money((prev?.employerInss ?? 0) + tax.employerInss),
      employerFgts: money((prev?.employerFgts ?? 0) + tax.employerFgts),
      employerCost: money((prev?.employerCost ?? 0) + tax.employerCost),
    };
    next.withheld = money(next.inss + next.irrf + next.iss + next.other);
    bySeller.set(sellerIdNum, next);
  }

  const rows = [...bySeller.values()].sort((a, b) => a.sellerName.localeCompare(b.sellerName, "pt-BR"));
  const totals = rows.reduce((a, r) => {
    a.gross = money(a.gross + r.gross);
    a.net = money(a.net + r.net);
    a.inss = money(a.inss + r.inss);
    a.irrf = money(a.irrf + r.irrf);
    a.iss = money(a.iss + r.iss);
    a.other = money(a.other + r.other);
    a.withheld = money(a.withheld + r.withheld);
    a.employerInss = money(a.employerInss + r.employerInss);
    a.employerFgts = money(a.employerFgts + r.employerFgts);
    a.cost = money(a.cost + r.employerCost);
    a.gps = money(a.inss + a.employerInss);
    return a;
  }, emptyTotals());

  return {
    from,
    to,
    companyName: String(company?.trade_name || company?.name || ""),
    companyDocument: company?.document == null ? null : String(company.document),
    companyCity: company?.city == null ? null : String(company.city),
    companyState: company?.state == null ? null : String(company.state),
    rows,
    totals,
  };
}

export const retentionGuideFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { from: string; to: string; sellerId?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    return dump(await loadRetentionGuide(sql, tenant.companyId, data.from, data.to, data.sellerId));
  });
