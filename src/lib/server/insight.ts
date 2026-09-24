import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { resolvePeriod, type PeriodKey } from "@/lib/period";
import { num } from "@/lib/utils";
import { requireTenant } from "./context";
import { ymdLocal } from "@/lib/local-date";

function andEq(
  params: unknown[],
  column: string,
  value: number | null | undefined,
) {
  if (value == null) return "";
  params.push(value);
  return ` and ${column} = $${params.length}`;
}

/**
 * Liquido de devolucao, por venda (`s` precisa ser o alias da tabela `sales`).
 *
 * `sales.total`/`sales.cost_total` NUNCA sao reduzidos numa devolucao
 * parcial -- o valor fiscal original tem que ficar intacto (e' por isso que
 * o comprovante e a NFC-e ja emitida continuam mostrando o total cheio).
 * Sem este join, todo KPI que soma `total` filtrando so `status =
 * 'finalizada'` fazia a venda com devolucao parcial SUMIR INTEIRA da conta
 * -- uma devolucao de uma peca de R$10 numa venda de R$500 tirava os R$500
 * inteiros do faturamento, nao so os R$10. A correcao e' na LEITURA: soma o
 * que foi devolvido e desconta na hora de agregar, incluindo
 * `devolvida_parcial` no filtro de status.
 */
const RETURN_BY_SALE = `
  left join lateral (
    select coalesce(sum(ri.amount), 0) as returned_revenue,
           coalesce(sum(ri.quantity * si.cost), 0) as returned_cost
      from return_items ri
      join sale_items si on si.id = ri.sale_item_id
     where si.sale_id = s.id
  ) ret on true`;

