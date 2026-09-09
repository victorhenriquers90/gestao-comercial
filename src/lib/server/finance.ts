import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { isTargetBonusKind, type TargetBonusKind } from "@/lib/constants";
import type { Sql } from "@/lib/db";
import { dump, type Row } from "@/lib/json";
import { assertCan } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { allocateTax, money, type TaxResult } from "@/lib/tax";
import type { CommissionSlipData } from "@/components/commission-slip";
import { assertStore, audit, requireTenant, type Tenant } from "./context";
import { taxForSeller, taxInsert } from "./commission";

function accountStatus(row: { status: string; due_date: string; amount: unknown; paid?: unknown; received?: unknown }) {
  if (row.status === "pago" || row.status === "cancelado") return row.status;
  const open = num(row.amount) - num(row.paid ?? row.received);
  if (open <= 0.009) return "pago";
  if (row.due_date < new Date().toISOString().slice(0, 10) && row.status !== "pago") return "vencido";
  if (open < num(row.amount)) return "parcial";
  return row.status;
}

export const listPayablesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    const rows = await sql.query<Row>(
      `select ap.*, s.legal_name as supplier_name
         from accounts_payable ap
         left join suppliers s on s.id = ap.supplier_id
        where ap.company_id = $1 and ap.deleted_at is null
          and ($2::int is null or ap.store_id = $2)
        order by ap.due_date asc`,
      [tenant.companyId, data.storeId ?? null],
    );
    return rows
      .map((r) => ({
        ...r,
        amount: num(r.amount),
        paid_amount: num(r.paid_amount),
        status: accountStatus({
          status: String(r.status),
          due_date: String(r.due_date).slice(0, 10),
          amount: r.amount,
          paid: r.paid_amount,
        }),
      }))
      .filter((r) => !data.status || r.status === data.status);
  });

export const savePayableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      storeId?: number | null;
      supplierId?: number | null;
      description: string;
      category?: string;
      dueDate: string;
      amount: number;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    if (data.id) {
      await sql`
        update accounts_payable set description = ${data.description}, category = ${data.category ?? null},
          due_date = ${data.dueDate}, amount = ${data.amount}, supplier_id = ${data.supplierId ?? null},
          store_id = ${data.storeId ?? null}
        where id = ${data.id} and company_id = ${tenant.companyId} and status in ('pendente','parcial')
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into accounts_payable (
        company_id, store_id, supplier_id, description, category, due_date, amount, status, user_id
      ) values (
        ${tenant.companyId}, ${data.storeId ?? null}, ${data.supplierId ?? null}, ${data.description},
        ${data.category ?? null}, ${data.dueDate}, ${data.amount}, 'pendente', ${tenant.userId}
      ) returning id
    `;
    return { id: row!.id };
  });

