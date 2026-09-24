import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  computeCommission,
  isCommissionKind,
  isTierBasis,
  normalizeTiers,
  type CommissionLineOut,
  type CommissionRule,
  type CommissionTier,
  type TargetBonusIn,
  type TierBasis,
} from "@/lib/commission";
import { clampIss, computeNetCommission, ISS_DEFAULT, resolveTaxProfile, taxToJson, type TaxResult } from "@/lib/tax";
import type { Sql } from "@/lib/db";
import { type Row } from "@/lib/json";
import { assertCan, can } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { assertOwned, requireTenant } from "./context";

export function parseBreakdown(raw: unknown): CommissionLineOut[] {
  const src = typeof raw === "string" ? (() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  })() : raw;
  if (!Array.isArray(src)) return [];
  return src.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      productId: num(r.productId),
      productName: String(r.productName ?? ""),
      base: num(r.base),
      percent: num(r.percent),
      amount: num(r.amount),
      ruleId: r.ruleId == null ? null : num(r.ruleId),
      ruleName: String(r.ruleName ?? ""),
      reason: String(r.reason ?? ""),
    };
  });
}

export async function companyTaxSettings(
  sql: Sql,
  companyId: number,
): Promise<{ issRate: number; withholdIss: boolean }> {
  const [row] = await sql<{ iss_rate: string | number | null; iss_withhold: boolean | null }>`
    select iss_rate, iss_withhold from company_settings where company_id = ${companyId}
  `;
  return {
    issRate: row?.iss_rate == null ? ISS_DEFAULT : clampIss(row.iss_rate),
    withholdIss: row?.iss_withhold !== false,
  };
}

export async function sellerMonthCommission(
  sql: Sql,
  companyId: number,
  sellerId: number,
  excludeSaleId?: number,
  onlyPaid = false,
): Promise<number> {
  const [row] = await sql.query<{ total: string | number }>(
    `select coalesce(sum(amount),0) as total
       from commissions
      where company_id = $1 and seller_id = $2
        and status <> 'cancelado'
        and created_at >= date_trunc('month', now())
        and ($3::int is null or sale_id is distinct from $3)
        and ($4::bool is not true or status = 'pago')`,
    [companyId, sellerId, excludeSaleId ?? null, onlyPaid],
  );
  return num(row?.total);
}

type SellerTaxRow = {
  tax_regime?: string | null;
  monthly_salary?: string | number | null;
  dependents?: string | number | null;
  iss_rate?: string | number | null;
};

export function profileFromSeller(
  seller: SellerTaxRow,
  company: { issRate: number; withholdIss: boolean },
) {
  return resolveTaxProfile({
    regime: seller.tax_regime == null ? "none" : String(seller.tax_regime),
    monthlySalary: num(seller.monthly_salary),
    dependents: num(seller.dependents),
    sellerIssRate: seller.iss_rate == null ? null : num(seller.iss_rate),
    companyIssRate: company.issRate,
    companyWithholdIss: company.withholdIss,
  });
}

export async function taxForSeller(
  sql: Sql,
  companyId: number,
  sellerId: number,
  gross: number,
  opts?: { excludeSaleId?: number; onlyPaid?: boolean },
): Promise<TaxResult> {
  const [seller] = await sql<SellerTaxRow>`
    select tax_regime, monthly_salary, dependents, iss_rate
      from sellers where id = ${sellerId} and company_id = ${companyId}
  `;
  const company = await companyTaxSettings(sql, companyId);
  const monthBefore = await sellerMonthCommission(
    sql,
    companyId,
    sellerId,
    opts?.excludeSaleId,
    opts?.onlyPaid,
  );
  return computeNetCommission({
    gross,
    monthCommissionBefore: monthBefore,
    profile: profileFromSeller(seller ?? {}, company),
  });
}

export function taxInsert(tax: TaxResult) {
  return {
    net: tax.net,
    inss: tax.inss,
    irrf: tax.irrf,
    iss: tax.iss,
    other: tax.other,
    json: JSON.stringify(taxToJson(tax)),
  };
}