export const dashboardFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      period: PeriodKey;
      from?: string;
      to?: string;
      storeId?: number | null;
      sellerId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "dashboard.read");
    const range = resolvePeriod(data.period, data.from, data.to);
    const storeId = data.storeId ?? null;
    const sellerId = data.sellerId ?? null;

    const kpiParams: unknown[] = [tenant.companyId, range.from, range.to];
    const kpiScope = `${andEq(kpiParams, "s.store_id", storeId)}${andEq(kpiParams, "s.seller_id", sellerId)}`;
    const kpiSql = `
      select coalesce(sum(s.total - coalesce(ret.returned_revenue,0)),0) as revenue,
             count(*)::int as sales,
             coalesce(avg(s.total - coalesce(ret.returned_revenue,0)),0) as ticket,
             coalesce(sum((s.total - coalesce(ret.returned_revenue,0)) - (s.cost_total - coalesce(ret.returned_cost,0))),0) as profit
        from sales s
        ${RETURN_BY_SALE}
       where s.company_id = $1 and s.deleted_at is null and s.status in ('finalizada','devolvida_parcial')
         and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
         ${kpiScope}`;

    const today = ymdLocal();
    const monthStart = `${today.slice(0, 7)}-01`;

    const todayParams: unknown[] = [tenant.companyId];
    const todayScope = andEq(todayParams, "s.store_id", storeId);
    const monthParams: unknown[] = [tenant.companyId, monthStart];
    const monthScope = andEq(monthParams, "s.store_id", storeId);
    const seriesParams: unknown[] = [tenant.companyId, range.from, range.to];
    const seriesScope = `${andEq(seriesParams, "s.store_id", storeId)}${andEq(seriesParams, "s.seller_id", sellerId)}`;
    const monthlyParams: unknown[] = [tenant.companyId];
    const monthlyScope = andEq(monthlyParams, "s.store_id", storeId);
    const mixParams: unknown[] = [tenant.companyId, range.from, range.to];
    const mixScope = andEq(mixParams, "s.store_id", storeId);
    const sellerParams: unknown[] = [tenant.companyId, range.from, range.to];
    const sellerScope = andEq(sellerParams, "s.store_id", storeId);
    const lowParams: unknown[] = [tenant.companyId];
    const lowScope = andEq(lowParams, "i.store_id", storeId);
    const commParams: unknown[] = [tenant.companyId];
    const commScope = andEq(commParams, "seller_id", sellerId);

    const [
      [cur],
      [prev],
      [todayK],
      [monthK],
      [rec],
      [pay],
      series,
      monthly,
      topProducts,
      topSellers,
      lowStock,
      targets,
      [pending],
      [paidMonth],
    ] = await Promise.all([
      sql.query<{ revenue: string | number; sales: number; ticket: string | number; profit: string | number }>(kpiSql, kpiParams),
      sql.query<{ revenue: string | number; sales: number; ticket: string | number; profit: string | number }>(kpiSql, [
        tenant.companyId,
        range.prevFrom,
        range.prevTo,
        ...kpiParams.slice(3),
      ]),
      sql.query<{ revenue: string | number; sales: number }>(
        `select coalesce(sum(s.total - coalesce(ret.returned_revenue,0)),0) as revenue, count(*)::int as sales
           from sales s
           ${RETURN_BY_SALE}
          where s.company_id = $1 and s.deleted_at is null and s.status in ('finalizada','devolvida_parcial')
            and s.sold_at >= current_date and s.sold_at < current_date + interval '1 day'
            ${todayScope}`,
        todayParams,
      ),
      sql.query<{ revenue: string | number }>(
        `select coalesce(sum(s.total - coalesce(ret.returned_revenue,0)),0) as revenue
           from sales s
           ${RETURN_BY_SALE}
          where s.company_id = $1 and s.deleted_at is null and s.status in ('finalizada','devolvida_parcial')
            and s.sold_at >= $2::date
            ${monthScope}`,
        monthParams,
      ),
      sql.query<{ v: string | number }>(
        `select coalesce(sum(amount - received_amount),0) as v from accounts_receivable
          where company_id = $1 and deleted_at is null and status in ('pendente','parcial')`,
        [tenant.companyId],
      ),
      sql.query<{ v: string | number }>(
        `select coalesce(sum(amount - paid_amount),0) as v from accounts_payable
          where company_id = $1 and deleted_at is null and status in ('pendente','parcial')`,
        [tenant.companyId],
      ),
      sql.query<{ d: string; total: string | number; n: number }>(
        `select to_char(s.sold_at::date, 'YYYY-MM-DD') as d,
                coalesce(sum(s.total - coalesce(ret.returned_revenue,0)),0) as total, count(*)::int as n
           from sales s
           ${RETURN_BY_SALE}
          where s.company_id = $1 and s.deleted_at is null and s.status in ('finalizada','devolvida_parcial')
            and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
            ${seriesScope}
          group by 1 order by 1`,
        seriesParams,
      ),
      sql.query<{ m: string; total: string | number }>(
        `select to_char(date_trunc('month', s.sold_at), 'YYYY-MM') as m,
                coalesce(sum(s.total - coalesce(ret.returned_revenue,0)),0) as total
           from sales s
           ${RETURN_BY_SALE}
          where s.company_id = $1 and s.deleted_at is null and s.status in ('finalizada','devolvida_parcial')
            and s.sold_at >= (current_date - interval '11 months')
            ${monthlyScope}
          group by 1 order by 1`,
        monthlyParams,
      ),
      sql.query<{ name: string; qty: string | number; total: string | number }>(
        // Liquido por LINHA (nao por venda): o return_items de uma devolucao
        // aponta pro sale_item exato, entao da pra descontar so a peca
        // devolvida do produto certo, mais preciso que ratear por venda.
        `select si.description as name,
                sum(si.quantity - coalesce(ret.returned_qty,0)) as qty,
                sum(si.total - coalesce(ret.returned_amount,0)) as total
           from sale_items si
           join sales s on s.id = si.sale_id
           left join lateral (
             select coalesce(sum(ri.quantity),0) as returned_qty,
                    coalesce(sum(ri.amount),0) as returned_amount
               from return_items ri where ri.sale_item_id = si.id
           ) ret on true
          where s.company_id = $1 and s.status in ('finalizada','devolvida_parcial')
            and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
            ${mixScope}
          group by si.description
          order by total desc limit 6`,
        mixParams,
      ),
      sql.query<{ name: string; total: string | number; n: number }>(
        `select coalesce(sl.name, 'Sem vendedor') as name,
                sum(s.total - coalesce(ret.returned_revenue,0)) as total, count(*)::int as n
           from sales s
           left join sellers sl on sl.id = s.seller_id
           ${RETURN_BY_SALE}
          where s.company_id = $1 and s.status in ('finalizada','devolvida_parcial')
            and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
            ${sellerScope}
          group by 1
          order by total desc limit 6`,
        sellerParams,
      ),
      sql.query<{ name: string; quantity: string | number; min_stock: string | number; store: string }>(
        `select p.name || coalesce(' · ' || v.color, '') || coalesce(' ' || v.size, '') as name,
                i.quantity, greatest(i.min_stock, p.min_stock) as min_stock, st.name as store
           from inventories i
           join product_variants v on v.id = i.variant_id
           join products p on p.id = v.product_id
           join stores st on st.id = i.store_id
          where i.company_id = $1 and p.deleted_at is null
            and i.quantity <= greatest(i.min_stock, p.min_stock)
            and greatest(i.min_stock, p.min_stock) > 0
            ${lowScope}
          order by i.quantity asc
          limit 8`,
        lowParams,
      ),
      sql.query<{
        id: number;
        name: string;
        amount: string | number;
        period_start: string;
        period_end: string;
        store_id: number | null;
        seller_id: number | null;
        bonus_kind: string | null;
        bonus_value: string | number | null;
      }>(
        `select id, name, amount, period_start, period_end, store_id, seller_id, bonus_kind, bonus_value
           from targets
          where company_id = $1
            and period_start <= current_date and period_end >= current_date
          order by case when bonus_kind <> 'none' then 0 else 1 end, amount desc
          limit 6`,
        [tenant.companyId],
      ),
      sql.query<{ net: string | number; gross: string | number }>(
        `select coalesce(sum(coalesce(net_amount, amount)),0) as net,
                coalesce(sum(amount),0) as gross
           from commissions
          where company_id = $1 and status = 'pendente'
            ${commScope}`,
        commParams,
      ),
      sql.query<{
        net: string | number;
        withheld: string | number;
        employer: string | number;
      }>(
        `select coalesce(sum(coalesce(net_amount, amount)),0) as net,
                coalesce(sum(coalesce(tax_inss,0)+coalesce(tax_irrf,0)+coalesce(tax_iss,0)+coalesce(tax_other,0)),0) as withheld,
                coalesce(sum(
                  coalesce((tax_breakdown->>'employerInss')::numeric, 0)
                  + coalesce((tax_breakdown->>'employerFgts')::numeric, 0)
                ),0) as employer
           from commissions
          where company_id = $1 and status = 'pago'
            and (
              paid_at >= date_trunc('month', now())
              or (paid_at is null and created_at >= date_trunc('month', now()))
            )
            ${commScope}`,
        commParams,
      ),
    ]);

    const targetIds = targets.map((t) => num(t.id));
    const realized =
      targetIds.length === 0
        ? []
        : await sql.query<{ id: number; v: string | number }>(
            `select t.id, coalesce(sum(s.total - coalesce(ret.returned_revenue,0)),0) as v
               from targets t
               left join sales s
                 on s.company_id = t.company_id
                and s.status in ('finalizada','devolvida_parcial')
                and s.deleted_at is null
                and s.sold_at >= t.period_start
                and s.sold_at < (t.period_end + interval '1 day')
                and (t.store_id is null or s.store_id = t.store_id)
                and (t.seller_id is null or s.seller_id = t.seller_id)
               ${RETURN_BY_SALE}
              where t.company_id = $1 and t.id = any($2::int[])
              group by t.id`,
            [tenant.companyId, targetIds],
          );
    const realizedById = new Map(realized.map((r) => [num(r.id), num(r.v)]));
    const targetRows = targets.map((t) => {
      const amount = num(t.amount);
      const done = realizedById.get(num(t.id)) ?? 0;
      const hit = done + 0.009 >= amount;
      const remaining = Math.max(0, amount - done);
      const kind = String(t.bonus_kind ?? "none");
      const bonusValue = num(t.bonus_value);
      let bonusHint = "";
      if (kind === "extra_percent" && bonusValue > 0) {
        bonusHint = hit
          ? `+${bonusValue}% de bônus nas vendas`
          : `Faltam ${remaining.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para +${bonusValue}%`;
      } else if (kind === "extra_fixed" && bonusValue > 0) {
        const fixed = bonusValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        bonusHint = hit
          ? `Bônus de ${fixed} já cruzado`
          : `Faltam ${remaining.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para o bônus de ${fixed}`;
      }
      return {
        id: num(t.id),
        name: String(t.name ?? ""),
        amount,
        realized: done,
        progress: amount ? (done / amount) * 100 : 0,
        bonusHint,
      };
    });
    const monthNetPaid = num(paidMonth?.net);
    const monthWithheld = num(paidMonth?.withheld);
    const monthEmployer = num(paidMonth?.employer);

    const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : a ? 100 : 0);

    return {
      range,
      todayRevenue: num(todayK?.revenue),
      todaySales: num(todayK?.sales),
      monthRevenue: num(monthK?.revenue),
      revenue: num(cur?.revenue),
      salesCount: num(cur?.sales),
      ticket: num(cur?.ticket),
      profit: num(cur?.profit),
      receivables: num(rec?.v),
      payables: num(pay?.v),
      balance: num(rec?.v) - num(pay?.v),
      pendingCommissionNet: num(pending?.net),
      pendingCommissionGross: num(pending?.gross),
      monthCommissionNet: Number(monthNetPaid.toFixed(2)),
      monthTaxWithheld: Number(monthWithheld.toFixed(2)),
      monthEmployerCharges: Number(monthEmployer.toFixed(2)),
      trend: {
        revenue: pct(num(cur?.revenue), num(prev?.revenue)),
        sales: pct(num(cur?.sales), num(prev?.sales)),
        ticket: pct(num(cur?.ticket), num(prev?.ticket)),
        profit: pct(num(cur?.profit), num(prev?.profit)),
      },
      series: series.map((s) => ({ date: s.d, total: num(s.total), n: num(s.n) })),
      monthly: monthly.map((m) => ({ month: m.m, total: num(m.total) })),
      topProducts: topProducts.map((p) => ({ name: p.name, qty: num(p.qty), total: num(p.total) })),
      topSellers: topSellers.map((p) => ({ name: p.name, total: num(p.total), n: num(p.n) })),
      lowStock: lowStock.map((p) => ({
        name: p.name,
        quantity: num(p.quantity),
        minStock: num(p.min_stock),
        store: p.store,
      })),
      targets: targetRows,
    };
  });
