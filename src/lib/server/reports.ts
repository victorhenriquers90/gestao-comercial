import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  ACCOUNT_STATUS_LABELS,
  PAYMENT_LABELS,
  SALE_STATUS_LABELS,
  type PaymentMethod,
} from "@/lib/constants";
import { formatBRL, formatDoc, formatPct, formatQty } from "@/lib/format";
import { dump, type Row } from "@/lib/json";
import { num } from "@/lib/utils";
import { requireTenant } from "./context";
import { loadRetentionGuide } from "./retention";

export type ColKind = "money" | "qty" | "pct" | "text" | "date";

export type ReportKpi = { label: string; value: string; hint?: string };

export type ReportChart = {
  kind: "bar" | "line" | "area";
  data: { name: string; value: number }[];
};

export type ReportPack = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  kinds: ColKind[];
  kpis: ReportKpi[];
  chart: ReportChart | null;
};

function payLabel(method: string) {
  return PAYMENT_LABELS[method as PaymentMethod] ?? method;
}

function commStatus(s: string) {
  if (s === "pendente") return "Pendente";
  if (s === "pago") return "Pago";
  if (s === "cancelado") return "Cancelado";
  return s;
}

function sumCol(rows: (string | number)[][], i: number) {
  return rows.reduce((a, r) => a + num(r[i]), 0);
}

function autoKpis(columns: string[], rows: (string | number)[][], kinds: ColKind[]): ReportKpi[] {
  const kpis: ReportKpi[] = [{ label: "Registros", value: String(rows.length) }];
  kinds.forEach((kind, i) => {
    if (kind !== "money" && kind !== "qty") return;
    const s = sumCol(rows, i);
    kpis.push({
      label: columns[i] ?? "Total",
      value: kind === "money" ? formatBRL(s) : formatQty(s),
    });
  });
  return kpis;
}

function pack(opts: {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  kinds: ColKind[];
  kpis?: ReportKpi[];
  chart?: ReportChart | null;
}): ReportPack {
  return dump({
    title: opts.title,
    columns: opts.columns,
    rows: opts.rows,
    kinds: opts.kinds,
    kpis: opts.kpis ?? autoKpis(opts.columns, opts.rows, opts.kinds),
    chart: opts.chart ?? null,
  });
}

function empty(title: string, columns: string[], kinds: ColKind[]) {
  return pack({ title, columns, rows: [], kinds, kpis: [{ label: "Registros", value: "0" }] });
}