function mapRule(r: Row): CommissionRule {
  const basisRaw = String(r.tier_basis ?? "none");
  return {
    id: num(r.id),
    name: String(r.name ?? ""),
    kind: String(r.kind ?? "percent_sales"),
    sellerId: r.seller_id == null ? null : num(r.seller_id),
    categoryId: r.category_id == null ? null : num(r.category_id),
    productId: r.product_id == null ? null : num(r.product_id),
    paymentMethod: r.payment_method == null ? null : String(r.payment_method),
    percent: num(r.percent),
    minAmount: num(r.min_amount),
    skipPromo: Boolean(r.skip_promo),
    onlyPromo: Boolean(r.only_promo),
    priority: num(r.priority),
    isActive: r.is_active == null ? true : Boolean(r.is_active),
    tiers: normalizeTiers(r.tiers),
    tierBasis: isTierBasis(basisRaw) ? basisRaw : "none",
  };
}

export async function loadCommissionRules(sql: Sql, companyId: number): Promise<CommissionRule[]> {
  const rows = await sql<Row>`
    select id, name, kind, seller_id, category_id, product_id, payment_method,
           percent, min_amount, skip_promo, only_promo, priority, is_active,
           tiers, tier_basis
      from commission_rules
     where company_id = ${companyId}
     order by priority desc, id desc
  `;
  return rows.map(mapRule);
}

export async function sellerMonthRevenue(
  sql: Sql,
  companyId: number,
  sellerId: number,
  excludeSaleId?: number,
): Promise<number> {
  const [row] = await sql.query<{ total: string | number }>(
    `select coalesce(sum(total),0) as total
       from sales
      where company_id = $1 and seller_id = $2
        and status in ('finalizada','devolvida_parcial')
        and sold_at >= date_trunc('month', now())
        and ($3::int is null or id <> $3)`,
    [companyId, sellerId, excludeSaleId ?? null],
  );
  return num(row?.total);
}

export async function loadSellerTargetBonuses(
  sql: Sql,
  companyId: number,
  sellerId: number,
  opts?: { storeId?: number | null; excludeSaleId?: number },
): Promise<TargetBonusIn[]> {
  /*
    UMA consulta, nao uma por meta.

    Antes isto era N+1: buscava as metas e disparava um `sum(total)` para
    cada uma. O PDV chama esta funcao a cada mudanca do carrinho, entao eram
    N idas ao banco por item que o operador adiciona.

    `left join lateral` preserva a semantica exata da versao anterior -- cada
    meta continua avaliada com o SEU periodo, loja e categoria, porque o
    bloco lateral enxerga a linha `t`. E `left join`, nao `join`: meta sem
    venda no periodo tem que aparecer com realizado zero, nao sumir da lista
    (seria bonus calculado sobre uma meta invisivel).
  */
  const rows = await sql.query<Row>(
    `select t.id, t.name, t.amount, t.bonus_kind, t.bonus_value,
            coalesce(r.v, 0) as realized
       from targets t
       left join lateral (
         select coalesce(sum(s.total), 0) as v
           from sales s
          where s.company_id = t.company_id
            and s.status = 'finalizada' and s.deleted_at is null
            and s.sold_at >= t.period_start
            and s.sold_at < (t.period_end + interval '1 day')
            and (t.store_id is null or s.store_id = t.store_id)
            and s.seller_id = $2
            and (t.category_id is null or exists (
              select 1 from sale_items si join products p on p.id = si.product_id
               where si.sale_id = s.id and p.category_id = t.category_id
            ))
            and ($4::int is null or s.id <> $4)
       ) r on true
      where t.company_id = $1
        and t.seller_id = $2
        and t.period_start <= current_date and t.period_end >= current_date
        and ($3::int is null or t.store_id is null or t.store_id = $3)
      order by t.id`,
    [companyId, sellerId, opts?.storeId ?? null, opts?.excludeSaleId ?? null],
  );
  return rows.map((t) => ({
    id: num(t.id),
    name: String(t.name ?? ""),
    amount: num(t.amount),
    realized: num(t.realized),
    bonusKind: String(t.bonus_kind ?? "none"),
    bonusValue: num(t.bonus_value),
  }));
}