export const settlePayableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; amount: number; interest?: number; discount?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const [row] = await sql<{ amount: string | number; paid_amount: string | number }>`
      select amount, paid_amount from accounts_payable where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    if (!row) throw new Error("Título não encontrado.");
    const paid = num(row.paid_amount) + data.amount;
    const target = num(row.amount) + num(data.interest) - num(data.discount);
    const status = paid + 0.05 >= target ? "pago" : "parcial";
    await sql`
      update accounts_payable set paid_amount = ${paid}, interest = ${data.interest ?? 0},
        discount = ${data.discount ?? 0}, status = ${status},
        paid_at = ${status === "pago" ? new Date().toISOString() : null}
      where id = ${data.id}
    `;
    await audit(sql, tenant, "pay", "accounts_payable", data.id, null, { amount: data.amount, status });
    return { status };
  });

export const listReceivablesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    const rows = await sql.query<Row>(
      `select ar.*, c.name as customer_name
         from accounts_receivable ar
         left join customers c on c.id = ar.customer_id
        where ar.company_id = $1 and ar.deleted_at is null
          and ($2::int is null or ar.store_id = $2)
        order by ar.due_date asc`,
      [tenant.companyId, data.storeId ?? null],
    );
    return rows
      .map((r) => ({
        ...r,
        amount: num(r.amount),
        received_amount: num(r.received_amount),
        status: accountStatus({
          status: String(r.status),
          due_date: String(r.due_date).slice(0, 10),
          amount: r.amount,
          received: r.received_amount,
        }),
      }))
      .filter((r) => !data.status || r.status === data.status);
  });

export const saveReceivableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      storeId?: number | null;
      customerId?: number | null;
      description: string;
      dueDate: string;
      amount: number;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    if (data.id) {
      await sql`
        update accounts_receivable set description = ${data.description}, due_date = ${data.dueDate},
          amount = ${data.amount}, customer_id = ${data.customerId ?? null}, store_id = ${data.storeId ?? null}
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into accounts_receivable (
        company_id, store_id, customer_id, description, due_date, amount, status, user_id
      ) values (
        ${tenant.companyId}, ${data.storeId ?? null}, ${data.customerId ?? null}, ${data.description},
        ${data.dueDate}, ${data.amount}, 'pendente', ${tenant.userId}
      ) returning id
    `;
    return { id: row!.id };
  });

export const settleReceivableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; amount: number; interest?: number; discount?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const [row] = await sql<{ amount: string | number; received_amount: string | number }>`
      select amount, received_amount from accounts_receivable where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    if (!row) throw new Error("Título não encontrado.");
    const rec = num(row.received_amount) + data.amount;
    const target = num(row.amount) + num(data.interest) - num(data.discount);
    const status = rec + 0.05 >= target ? "pago" : "parcial";
    await sql`
      update accounts_receivable set received_amount = ${rec}, interest = ${data.interest ?? 0},
        discount = ${data.discount ?? 0}, status = ${status},
        received_at = ${status === "pago" ? new Date().toISOString() : null}
      where id = ${data.id}
    `;
    return { status };
  });