function prevWindow(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  const prevTo = new Date(a.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { from: ymd(prevFrom), to: ymd(prevTo), days };
}

export const reportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      type: string;
      from: string;
      to: string;
      storeId?: number | null;
      sellerId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const cid = tenant.companyId;
    const storeId = data.storeId ?? null;
    const sellerId = data.sellerId ?? null;
    const params = [cid, data.from, data.to, storeId, sellerId];
    const type = data.type;

    if (type === "resumo") {
      const kpiSql = `select coalesce(sum(total),0) as revenue, count(*)::int as sales,
                             coalesce(avg(total),0) as ticket, coalesce(sum(total - cost_total),0) as profit,
                             coalesce(sum(discount),0) as disc, coalesce(sum(cost_total),0) as cost
                        from sales
                       where company_id = $1 and deleted_at is null and status = 'finalizada'
                         and sold_at >= $2::date and sold_at < ($3::date + interval '1 day')
                         and ($4::int is null or store_id = $4)
                         and ($5::int is null or seller_id = $5)`;
      const [cur] = await sql.query<{
        revenue: string | number;
        sales: number;
        ticket: string | number;
        profit: string | number;
        disc: string | number;
        cost: string | number;
      }>(kpiSql, params);
      const prev = prevWindow(data.from, data.to);
      const [old] = await sql.query<{ revenue: string | number; profit: string | number }>(kpiSql, [
        cid,
        prev.from,
        prev.to,
        storeId,
        sellerId,
      ]);
      const revenue = num(cur?.revenue);
      const profit = num(cur?.profit);
      const prevRev = num(old?.revenue);
      const trend = prevRev ? ((revenue - prevRev) / prevRev) * 100 : revenue ? 100 : 0;
      const series = await sql.query<{ d: string; total: string | number; n: number }>(
        `select to_char(sold_at::date, 'DD/MM') as d, coalesce(sum(total),0) as total, count(*)::int as n
           from sales
          where company_id = $1 and deleted_at is null and status = 'finalizada'
            and sold_at >= $2::date and sold_at < ($3::date + interval '1 day')
            and ($4::int is null or store_id = $4)
            and ($5::int is null or seller_id = $5)
          group by 1, sold_at::date order by sold_at::date`,
        params,
      );
      const [rec] = await sql.query<{ v: string | number }>(
        `select coalesce(sum(amount - received_amount),0) as v from accounts_receivable
          where company_id = $1 and deleted_at is null and status in ('pendente','parcial','vencido')`,
        [cid],
      );
      const [pay] = await sql.query<{ v: string | number }>(
        `select coalesce(sum(amount - paid_amount),0) as v from accounts_payable
          where company_id = $1 and deleted_at is null and status in ('pendente','parcial','vencido')`,
        [cid],
      );
      const rows = series.map((s) => [s.d, num(s.n), num(s.total)]);
      return pack({
        title: "Resumo executivo",
        columns: ["Dia", "Vendas", "Faturamento"],
        rows,
        kinds: ["text", "qty", "money"],
        kpis: [
          {
            label: "Faturamento",
            value: formatBRL(revenue),
            hint: `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}% vs período anterior`,
          },
          { label: "Vendas", value: formatQty(num(cur?.sales)) },
          { label: "Ticket médio", value: formatBRL(num(cur?.ticket)) },
          {
            label: "Lucro bruto",
            value: formatBRL(profit),
            hint: revenue ? formatPct((profit / revenue) * 100) + " de margem" : undefined,
          },
          { label: "A receber", value: formatBRL(num(rec?.v)) },
          { label: "A pagar", value: formatBRL(num(pay?.v)) },
        ],
        chart: { kind: "area", data: series.map((s) => ({ name: s.d, value: num(s.total) })) },
      });
    }

    if (type === "vendas" || type === "periodo") {
      const rows = (
        await sql.query<Row>(
          `select s.number, s.sold_at, c.name as customer, sl.name as seller, s.total, s.status
             from sales s
             left join customers c on c.id = s.customer_id
             left join sellers sl on sl.id = s.seller_id
            where s.company_id = $1 and s.deleted_at is null
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            order by s.sold_at desc`,
          params,
        )
      ).map((r) => [
        String(r.number),
        String(r.sold_at),
        String(r.customer ?? "—"),
        String(r.seller ?? "—"),
        num(r.total),
        SALE_STATUS_LABELS[String(r.status)] ?? String(r.status),
      ]);
      return pack({
        title: "Vendas detalhadas",
        columns: ["Número", "Data", "Cliente", "Vendedor", "Total", "Status"],
        rows,
        kinds: ["text", "date", "text", "text", "money", "text"],
      });
    }

    if (type === "vendedor") {
      const rows = (
        await sql.query<Row>(
          `select coalesce(sl.name,'Sem vendedor') as name, count(*)::int as n, sum(s.total) as total, avg(s.total) as ticket,
                  coalesce((select sum(c.amount) from commissions c where c.seller_id = s.seller_id
                            and c.created_at >= $2::date and c.created_at < ($3::date + interval '1 day')),0) as comm
             from sales s left join sellers sl on sl.id = s.seller_id
            where s.company_id = $1 and s.status = 'finalizada'
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            group by s.seller_id, sl.name
            order by total desc`,
          params,
        )
      ).map((r) => [String(r.name), num(r.n), num(r.total), num(r.ticket), num(r.comm)]);
      return pack({
        title: "Performance de vendedores",
        columns: ["Vendedor", "Vendas", "Faturamento", "Ticket", "Comissão"],
        rows,
        kinds: ["text", "qty", "money", "money", "money"],
        chart: { kind: "bar", data: rows.map((r) => ({ name: String(r[0]), value: num(r[2]) })) },
      });
    }

    if (type === "produto" || type === "mais" || type === "menos") {
      const dir = type === "menos" ? "asc" : "desc";
      const title = type === "menos" ? "Menos vendidos" : type === "mais" ? "Mais vendidos" : "Mix de produtos";
      const rows = (
        await sql.query<Row>(
          `select si.description, sum(si.quantity) as qty, sum(si.total) as total,
                  sum(si.cost * si.quantity) as cost, sum(si.total - si.cost * si.quantity) as profit
             from sale_items si join sales s on s.id = si.sale_id
            where s.company_id = $1 and s.status = 'finalizada'
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            group by si.description
            order by total ${dir}
            limit 80`,
          params,
        )
      ).map((r) => [String(r.description), num(r.qty), num(r.total), num(r.cost), num(r.profit)]);
      return pack({
        title,
        columns: ["Produto", "Qtd", "Faturamento", "Custo", "Lucro"],
        rows,
        kinds: ["text", "qty", "money", "money", "money"],
        chart: { kind: "bar", data: rows.slice(0, 8).map((r) => ({ name: String(r[0]).slice(0, 18), value: num(r[2]) })) },
      });
    }

    if (type === "abc") {
      const raw = (
        await sql.query<Row>(
          `select si.description, sum(si.total) as total, sum(si.quantity) as qty
             from sale_items si join sales s on s.id = si.sale_id
            where s.company_id = $1 and s.status = 'finalizada'
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            group by si.description
            order by total desc`,
          params,
        )
      ).map((r) => ({ name: String(r.description), total: num(r.total), qty: num(r.qty) }));
      const grand = raw.reduce((a, r) => a + r.total, 0);
      let acc = 0;
      const rows = raw.map((r) => {
        acc += r.total;
        const share = grand ? (r.total / grand) * 100 : 0;
        const cum = grand ? (acc / grand) * 100 : 0;
        const klass = cum <= 80 ? "A" : cum <= 95 ? "B" : "C";
        return [r.name, r.qty, r.total, share, cum, klass] as (string | number)[];
      });
      const count = (k: string) => rows.filter((r) => r[5] === k).length;
      return pack({
        title: "Curva ABC de produtos",
        columns: ["Produto", "Qtd", "Faturamento", "%", "% acum.", "Classe"],
        rows,
        kinds: ["text", "qty", "money", "pct", "pct", "text"],
        kpis: [
          { label: "Classe A", value: String(count("A")), hint: "até 80% da receita" },
          { label: "Classe B", value: String(count("B")), hint: "80–95%" },
          { label: "Classe C", value: String(count("C")), hint: "cauda" },
          { label: "Faturamento", value: formatBRL(grand) },
        ],
        chart: {
          kind: "bar",
          data: [
            { name: "A", value: rows.filter((r) => r[5] === "A").reduce((a, r) => a + num(r[2]), 0) },
            { name: "B", value: rows.filter((r) => r[5] === "B").reduce((a, r) => a + num(r[2]), 0) },
            { name: "C", value: rows.filter((r) => r[5] === "C").reduce((a, r) => a + num(r[2]), 0) },
          ],
        },
      });
    }

    if (type === "categoria") {
      const rows = (
        await sql.query<Row>(
          `select coalesce(c.name,'Sem categoria') as name, sum(si.quantity) as qty, sum(si.total) as total
             from sale_items si
             join sales s on s.id = si.sale_id
             join products p on p.id = si.product_id
             left join categories c on c.id = p.category_id
            where s.company_id = $1 and s.status = 'finalizada'
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            group by 1 order by total desc`,
          params,
        )
      ).map((r) => [String(r.name), num(r.qty), num(r.total)]);
      return pack({
        title: "Vendas por categoria",
        columns: ["Categoria", "Qtd", "Faturamento"],
        rows,
        kinds: ["text", "qty", "money"],
        chart: { kind: "bar", data: rows.map((r) => ({ name: String(r[0]), value: num(r[2]) })) },
      });
    }

    if (type === "cliente") {
      const rows = (
        await sql.query<Row>(
          `select coalesce(c.name,'Consumidor') as name, count(*)::int as n, sum(s.total) as total, avg(s.total) as ticket
             from sales s left join customers c on c.id = s.customer_id
            where s.company_id = $1 and s.status = 'finalizada'
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            group by 1 order by total desc limit 80`,
          params,
        )
      ).map((r) => [String(r.name), num(r.n), num(r.total), num(r.ticket)]);
      return pack({
        title: "Ranking de clientes",
        columns: ["Cliente", "Compras", "Total", "Ticket"],
        rows,
        kinds: ["text", "qty", "money", "money"],
        chart: { kind: "bar", data: rows.slice(0, 8).map((r) => ({ name: String(r[0]).slice(0, 16), value: num(r[2]) })) },
      });
    }

    if (type === "lucro" || type === "margem") {
      const rows = (
        await sql.query<Row>(
          `select to_char(sold_at::date,'YYYY-MM-DD') as d, sum(total) as total, sum(cost_total) as cost,
                  sum(total - cost_total) as profit
             from sales
            where company_id = $1 and status = 'finalizada'
              and sold_at >= $2::date and sold_at < ($3::date + interval '1 day')
              and ($4::int is null or store_id = $4)
              and ($5::int is null or seller_id = $5)
            group by 1 order by 1`,
          params,
        )
      ).map((r) => {
        const total = num(r.total);
        const cost = num(r.cost);
        const profit = num(r.profit);
        return [String(r.d), total, cost, profit, total ? (profit / total) * 100 : 0];
      });
      const rev = sumCol(rows, 1);
      const prof = sumCol(rows, 3);
      return pack({
        title: "Lucro e margem",
        columns: ["Período", "Faturamento", "CMV", "Lucro", "Margem %"],
        rows,
        kinds: ["date", "money", "money", "money", "pct"],
        kpis: [
          { label: "Faturamento", value: formatBRL(rev) },
          { label: "CMV", value: formatBRL(sumCol(rows, 2)) },
          { label: "Lucro bruto", value: formatBRL(prof) },
          { label: "Margem", value: rev ? formatPct((prof / rev) * 100) : "0%" },
        ],
        chart: {
          kind: "line",
          data: rows.map((r) => ({ name: String(r[0]).slice(5), value: num(r[3]) })),
        },
      });
    }

    if (type === "dre") {
      const [s] = await sql.query<{
        revenue: string | number;
        disc: string | number;
        cost: string | number;
        subtotal: string | number;
      }>(
        `select coalesce(sum(total),0) as revenue, coalesce(sum(discount),0) as disc,
                coalesce(sum(cost_total),0) as cost, coalesce(sum(subtotal),0) as subtotal
           from sales
          where company_id = $1 and status = 'finalizada' and deleted_at is null
            and sold_at >= $2::date and sold_at < ($3::date + interval '1 day')
            and ($4::int is null or store_id = $4)
            and ($5::int is null or seller_id = $5)`,
        params,
      );
      const [ex] = await sql.query<{ v: string | number }>(
        `select coalesce(sum(amount),0) as v from expenses
          where company_id = $1 and deleted_at is null
            and spent_at >= $2::date and spent_at <= $3::date
            and ($4::int is null or store_id = $4)`,
        params.slice(0, 4),
      );
      const net = num(s?.revenue);
      const disc = num(s?.disc);
      const subtotal = num(s?.subtotal);
      const cost = num(s?.cost);
      const gross = net - cost;
      const expenses = num(ex?.v);
      const result = gross - expenses;
      const rows: (string | number)[][] = [
        ["Receita de vendas", subtotal],
        ["Descontos concedidos", disc],
        ["Receita líquida", net],
        ["CMV (custo das mercadorias)", cost],
        ["Lucro bruto", gross],
        ["Despesas operacionais", expenses],
        ["Resultado do período", result],
      ];
      return pack({
        title: "DRE simplificado",
        columns: ["Conta", "Valor"],
        rows,
        kinds: ["text", "money"],
        kpis: [
          { label: "Receita líquida", value: formatBRL(net) },
          {
            label: "Lucro bruto",
            value: formatBRL(gross),
            hint: net ? formatPct((gross / net) * 100) : undefined,
          },
          { label: "Despesas", value: formatBRL(expenses) },
          { label: "Resultado", value: formatBRL(result) },
        ],
        chart: {
          kind: "bar",
          data: [
            { name: "Receita", value: net },
            { name: "CMV", value: cost },
            { name: "Despesas", value: expenses },
            { name: "Resultado", value: result },
          ],
        },
      });
    }

    if (type === "pagamento") {
      const rows = (
        await sql.query<Row>(
          `select p.method, count(*)::int as n, sum(p.amount) as total
             from payments p join sales s on s.id = p.sale_id
            where s.company_id = $1 and s.status = 'finalizada'
              and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
              and ($4::int is null or s.store_id = $4)
              and ($5::int is null or s.seller_id = $5)
            group by p.method order by total desc`,
          params,
        )
      ).map((r) => [payLabel(String(r.method)), num(r.n), num(r.total)]);
      return pack({
        title: "Mix de pagamentos",
        columns: ["Forma", "Operações", "Valor"],
        rows,
        kinds: ["text", "qty", "money"],
        chart: { kind: "bar", data: rows.map((r) => ({ name: String(r[0]), value: num(r[2]) })) },
      });
    }

    if (type === "estoque" || type === "minimo") {
      const rows = (
        await sql.query<Row>(
          `select p.name, v.color, v.size, i.quantity, p.min_stock, st.name as store,
                  coalesce(v.cost, p.cost) as cost
             from inventories i
             join product_variants v on v.id = i.variant_id
             join products p on p.id = v.product_id
             join stores st on st.id = i.store_id
            where i.company_id = $1 and p.deleted_at is null
              and ($2::text <> 'minimo' or i.quantity <= greatest(i.min_stock, p.min_stock))
              and ($3::int is null or i.store_id = $3)
            order by p.name`,
          [cid, type, storeId],
        )
      ).map((r) => [
        String(r.name),
        String(r.color ?? "—"),
        String(r.size ?? "—"),
        num(r.quantity),
        num(r.min_stock),
        num(r.cost) * num(r.quantity),
        String(r.store),
      ]);
      return pack({
        title: type === "minimo" ? "Estoque abaixo do mínimo" : "Posição de estoque",
        columns: ["Produto", "Cor", "Tam.", "Qtd", "Mínimo", "Valor", "Loja"],
        rows,
        kinds: ["text", "text", "text", "qty", "qty", "money", "text"],
      });
    }

    if (type === "giro") {
      const days = prevWindow(data.from, data.to).days;
      const soldSql = `coalesce((select sum(si.quantity) from sale_items si
                            join sales s on s.id = si.sale_id
                           where si.variant_id = v.id and s.status = 'finalizada'
                             and s.company_id = $1
                             and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
                             and ($4::int is null or s.store_id = $4)),0)`;
      const rows = (
        await sql.query<Row>(
          `select p.name,
                  coalesce(sum(i.quantity),0) as stock,
                  ${soldSql} as sold
             from product_variants v
             join products p on p.id = v.product_id
             left join inventories i on i.variant_id = v.id and ($4::int is null or i.store_id = $4)
            where v.company_id = $1 and p.deleted_at is null and v.deleted_at is null
            group by v.id, p.name
            having ${soldSql} > 0
            order by sold desc
            limit 80`,
          params.slice(0, 4),
        )
      ).map((r) => {
        const stock = num(r.stock);
        const sold = num(r.sold);
        const giro = stock > 0 ? sold / stock : sold > 0 ? sold : 0;
        const cover = giro > 0 ? days / giro : 0;
        return [String(r.name), stock, sold, giro, cover];
      });
      return pack({
        title: "Giro de estoque",
        columns: ["Produto", "Estoque", "Vendidos", "Giro", "Dias de cobertura"],
        rows,
        kinds: ["text", "qty", "qty", "qty", "qty"],
        kpis: [
          { label: "Itens com venda", value: String(rows.length) },
          { label: "Dias do período", value: String(days) },
        ],
      });
    }

    if (type === "pagar" || type === "receber") {
      const table = type === "pagar" ? "accounts_payable" : "accounts_receivable";
      const openExpr = type === "pagar" ? "amount - paid_amount" : "amount - received_amount";
      const rows = (
        await sql.query<Row>(
          `select description, due_date, amount, ${openExpr} as open_amt, status from ${table}
            where company_id = $1 and deleted_at is null
              and due_date >= $2::date and due_date <= $3::date
            order by due_date`,
          [cid, data.from, data.to],
        )
      ).map((r) => [
        String(r.description),
        String(r.due_date),
        num(r.amount),
        num(r.open_amt),
        ACCOUNT_STATUS_LABELS[String(r.status)] ?? String(r.status),
      ]);
      return pack({
        title: type === "pagar" ? "Contas a pagar" : "Contas a receber",
        columns: ["Descrição", "Vencimento", "Valor", "Em aberto", "Status"],
        rows,
        kinds: ["text", "date", "money", "money", "text"],
      });
    }

    if (type === "aging") {
      const rec = await sql.query<Row>(
        `select description, due_date, amount - received_amount as open_amt
           from accounts_receivable
          where company_id = $1 and deleted_at is null and status in ('pendente','parcial','vencido')
            and amount - received_amount > 0.009`,
        [cid],
      );
      const pay = await sql.query<Row>(
        `select description, due_date, amount - paid_amount as open_amt
           from accounts_payable
          where company_id = $1 and deleted_at is null and status in ('pendente','parcial','vencido')
            and amount - paid_amount > 0.009`,
        [cid],
      );
      const bucket = (due: string) => {
        const d = new Date(`${String(due).slice(0, 10)}T12:00:00`);
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
        if (diff <= 0) return "A vencer";
        if (diff <= 30) return "1–30 dias";
        if (diff <= 60) return "31–60 dias";
        if (diff <= 90) return "61–90 dias";
        return "90+ dias";
      };
      const rows = [
        ...rec.map((r) => ["Receber", String(r.description), String(r.due_date), num(r.open_amt), bucket(String(r.due_date))]),
        ...pay.map((r) => ["Pagar", String(r.description), String(r.due_date), num(r.open_amt), bucket(String(r.due_date))]),
      ];
      const order = ["A vencer", "1–30 dias", "31–60 dias", "61–90 dias", "90+ dias"];
      const chartData = order.map((name) => ({
        name,
        value: rows.filter((r) => r[4] === name).reduce((a, r) => a + num(r[3]), 0),
      }));
      return pack({
        title: "Aging de títulos",
        columns: ["Tipo", "Descrição", "Vencimento", "Saldo", "Faixa"],
        rows,
        kinds: ["text", "text", "date", "money", "text"],
        kpis: [
          { label: "A receber", value: formatBRL(rec.reduce((a, r) => a + num(r.open_amt), 0)) },
          { label: "A pagar", value: formatBRL(pay.reduce((a, r) => a + num(r.open_amt), 0)) },
          {
            label: "Vencidos 90+",
            value: formatBRL(rows.filter((r) => r[4] === "90+ dias").reduce((a, r) => a + num(r[3]), 0)),
          },
        ],
        chart: { kind: "bar", data: chartData },
      });
    }

    if (type === "comissao") {
      const rows = (
        await sql.query<Row>(
          `select sl.name, s.number, coalesce(c.note, cr.name, 'Padrão') as rule_name,
                  c.percent, c.amount, coalesce(c.net_amount, c.amount) as net_amount,
                  coalesce(c.tax_inss,0)+coalesce(c.tax_irrf,0)+coalesce(c.tax_iss,0)+coalesce(c.tax_other,0) as tax_total,
                  c.status
             from commissions c
             join sellers sl on sl.id = c.seller_id
             left join sales s on s.id = c.sale_id
             left join commission_rules cr on cr.id = c.rule_id
            where c.company_id = $1
              and c.created_at >= $2::date and c.created_at < ($3::date + interval '1 day')
              and ($4::int is null or sl.id = $4)
            order by c.created_at desc`,
          [cid, data.from, data.to, sellerId],
        )
      ).map((r) => [
        String(r.name),
        r.number != null ? String(r.number) : "—",
        String(r.rule_name ?? "Padrão"),
        num(r.percent),
        num(r.amount),
        num(r.tax_total),
        num(r.net_amount),
        commStatus(String(r.status)),
      ]);
      const pending = rows.filter((r) => r[7] === "Pendente").reduce((a, r) => a + num(r[6]), 0);
      const paid = rows.filter((r) => r[7] === "Pago").reduce((a, r) => a + num(r[6]), 0);
      const bySeller = new Map<string, number>();
      for (const r of rows) {
        const name = String(r[0]);
        bySeller.set(name, (bySeller.get(name) ?? 0) + num(r[6]));
      }
      return pack({
        title: "Comissões",
        columns: ["Vendedor", "Venda", "Regra", "Percentual", "Bruto", "Impostos", "Líquido", "Status"],
        rows,
        kinds: ["text", "text", "text", "pct", "money", "money", "money", "text"],
        kpis: [
          { label: "Bruto", value: formatBRL(sumCol(rows, 4)) },
          { label: "Líquido", value: formatBRL(sumCol(rows, 6)) },
          { label: "Pendente (líq.)", value: formatBRL(pending) },
          { label: "Pago (líq.)", value: formatBRL(paid) },
        ],
        chart: {
          kind: "bar",
          data: [...bySeller.entries()].map(([name, value]) => ({ name, value })),
        },
      });
    }

    if (type === "retencoes") {
      const guide = await loadRetentionGuide(sql, cid, data.from, data.to, sellerId);
      const rows = guide.rows.map((r) => [
        r.sellerName,
        r.regimeLabel,
        r.document ? formatDoc(r.document) : "—",
        r.gross,
        r.inss,
        r.irrf,
        r.iss,
        r.other,
        r.net,
        r.employerInss,
        r.employerFgts,
      ]);
      return pack({
        title: "Retenções de comissão",
        columns: [
          "Vendedor",
          "Regime",
          "CPF/CNPJ",
          "Bruto",
          "INSS",
          "IRRF",
          "ISS",
          "Outros",
          "Líquido",
          "INSS patronal",
          "FGTS",
        ],
        rows,
        kinds: ["text", "text", "text", "money", "money", "money", "money", "money", "money", "money", "money"],
        kpis: [
          { label: "Folha líquida", value: formatBRL(guide.totals.net) },
          { label: "Retido na fonte", value: formatBRL(guide.totals.withheld) },
          { label: "GPS (INSS)", value: formatBRL(guide.totals.gps) },
          { label: "Custo da loja", value: formatBRL(guide.totals.cost) },
        ],
        chart: {
          kind: "bar",
          data: [
            { name: "INSS", value: guide.totals.inss },
            { name: "IRRF", value: guide.totals.irrf },
            { name: "ISS", value: guide.totals.iss },
            { name: "Outros", value: guide.totals.other },
            { name: "Patronal", value: guide.totals.employerInss },
            { name: "FGTS", value: guide.totals.employerFgts },
          ].filter((d) => d.value > 0.009),
        },
      });
    }

    return empty("Relatório", ["Info"], ["text"]);
  });