export const listCommissionRulesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.write");
    const rows = await sql<Row>`
      select r.*, sl.name as seller_name, c.name as category_name, p.name as product_name
        from commission_rules r
        left join sellers sl on sl.id = r.seller_id
        left join categories c on c.id = r.category_id
        left join products p on p.id = r.product_id
       where r.company_id = ${tenant.companyId}
       order by r.is_active desc, r.priority desc, r.id desc
    `;
    return rows.map((r) => ({
      ...mapRule(r),
      sellerName: r.seller_name == null ? null : String(r.seller_name),
      categoryName: r.category_name == null ? null : String(r.category_name),
      productName: r.product_name == null ? null : String(r.product_name),
    }));
  });

export type SaveCommissionRuleIn = {
  id?: number;
  name: string;
  kind: string;
  percent: number;
  sellerId?: number | null;
  categoryId?: number | null;
  productId?: number | null;
  paymentMethod?: string | null;
  minAmount?: number;
  skipPromo?: boolean;
  onlyPromo?: boolean;
  priority?: number;
  isActive?: boolean;
  tiers?: CommissionTier[];
  tierBasis?: string;
};

function normalizeRule(data: SaveCommissionRuleIn): SaveCommissionRuleIn & {
  tiers: CommissionTier[];
  tierBasis: TierBasis;
} {
  const kind = isCommissionKind(data.kind) ? data.kind : "percent_sales";
  const name = data.name.trim();
  const percent = kind === "exclude" ? 0 : Math.max(0, Number(data.percent) || 0);
  let tierBasis: TierBasis = isTierBasis(data.tierBasis ?? "none") ? (data.tierBasis as TierBasis) : "none";
  let tiers = normalizeTiers(data.tiers);
  if (kind === "exclude" || kind === "fixed_unit") {
    tierBasis = "none";
    tiers = [];
  }
  if (tierBasis === "none") tiers = [];
  return { ...data, kind, name, percent, tiers, tierBasis };
}