export const cashflowFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { from: string; to: string; storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    const inflows = await sql.query<{ method: string; total: string | number }>(
      `select p.method, coalesce(sum(p.amount),0) as total
         from payments p
         join sales s on s.id = p.sale_id
        where s.company_id = $1 and s.status = 'finalizada' and s.deleted_at is null
          and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
          and ($4::int is null or s.store_id = $4)
        group by p.method`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    const rec = await sql.query<{ total: string | number }>(
      `select coalesce(sum(received_amount),0) as total from accounts_receivable
        where company_id = $1 and received_at >= $2::date and received_at < ($3::date + interval '1 day')
          and ($4::int is null or store_id = $4)`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    const paid = await sql.query<{ total: string | number }>(
      `select coalesce(sum(paid_amount),0) as total from accounts_payable
        where company_id = $1 and paid_at >= $2::date and paid_at < ($3::date + interval '1 day')
          and ($4::int is null or store_id = $4)`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    const expenses = await sql.query<{ total: string | number }>(
      `select coalesce(sum(amount),0) as total from expenses
        where company_id = $1 and deleted_at is null
          and spent_at >= $2::date and spent_at <= $3::date
          and ($4::int is null or store_id = $4)`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    const cashMoves = await sql.query<{ type: string; total: string | number }>(
      `select type, coalesce(sum(amount),0) as total from cash_movements
        where company_id = $1 and created_at >= $2::date and created_at < ($3::date + interval '1 day')
          and ($4::int is null or store_id = $4)
          and type in ('sangria','suprimento')
        group by type`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    const salesIn = inflows.reduce((a, r) => a + num(r.total), 0);
    const extraIn = num(rec[0]?.total);
    const out = num(paid[0]?.total) + num(expenses[0]?.total);
    const sangria = num(cashMoves.find((m) => m.type === "sangria")?.total);
    const suprimento = num(cashMoves.find((m) => m.type === "suprimento")?.total);
    const entries = salesIn + extraIn + suprimento;
    const exits = out + sangria;
    return {
      inflows: inflows.map((r) => ({ method: r.method, total: num(r.total) })),
      opening: 0,
      entries,
      exits,
      closing: entries - exits,
      receivablesSettled: extraIn,
      payablesSettled: num(paid[0]?.total),
      expenses: num(expenses[0]?.total),
      sangria,
      suprimento,
    };
  });

type RegisterSummary = {
  sales: number;
  cashSales: number;
  pix: number;
  cards: number;
  sangria: number;
  suprimento: number;
  expectedCash: number;
};

type OpenRegister = {
  id: number;
  opening_amount: number;
  notes: string | null;
  opened_at: string | null;
  user_id: string | null;
};

type RegisterView = {
  register: OpenRegister | null;
  movements: Row[];
  summary: RegisterSummary | null;
};

async function loadOpenRegister(sql: Sql, companyId: number, storeId: number): Promise<RegisterView> {
  const [reg] = await sql<Row>`
    select * from cash_registers
    where company_id = ${companyId} and store_id = ${storeId} and status = 'open'
    order by opened_at desc limit 1
  `;
  if (!reg) return { register: null, movements: [], summary: null };
  const movements = await sql<Row>`
    select * from cash_movements where register_id = ${num(reg.id)} order by created_at desc
  `;
  const byMethod = await sql<{ method: string | null; type: string; total: string | number }>`
    select method, type, coalesce(sum(amount),0) as total
    from cash_movements where register_id = ${num(reg.id)}
    group by method, type
  `;
  const sales = byMethod.filter((m) => m.type === "venda").reduce((a, m) => a + num(m.total), 0);
  const cashSales = num(byMethod.find((m) => m.type === "venda" && m.method === "dinheiro")?.total);
  const pix = num(byMethod.find((m) => m.type === "venda" && m.method === "pix")?.total);
  const cards = byMethod
    .filter((m) => m.type === "venda" && (m.method === "debito" || m.method === "credito"))
    .reduce((a, m) => a + num(m.total), 0);
  const sangria = byMethod.filter((m) => m.type === "sangria").reduce((a, m) => a + num(m.total), 0);
  const suprimento = byMethod.filter((m) => m.type === "suprimento").reduce((a, m) => a + num(m.total), 0);
  const refunds = byMethod
    .filter((m) => m.type === "devolucao" || m.type === "cancelamento")
    .reduce((a, m) => a + num(m.total), 0);
  const expectedCash = num(reg.opening_amount) + cashSales + suprimento - sangria - refunds;
  return {
    register: {
      id: num(reg.id),
      opening_amount: num(reg.opening_amount),
      notes: reg.notes == null ? null : String(reg.notes),
      opened_at: reg.opened_at == null ? null : String(reg.opened_at),
      user_id: reg.user_id == null ? null : String(reg.user_id),
    },
    movements,
    summary: { sales, cashSales, pix, cards, sangria, suprimento, expectedCash },
  };
}

export const getRegisterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.read");
    await assertStore(sql, tenant.companyId, data.storeId);
    return dump(await loadOpenRegister(sql, tenant.companyId, data.storeId));
  });

export const openRegisterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number; amount: number; notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    const existing = await sql`
      select id from cash_registers where store_id = ${data.storeId} and company_id = ${tenant.companyId} and status = 'open'
    `;
    if (existing.length) throw new Error("Já existe um caixa aberto nesta loja.");
    if (data.amount < 0) throw new Error("Fundo inicial não pode ser negativo.");
    let row: { id: number } | undefined;
    try {
      [row] = await sql<{ id: number }>`
        insert into cash_registers (company_id, store_id, user_id, opening_amount, notes, status)
        values (${tenant.companyId}, ${data.storeId}, ${tenant.userId}, ${data.amount}, ${data.notes ?? null}, 'open')
        returning id
      `;
    } catch (err) {
      // Duas aberturas quase-simultâneas (duplo clique, duas abas) passam pelo
      // SELECT acima antes de qualquer INSERT confirmar — cash_registers_one_open_idx
      // (migration 0010) é o backstop real contra a corrida; sem isto o erro cru
      // do Postgres (23505) vazava pro operador em vez da mensagem de negócio.
      if ((err as { code?: string }).code === "23505") {
        throw new Error("Já existe um caixa aberto nesta loja.");
      }
      throw err;
    }
    await audit(sql, tenant, "open", "cash_register", row!.id, null, { amount: data.amount });
    return { id: row!.id };
  });