export const saveCommissionRuleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: SaveCommissionRuleIn) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.write");
    const n = normalizeRule(data);
    if (n.kind !== "fixed_unit" && n.kind !== "exclude" && n.percent > 100) {
      throw new Error("Percentual inválido.");
    }
    if (n.kind === "fixed_unit" && n.percent > 10000) {
      throw new Error("Valor por peça inválido.");
    }
    // Regra de outra empresa nunca bateria com venda daqui, mas o dropdown
    // so oferece o que e desta empresa -- so chega ID de outra por chamada
    // direta a API, e a regra ficaria salva sem NUNCA se aplicar a nada.
    await assertOwned(sql, tenant.companyId, "sellers", n.sellerId);
    await assertOwned(sql, tenant.companyId, "categories", n.categoryId);
    await assertOwned(sql, tenant.companyId, "products", n.productId);
    const skipPromo = Boolean(n.skipPromo) && !n.onlyPromo;
    const onlyPromo = Boolean(n.onlyPromo);
    const tiersJson = JSON.stringify(n.tiers);
    if (n.id) {
      await sql`
        update commission_rules set
          name = ${n.name},
          kind = ${n.kind},
          percent = ${n.percent},
          seller_id = ${n.sellerId ?? null},
          category_id = ${n.categoryId ?? null},
          product_id = ${n.productId ?? null},
          payment_method = ${n.paymentMethod ?? null},
          min_amount = ${n.minAmount ?? 0},
          skip_promo = ${skipPromo},
          only_promo = ${onlyPromo},
          priority = ${n.priority ?? 0},
          is_active = ${n.isActive ?? true},
          tiers = ${tiersJson}::jsonb,
          tier_basis = ${n.tierBasis},
          updated_at = now()
        where id = ${n.id} and company_id = ${tenant.companyId}
      `;
      return { id: n.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into commission_rules (
        company_id, name, kind, percent, seller_id, category_id, product_id,
        payment_method, min_amount, skip_promo, only_promo, priority, is_active,
        tiers, tier_basis
      ) values (
        ${tenant.companyId}, ${n.name}, ${n.kind}, ${n.percent}, ${n.sellerId ?? null},
        ${n.categoryId ?? null}, ${n.productId ?? null}, ${n.paymentMethod ?? null},
        ${n.minAmount ?? 0}, ${skipPromo}, ${onlyPromo}, ${n.priority ?? 0}, ${n.isActive ?? true},
        ${tiersJson}::jsonb, ${n.tierBasis}
      ) returning id
    `;
    return { id: row!.id };
  });

export const deleteCommissionRuleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.write");
    const [used] = await sql<{ n: string | number }>`
      select count(*) as n from commissions where rule_id = ${data.id} and company_id = ${tenant.companyId}
    `;
    if (num(used?.n) > 0) {
      await sql`
        update commission_rules set is_active = false, updated_at = now()
         where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { ok: true, deactivated: true };
    }
    await sql`
      delete from commission_rules where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    return { ok: true, deactivated: false };
  });

const DEFAULT_FAIXA: CommissionTier[] = [
  { min: 0, percent: 5 },
  { min: 8000, percent: 7 },
  { min: 18000, percent: 9 },
];

export const suggestCommissionRulesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.write");
    const existing = await sql<{ n: string | number }>`
      select count(*) as n from commission_rules where company_id = ${tenant.companyId}
    `;
    if (num(existing[0]?.n) > 0) {
      throw new Error("Já existem regras nesta empresa. Apague-as para aplicar o pacote sugerido.");
    }
    const cats = await sql<{ id: number; name: string }>`
      select id, name from categories where company_id = ${tenant.companyId}
    `;
    const byName = new Map(cats.map((c) => [c.name, c.id]));
    const pack: {
      name: string;
      kind: string;
      percent: number;
      categoryId: number | null;
      payment: string | null;
      onlyPromo: boolean;
      tiers: CommissionTier[];
      tierBasis: string;
    }[] = [
      { name: "Vestuário 6%", kind: "percent_sales", percent: 6, categoryId: byName.get("Vestuário") ?? null, payment: null, onlyPromo: false, tiers: [], tierBasis: "none" },
      { name: "Camisetas 7%", kind: "percent_sales", percent: 7, categoryId: byName.get("Camisetas") ?? null, payment: null, onlyPromo: false, tiers: [], tierBasis: "none" },
      { name: "Eletrônicos 3%", kind: "percent_sales", percent: 3, categoryId: byName.get("Eletrônicos") ?? null, payment: null, onlyPromo: false, tiers: [], tierBasis: "none" },
      { name: "Crédito 2,5%", kind: "percent_sales", percent: 2.5, categoryId: null, payment: "credito", onlyPromo: false, tiers: [], tierBasis: "none" },
      { name: "Sem comissão em promoção", kind: "exclude", percent: 0, categoryId: null, payment: null, onlyPromo: true, tiers: [], tierBasis: "none" },
      { name: "R$ 1,50 por acessório", kind: "fixed_unit", percent: 1.5, categoryId: byName.get("Acessórios") ?? null, payment: null, onlyPromo: false, tiers: [], tierBasis: "none" },
      { name: "Faixa mensal 5 / 7 / 9%", kind: "percent_sales", percent: 5, categoryId: null, payment: null, onlyPromo: false, tiers: DEFAULT_FAIXA, tierBasis: "month" },
    ];
    let inserted = 0;
    for (const p of pack) {
      if (p.categoryId == null && p.payment == null && p.kind !== "exclude" && p.tierBasis === "none") continue;
      if (p.kind === "fixed_unit" && p.categoryId == null) continue;
      await sql`
        insert into commission_rules (
          company_id, name, kind, percent, category_id, payment_method, only_promo, is_active,
          tiers, tier_basis
        ) values (
          ${tenant.companyId}, ${p.name}, ${p.kind}, ${p.percent}, ${p.categoryId},
          ${p.payment}, ${p.onlyPromo}, true, ${JSON.stringify(p.tiers)}::jsonb, ${p.tierBasis}
        )
      `;
      inserted += 1;
    }
    return { inserted };
  });

export const simulateCommissionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      sellerId: number;
      paymentMethod?: string | null;
      headerDiscount?: number;
      monthRevenue?: number;
      storeId?: number | null;
      items: { productId: number; quantity: number; unitPrice?: number; discount?: number }[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    /*
      Esta funcao entrega o percentual de comissao e o faturamento do mes de
      QUALQUER vendedor que o id apontar -- remuneracao de gente. Nao tinha
      gate nenhum, enquanto listSellersFn exige sellers.read pra mostrar os
      mesmos dados na tela: estoque e financeiro podiam enumerar o ganho de
      todo mundo chamando o servidor direto.

      Nao da pra exigir sellers.read e pronto: o papel "Operador de PDV" nao
      tem essa permissao (de proposito -- ela abre a pagina Vendedores
      inteira, com salario e documento), e o PDV precisa disto pra mostrar a
      comissao da venda que esta sendo feita. Entao vale quem VENDE ou quem
      ja pode ver a equipe de vendas. Fica de fora exatamente quem nao tem
      nada a ver com isso: estoque e financeiro.
    */
    if (!can(tenant.role, "pdv.sell") && !can(tenant.role, "sellers.read")) {
      throw new Error("Sem permissão para esta ação.");
    }
    const [seller] = await sql<{ id: number; name: string; commission_pct: string | number }>`
      select id, name, commission_pct from sellers
       where id = ${data.sellerId} and company_id = ${tenant.companyId} and deleted_at is null
    `;
    if (!seller) throw new Error("Vendedor não encontrado.");
    const monthRevenue =
      data.monthRevenue != null
        ? Math.max(0, data.monthRevenue)
        : await sellerMonthRevenue(sql, tenant.companyId, seller.id);
    const targets = await loadSellerTargetBonuses(sql, tenant.companyId, seller.id, {
      storeId: data.storeId ?? null,
    });
    const attachTax = async (gross: number) =>
      taxForSeller(sql, tenant.companyId, seller.id, gross);
    if (!data.items.length) {
      const result = computeCommission({
        sellerId: seller.id,
        sellerPercent: num(seller.commission_pct),
        sellerName: seller.name,
        paymentMethod: data.paymentMethod ?? null,
        headerDiscount: data.headerDiscount ?? 0,
        monthRevenue,
        rules: [],
        items: [],
        targets,
      });
      return { ...result, tax: await attachTax(result.amount) };
    }
    const ids = [...new Set(data.items.map((i) => i.productId))];
    const catalog = await sql.query<Row>(
      `select p.id, p.name, p.price, p.cost, p.category_id, c.parent_id as parent_category_id
         from products p
         left join categories c on c.id = p.category_id
        where p.company_id = $1 and p.id in (${ids.map((_, i) => `$${i + 2}`).join(",")})`,
      [tenant.companyId, ...ids],
    );
    const byId = new Map(catalog.map((r) => [num(r.id), r]));
    const items = data.items.map((item) => {
      const p = byId.get(item.productId);
      if (!p) throw new Error("Produto inválido na simulação.");
      const qty = Math.max(0, item.quantity);
      const unit = item.unitPrice != null ? item.unitPrice : num(p.price);
      const discount = Math.max(0, item.discount ?? 0);
      return {
        productId: item.productId,
        productName: String(p.name),
        categoryId: p.category_id == null ? null : num(p.category_id),
        parentCategoryId: p.parent_category_id == null ? null : num(p.parent_category_id),
        quantity: qty,
        total: Number((unit * qty - discount).toFixed(2)),
        costTotal: Number((num(p.cost) * qty).toFixed(2)),
        discount,
      };
    });
    const rules = await loadCommissionRules(sql, tenant.companyId);
    const result = computeCommission({
      sellerId: seller.id,
      sellerPercent: num(seller.commission_pct),
      sellerName: seller.name,
      paymentMethod: data.paymentMethod ?? null,
      headerDiscount: data.headerDiscount ?? 0,
      monthRevenue,
      rules,
      items,
      targets,
    });
    return { ...result, tax: await attachTax(result.amount) };
  });