export const closeRegisterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number; amount: number; notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    const current = await loadOpenRegister(sql, tenant.companyId, data.storeId);
    if (!current.register) throw new Error("Nenhum caixa aberto.");
    const expected = current.summary?.expectedCash ?? 0;
    const diff = data.amount - expected;
    await sql`
      update cash_registers set status = 'closed', closed_at = now(), closing_amount = ${data.amount},
        expected_amount = ${expected}, difference_amount = ${diff}, notes = ${data.notes ?? current.register.notes}
      where id = ${current.register.id} and company_id = ${tenant.companyId}
    `;
    await audit(sql, tenant, "close", "cash_register", current.register.id, null, {
      expected,
      counted: data.amount,
      diff,
    });
    return { expected, counted: data.amount, diff, summary: current.summary };
  });

export const cashMoveFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number; type: "sangria" | "suprimento"; amount: number; description: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    const [reg] = await sql<{ id: number }>`
      select id from cash_registers
      where company_id = ${tenant.companyId} and store_id = ${data.storeId} and status = 'open'
      order by opened_at desc limit 1
    `;
    if (!reg) throw new Error("Abra o caixa antes de lançar sangria ou suprimento.");
    await sql`
      insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
      values (${tenant.companyId}, ${data.storeId}, ${reg.id}, ${tenant.userId}, ${data.type}, 'dinheiro', ${data.amount}, ${data.description})
    `;
    return { ok: true };
  });

export const listExpensesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    return dump(
      await sql<Row>`
        select * from expenses where company_id = ${tenant.companyId} and deleted_at is null
        order by spent_at desc limit 100
      `,
    );
  });

export const saveExpenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { description: string; category?: string; amount: number; spentAt: string; accountKind?: string; storeId?: number | null }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    await sql`
      insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id)
      values (${tenant.companyId}, ${data.storeId ?? null}, ${data.description}, ${data.category ?? null}, ${data.amount}, ${data.spentAt}, ${data.accountKind ?? null}, ${tenant.userId})
    `;
    return { ok: true };
  });

export const listTargetsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "targets.read");
    const rows = await sql<Row>`
      select t.*, sl.name as seller_name, st.name as store_name, c.name as category_name
      from targets t
      left join sellers sl on sl.id = t.seller_id
      left join stores st on st.id = t.store_id
      left join categories c on c.id = t.category_id
      where t.company_id = ${tenant.companyId}
      order by t.period_start desc
    `;
    const out: {
      id: number;
      name: string;
      period_start: string;
      period_end: string;
      store_id: number | null;
      seller_id: number | null;
      category_id: number | null;
      store_name: string | null;
      seller_name: string | null;
      category_name: string | null;
      amount: number;
      realized: number;
      progress: number;
      bonus_kind: TargetBonusKind;
      bonus_value: number;
    }[] = [];
    for (const t of rows) {
      const realized = await sql.query<{ v: string | number }>(
        `select coalesce(sum(s.total),0) as v from sales s
          where s.company_id = $1 and s.status = 'finalizada' and s.deleted_at is null
            and s.sold_at::date between $2 and $3
            and ($4::int is null or s.store_id = $4)
            and ($5::int is null or s.seller_id = $5)
            and ($6::int is null or exists (
              select 1 from sale_items si join products p on p.id = si.product_id
              where si.sale_id = s.id and p.category_id = $6
            ))`,
        [tenant.companyId, t.period_start, t.period_end, t.store_id, t.seller_id, t.category_id],
      );
      const amount = num(t.amount);
      const done = num(realized[0]?.v);
      const kindRaw = String(t.bonus_kind ?? "none");
      out.push({
        id: num(t.id),
        name: String(t.name ?? ""),
        period_start: String(t.period_start ?? ""),
        period_end: String(t.period_end ?? ""),
        store_id: t.store_id == null ? null : num(t.store_id),
        seller_id: t.seller_id == null ? null : num(t.seller_id),
        category_id: t.category_id == null ? null : num(t.category_id),
        store_name: t.store_name == null ? null : String(t.store_name),
        seller_name: t.seller_name == null ? null : String(t.seller_name),
        category_name: t.category_name == null ? null : String(t.category_name),
        amount,
        realized: done,
        progress: amount ? (done / amount) * 100 : 0,
        bonus_kind: isTargetBonusKind(kindRaw) ? kindRaw : "none",
        bonus_value: num(t.bonus_value),
      });
    }
    return out;
  });

export const saveTargetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      amount: number;
      periodStart: string;
      periodEnd: string;
      storeId?: number | null;
      sellerId?: number | null;
      categoryId?: number | null;
      bonusKind?: string;
      bonusValue?: number;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "targets.write");
    const name = data.name.trim();
    if (!name) throw new Error("Informe o nome da meta.");
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Valor da meta inválido.");
    if (!data.periodStart || !data.periodEnd) throw new Error("Informe o período.");
    if (data.periodEnd < data.periodStart) throw new Error("O fim do período deve ser depois do início.");
    const bonusKind: TargetBonusKind = isTargetBonusKind(data.bonusKind ?? "none")
      ? (data.bonusKind as TargetBonusKind)
      : "none";
    let bonusValue = Math.max(0, Number(data.bonusValue) || 0);
    if (bonusKind !== "none" && data.sellerId == null) {
      throw new Error("Bônus de comissão exige um vendedor.");
    }
    if (bonusKind === "extra_percent") {
      if (bonusValue <= 0 || bonusValue > 20) throw new Error("Bônus percentual deve ser maior que 0 e no máximo 20%.");
    } else if (bonusKind === "extra_fixed") {
      if (bonusValue <= 0 || bonusValue > 100000) throw new Error("Bônus fixo inválido.");
    } else {
      bonusValue = 0;
    }
    const storeId = data.storeId ?? null;
    const sellerId = data.sellerId ?? null;
    const categoryId = data.categoryId ?? null;
    if (data.id) {
      const updated = await sql<{ id: number }>`
        update targets set
          name = ${name},
          amount = ${amount},
          period_start = ${data.periodStart},
          period_end = ${data.periodEnd},
          store_id = ${storeId},
          seller_id = ${sellerId},
          category_id = ${categoryId},
          bonus_kind = ${bonusKind},
          bonus_value = ${bonusValue}
        where id = ${data.id} and company_id = ${tenant.companyId}
        returning id
      `;
      if (!updated.length) throw new Error("Meta não encontrada.");
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into targets (
        company_id, store_id, seller_id, category_id, name, period_start, period_end, amount,
        bonus_kind, bonus_value
      )
      values (
        ${tenant.companyId}, ${storeId}, ${sellerId}, ${categoryId},
        ${name}, ${data.periodStart}, ${data.periodEnd}, ${amount},
        ${bonusKind}, ${bonusValue}
      )
      returning id
    `;
    return { id: row!.id };
  });

export const listCommissionsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { sellerId?: number; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.read");
    const rows = await sql.query<Row>(
      `select c.id, c.seller_id, c.sale_id, c.amount, c.percent, c.status, c.created_at, c.paid_at, c.note,
              c.net_amount, c.tax_inss, c.tax_irrf, c.tax_iss, c.tax_other, c.tax_breakdown,
              sl.name as seller_name, s.number as sale_number, s.total as sale_total,
              cr.name as rule_name
         from commissions c
         join sellers sl on sl.id = c.seller_id
         left join sales s on s.id = c.sale_id
         left join commission_rules cr on cr.id = c.rule_id
        where c.company_id = $1
          and ($2::int is null or c.seller_id = $2)
          and ($3::text is null or c.status = $3)
        order by case when c.status = 'pendente' then 0 else 1 end, c.created_at desc
        limit 200`,
      [tenant.companyId, data.sellerId ?? null, data.status ?? null],
    );
    return rows.map((r) => ({
      id: num(r.id),
      sellerId: num(r.seller_id),
      saleId: r.sale_id == null ? null : num(r.sale_id),
      amount: num(r.amount),
      percent: num(r.percent),
      status: String(r.status ?? "pendente"),
      createdAt: String(r.created_at ?? ""),
      paidAt: r.paid_at == null ? null : String(r.paid_at),
      sellerName: String(r.seller_name ?? ""),
      saleNumber: r.sale_number == null ? null : num(r.sale_number),
      saleTotal: r.sale_total == null ? null : num(r.sale_total),
      note: r.note == null ? null : String(r.note),
      ruleName: r.rule_name == null ? null : String(r.rule_name),
      net: r.net_amount == null ? num(r.amount) : num(r.net_amount),
      taxInss: num(r.tax_inss),
      taxIrrf: num(r.tax_irrf),
      taxIss: num(r.tax_iss),
      taxOther: num(r.tax_other),
      taxBreakdown: r.tax_breakdown ?? null,
    }));
  });

type PendingCommission = {
  id: number;
  amount: number;
  seller_id: number;
  seller_name: string;
  seller_document: string | null;
  seller_phone: string | null;
  sale_number: number | null;
  rule_name: string | null;
  note: string | null;
};

async function companySlipHeader(sql: Sql, companyId: number) {
  const [c] = await sql<{
    name: string;
    trade_name: string | null;
    document: string | null;
    city: string | null;
    state: string | null;
  }>`
    select name, trade_name, document, city, state from companies where id = ${companyId}
  `;
  return {
    companyName: String(c?.trade_name || c?.name || ""),
    companyDocument: c?.document == null ? null : String(c.document),
    companyCity: c?.city == null ? null : String(c.city),
    companyState: c?.state == null ? null : String(c.state),
  };
}

async function loadPendingCommissions(
  sql: Sql,
  companyId: number,
  sellerId?: number,
  ids?: number[],
): Promise<PendingCommission[]> {
  const rows = await sql.query<{
    id: number;
    amount: string | number;
    seller_id: number;
    seller_name: string;
    seller_document: string | null;
    seller_phone: string | null;
    sale_number: string | number | null;
    rule_name: string | null;
    note: string | null;
  }>(
    `select c.id, c.amount, c.seller_id, sl.name as seller_name,
            sl.document as seller_document, sl.phone as seller_phone,
            s.number as sale_number, cr.name as rule_name, c.note
       from commissions c
       join sellers sl on sl.id = c.seller_id
       left join sales s on s.id = c.sale_id
       left join commission_rules cr on cr.id = c.rule_id
      where c.company_id = $1 and c.status = 'pendente'
        and ($2::int is null or c.seller_id = $2)
      order by c.seller_id, c.id`,
    [companyId, sellerId ?? null],
  );
  const mapped = rows.map((r) => ({
    id: num(r.id),
    amount: num(r.amount),
    seller_id: num(r.seller_id),
    seller_name: String(r.seller_name ?? ""),
    seller_document: r.seller_document == null ? null : String(r.seller_document),
    seller_phone: r.seller_phone == null ? null : String(r.seller_phone),
    sale_number: r.sale_number == null ? null : num(r.sale_number),
    rule_name: r.rule_name == null ? null : String(r.rule_name),
    note: r.note == null ? null : String(r.note),
  }));
  if (ids?.length) {
    const allow = new Set(ids);
    return mapped.filter((r) => allow.has(r.id));
  }
  return mapped;
}

function taxInsertFromSplit(
  batch: TaxResult,
  split: { gross: number; inss: number; irrf: number; iss: number; other: number; net: number },
) {
  const share = batch.gross > 0 ? split.gross / batch.gross : 0;
  const line: TaxResult = {
    ...batch,
    gross: split.gross,
    inss: split.inss,
    irrf: split.irrf,
    iss: split.iss,
    other: split.other,
    net: split.net,
    totalTax: money(split.inss + split.irrf + split.iss + split.other),
    employerInss: money(batch.employerInss * share),
    employerFgts: money(batch.employerFgts * share),
    employerCost: money(batch.employerCost * share),
    lines: batch.lines.map((l) => ({
      ...l,
      amount:
        l.key === "inss"
          ? split.inss
          : l.key === "irrf"
            ? split.irrf
            : l.key === "iss"
              ? split.iss
              : l.key === "other"
                ? split.other
                : money(l.amount * share),
    })),
  };
  return taxInsert(line);
}

async function settleSellerBatch(
  sql: Sql,
  tenant: Tenant,
  rows: PendingCommission[],
  storeId: number | null | undefined,
  header: Awaited<ReturnType<typeof companySlipHeader>>,
): Promise<CommissionSlipData> {
  const seller = rows[0];
  if (!seller) throw new Error("Nenhuma comissão pendente neste filtro.");
  const amounts = rows.map((r) => r.amount);
  const grossTotal = money(amounts.reduce((a, n) => a + n, 0));
  const tax = await taxForSeller(sql, tenant.companyId, seller.seller_id, grossTotal, { onlyPaid: true });
  const splits = allocateTax(amounts, tax);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const split = splits[i]!;
    const cols = taxInsertFromSplit(tax, split);
    await sql`
      update commissions set
        status = 'pago',
        paid_at = now(),
        net_amount = ${cols.net}, tax_inss = ${cols.inss}, tax_irrf = ${cols.irrf},
        tax_iss = ${cols.iss}, tax_other = ${cols.other}, tax_breakdown = ${cols.json}::jsonb
      where id = ${row.id} and company_id = ${tenant.companyId} and status = 'pendente'
    `;
  }
  const who = seller.seller_name;
  const n = rows.length;
  const saleBit =
    n === 1 && seller.sale_number != null
      ? ` · venda nº ${seller.sale_number}`
      : n > 1
        ? ` · ${n} lançamentos`
        : "";
  await sql`
    insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id)
    values (
      ${tenant.companyId}, ${storeId ?? null},
      ${"Comissão líquida " + who + saleBit},
      'Folha', ${tax.net}, ${new Date().toISOString().slice(0, 10)},
      'caixa', ${tenant.userId}
    )
  `;
  if (tax.totalTax > 0.009) {
    await sql`
      insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id)
      values (
        ${tenant.companyId}, ${storeId ?? null},
        ${"Retenção INSS/IRRF/ISS · " + who + saleBit},
        'Impostos', ${tax.totalTax}, ${new Date().toISOString().slice(0, 10)},
        'caixa', ${tenant.userId}
      )
    `;
  }
  await audit(sql, tenant, "pay", "commission", n === 1 ? seller.id : null, null, {
    count: n,
    amount: tax.gross,
    net: tax.net,
    tax: tax.totalTax,
    sellerId: seller.seller_id,
  });
  return {
    paidAt: new Date().toISOString(),
    sellerName: who,
    sellerDocument: seller.seller_document,
    sellerPhone: seller.seller_phone,
    regime: tax.regime,
    sales: rows.map((r, i) => ({
      saleNumber: r.sale_number,
      rule: r.rule_name ?? r.note ?? "",
      gross: r.amount,
      net: splits[i]?.net ?? r.amount,
    })),
    tax,
    companyName: header.companyName,
    companyDocument: header.companyDocument,
    companyCity: header.companyCity,
    companyState: header.companyState,
  };
}

export const payCommissionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; storeId?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const pending = await loadPendingCommissions(sql, tenant.companyId, undefined, [data.id]);
    if (!pending.length) {
      const [row] = await sql<{ status: string }>`
        select status from commissions where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      if (!row) throw new Error("Comissão não encontrada.");
      throw new Error("Só comissões pendentes podem ser pagas.");
    }
    const header = await companySlipHeader(sql, tenant.companyId);
    const slip = await settleSellerBatch(sql, tenant, pending, data.storeId, header);
    return dump({ ok: true, net: slip.tax.net, amount: slip.tax.gross, slips: [slip] });
  });

export const payPendingCommissionsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { sellerId?: number; storeId?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const pending = await loadPendingCommissions(sql, tenant.companyId, data.sellerId);
    if (!pending.length) throw new Error("Nenhuma comissão pendente neste filtro.");
    const header = await companySlipHeader(sql, tenant.companyId);
    const groups = new Map<number, PendingCommission[]>();
    for (const row of pending) {
      const list = groups.get(row.seller_id) ?? [];
      list.push(row);
      groups.set(row.seller_id, list);
    }
    const slips: CommissionSlipData[] = [];
    for (const group of groups.values()) {
      slips.push(await settleSellerBatch(sql, tenant, group, data.storeId, header));
    }
    const amount = money(slips.reduce((a, s) => a + s.tax.gross, 0));
    const net = money(slips.reduce((a, s) => a + s.tax.net, 0));
    return dump({ ok: true, count: pending.length, amount, net, slips });
  });
