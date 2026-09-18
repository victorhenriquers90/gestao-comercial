import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { assertFreeDocument, audit, requireTenant } from "./context";
import { dump, type Row } from "@/lib/json";
import { ftsPrefix, prefixLike } from "@/lib/search";
import { parseBrDocument, parseCnpj, sellerDocKind, onlyDigits } from "@/lib/document";
import { clampIss } from "@/lib/tax";
import {
  optionalLine,
  requireLine,
  requireMultiline,
  sanitizeCode,
  sanitizeMultiline,
} from "@/lib/sanitize";

export const listCustomersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; stage?: string; kind?: "pf" | "pj"; debit?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.read");
    const params: unknown[] = [tenant.companyId];
    const raw = data.q?.trim() || "";
    let extra = "";
    if (raw) {
      const digits = onlyDigits(raw);
      params.push(raw, prefixLike(raw), ftsPrefix(raw));
      extra += ` and (
        c.document = $${params.length - 2} or c.phone = $${params.length - 2}
        or lower(c.name) like $${params.length - 1} or lower(coalesce(c.phone,'')) like $${params.length - 1}
        or to_tsvector('simple', coalesce(c.name,'')) @@ to_tsquery('simple', $${params.length})
        or c.name ilike ('%' || $${params.length - 2} || '%')`;
      if (digits.length >= 6) {
        params.push(digits);
        extra += ` or c.document = $${params.length}`;
      }
      extra += `)`;
    }
    if (data.kind === "pf" || data.kind === "pj") {
      params.push(data.kind);
      extra += ` and c.kind = $${params.length}`;
    }
    if (data.debit) {
      extra += ` and coalesce(ar.open_balance, 0) > 0`;
    }
    const rows = await sql.query<Row>(
      `select c.*,
              coalesce(sv.total_bought, 0) as total_bought,
              sv.last_purchase,
              coalesce(ar.open_balance, 0) as open_balance,
              coalesce(tk.open_tasks, 0) as open_tasks,
              tk.next_due
         from customers c
         left join (
           select customer_id, sum(total) as total_bought, max(sold_at) as last_purchase
             from sales
            where company_id = $1 and status = 'finalizada' and deleted_at is null
            group by customer_id
         ) sv on sv.customer_id = c.id
         left join (
           select customer_id, sum(amount - received_amount) as open_balance
             from accounts_receivable
            where company_id = $1 and deleted_at is null
              and status in ('pendente','parcial','vencido')
            group by customer_id
         ) ar on ar.customer_id = c.id
         left join (
           select customer_id, count(*)::int as open_tasks, min(due_at) as next_due
             from crm_tasks
            where company_id = $1 and done_at is null
            group by customer_id
         ) tk on tk.customer_id = c.id
        where c.company_id = $1 and c.deleted_at is null
          ${extra}
        order by c.name
        limit 200`,
      params,
    );
    return rows.map((r) => ({
      id: num(r.id),
      kind: String(r.kind ?? "pf"),
      name: String(r.name ?? ""),
      document: r.document == null ? null : String(r.document),
      phone: r.phone == null ? null : String(r.phone),
      email: r.email == null ? null : String(r.email),
      city: r.city == null ? null : String(r.city),
      crm_stage: String(r.crm_stage ?? "novo"),
      total_bought: num(r.total_bought),
      last_purchase: r.last_purchase == null ? null : String(r.last_purchase),
      open_balance: num(r.open_balance),
      credit_limit: num(r.credit_limit),
      open_tasks: num(r.open_tasks),
      next_due: r.next_due == null ? null : String(r.next_due),
    }));
  });

export const getCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.read");
    const [customer] = await sql<Row>`select * from customers where id = ${data.id} and company_id = ${tenant.companyId}`;
    if (!customer) throw new Error("Cliente não encontrado.");
    const sales = await sql<Row>`
      select id, number, total, sold_at, status from sales
      where customer_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by sold_at desc limit 50
    `;
    const products = await sql<Row>`
      select si.description, sum(si.quantity) as qty, sum(si.total) as total
      from sale_items si
      join sales s on s.id = si.sale_id
      where s.customer_id = ${data.id} and s.status = 'finalizada'
      group by si.description
      order by total desc
      limit 20
    `;
    const receivables = await sql<Row>`
      select * from accounts_receivable
      where customer_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by due_date
    `;
    const notes = await sql<Row>`
      select * from customer_notes where customer_id = ${data.id} order by created_at desc limit 30
    `;
    const tasks = await sql<Row>`
      select * from crm_tasks where customer_id = ${data.id} order by created_at desc
    `;
    const stats = await sql<{ total: string | number; n: number; avg: string | number }>`
      select coalesce(sum(total),0) as total, count(*)::int as n, coalesce(avg(total),0) as avg
      from sales where customer_id = ${data.id} and status = 'finalizada'
    `;
    return dump({
      customer: {
        id: num(customer.id),
        kind: String(customer.kind ?? "pf"),
        name: String(customer.name ?? ""),
        tradeName: customer.trade_name == null ? null : String(customer.trade_name),
        document: customer.document == null ? null : String(customer.document),
        email: customer.email == null ? null : String(customer.email),
        phone: customer.phone == null ? null : String(customer.phone),
        city: customer.city == null ? null : String(customer.city),
        state: customer.state == null ? null : String(customer.state),
        address: customer.address == null ? null : String(customer.address),
        creditLimit: num(customer.credit_limit),
        notes: customer.notes == null ? null : String(customer.notes),
        crmStage: String(customer.crm_stage ?? "novo"),
        sellerId: customer.seller_id == null ? null : num(customer.seller_id),
      },
      sales: sales.map((s) => ({
        id: num(s.id),
        number: num(s.number),
        total: num(s.total),
        soldAt: String(s.sold_at ?? ""),
        status: String(s.status ?? ""),
      })),
      products: products.map((p) => ({
        description: String(p.description ?? ""),
        qty: num(p.qty),
        total: num(p.total),
      })),
      receivables: receivables.map((r) => ({
        id: num(r.id),
        description: String(r.description ?? ""),
        dueDate: String(r.due_date ?? ""),
        amount: num(r.amount),
        received: num(r.received_amount),
        status: String(r.status ?? ""),
      })),
      notes: notes.map((n) => ({
        id: num(n.id),
        body: String(n.body ?? ""),
        createdAt: String(n.created_at ?? ""),
      })),
      tasks: tasks.map((t) => ({
        id: num(t.id),
        title: String(t.title ?? ""),
        dueAt: t.due_at == null ? null : String(t.due_at),
        doneAt: t.done_at == null ? null : String(t.done_at),
      })),
      stats: {
        total: num(stats[0]?.total),
        count: num(stats[0]?.n),
        avg: num(stats[0]?.avg),
      },
    });
  });

export const saveCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      kind: string;
      name: string;
      tradeName?: string;
      document?: string;
      ie?: string;
      rg?: string;
      birthDate?: string | null;
      email?: string;
      phone?: string;
      whatsapp?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      creditLimit?: number;
      notes?: string;
      crmStage?: string;
      sellerId?: number | null;
    }) => ({
      ...d,
      kind: requireLine(d.kind, "Tipo", 20),
      name: requireLine(d.name, "Nome"),
      tradeName: optionalLine(d.tradeName) ?? undefined,
      document: parseBrDocument(d.document, d.kind === "pj" ? "cnpj" : "cpf") ?? undefined,
      ie: sanitizeCode(d.ie, 32) ?? undefined,
      rg: sanitizeCode(d.rg, 32) ?? undefined,
      email: optionalLine(d.email, 120) ?? undefined,
      phone: sanitizeCode(d.phone, 32) ?? undefined,
      whatsapp: sanitizeCode(d.whatsapp, 32) ?? undefined,
      address: optionalLine(d.address, 200) ?? undefined,
      city: optionalLine(d.city, 80) ?? undefined,
      state: optionalLine(d.state, 2) ?? undefined,
      zip: sanitizeCode(d.zip, 16) ?? undefined,
      notes: sanitizeMultiline(d.notes) ?? undefined,
      crmStage: optionalLine(d.crmStage, 24) ?? undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.write");
    await assertFreeDocument(sql, "customers", tenant.companyId, data.document, data.id, "um cliente");
    if (data.id) {
      await sql`
        update customers set kind = ${data.kind}, name = ${data.name}, trade_name = ${data.tradeName ?? null},
          document = ${data.document ?? null}, ie = ${data.ie ?? null}, rg = ${data.rg ?? null},
          birth_date = ${data.birthDate ?? null}, email = ${data.email ?? null}, phone = ${data.phone ?? null},
          whatsapp = ${data.whatsapp ?? null}, address = ${data.address ?? null}, city = ${data.city ?? null},
          state = ${data.state ?? null}, zip = ${data.zip ?? null}, credit_limit = ${data.creditLimit ?? 0},
          notes = ${data.notes ?? null}, crm_stage = ${data.crmStage ?? "venda"}, seller_id = ${data.sellerId ?? null},
          updated_at = now()
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into customers (
        company_id, kind, name, trade_name, document, ie, rg, birth_date, email, phone, whatsapp,
        address, city, state, zip, credit_limit, notes, crm_stage, seller_id
      ) values (
        ${tenant.companyId}, ${data.kind}, ${data.name}, ${data.tradeName ?? null}, ${data.document ?? null},
        ${data.ie ?? null}, ${data.rg ?? null}, ${data.birthDate ?? null}, ${data.email ?? null}, ${data.phone ?? null},
        ${data.whatsapp ?? null}, ${data.address ?? null}, ${data.city ?? null}, ${data.state ?? null}, ${data.zip ?? null},
        ${data.creditLimit ?? 0}, ${data.notes ?? null}, ${data.crmStage ?? "novo"}, ${data.sellerId ?? null}
      ) returning id
    `;
    await audit(sql, tenant, "create", "customer", row!.id, null, { name: data.name });
    return { id: row!.id };
  });

export const addCustomerNoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; body: string }) => ({
    ...d,
    body: requireMultiline(d.body, "Nota"),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    // O customerId vinha cru do cliente direto para o insert -- era o unico
    // lugar, entre as 94 server functions, onde um id externo entrava numa
    // escrita sem conferir o dono. A nota nascia carimbada com a empresa de
    // quem escreveu, mas apontando para um cliente que podia ser de outra
    // (e o sucesso/erro do insert ainda revelava se aquele id existe).
    const [cliente] = await sql<{ id: number }>`
      select id from customers
      where id = ${data.customerId} and company_id = ${tenant.companyId} and deleted_at is null
    `;
    if (!cliente) throw new Error("Cliente não encontrado.");
    await sql`
      insert into customer_notes (company_id, customer_id, user_id, body)
      values (${tenant.companyId}, ${cliente.id}, ${tenant.userId}, ${data.body})
    `;
    return { ok: true };
  });

export const saveCrmTaskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; title: string; dueAt?: string | null }) => ({
    ...d,
    title: requireLine(d.title, "Tarefa", 180),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    await sql`
      insert into crm_tasks (company_id, customer_id, user_id, title, due_at)
      values (${tenant.companyId}, ${data.customerId}, ${tenant.userId}, ${data.title}, ${data.dueAt ?? null})
    `;
    return { ok: true };
  });

export const toggleCrmTaskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; done: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    // Escrita de CRM sem checagem de papel. O escopo por company_id ja estava
    // certo (nao vazava entre lojas), mas qualquer papel autenticado podia
    // concluir/reabrir tarefa de CRM -- inclusive os que nem enxergam a tela.
    assertCan(tenant.role, "crm.write");
    await sql`
      update crm_tasks set done_at = ${data.done ? new Date().toISOString() : null}
      where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    return { ok: true };
  });

export const listCrmTasksFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { openOnly?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    const rows = await sql.query<Row>(
      `select t.id, t.title, t.due_at, t.done_at, t.customer_id, c.name as customer_name
         from crm_tasks t
         join customers c on c.id = t.customer_id
        where t.company_id = $1
          and ($2::int = 0 or t.done_at is null)
        order by t.done_at nulls first, t.due_at nulls last, t.id desc
        limit 80`,
      [tenant.companyId, data.openOnly === false ? 0 : 1],
    );
    return rows.map((r) => ({
      id: num(r.id),
      title: String(r.title ?? ""),
      dueAt: r.due_at == null ? null : String(r.due_at),
      doneAt: r.done_at == null ? null : String(r.done_at),
      customerId: num(r.customer_id),
      customerName: String(r.customer_name ?? ""),
    }));
  });

export const moveCrmFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; stage: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    await sql`
      update customers set crm_stage = ${data.stage}, updated_at = now()
      where id = ${data.customerId} and company_id = ${tenant.companyId}
    `;
    return { ok: true };
  });

export const listSuppliersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "suppliers.read");
    const raw = data.q?.trim() || "";
    const rows = await sql.query<Row>(
      `select s.*,
              coalesce((select sum(p.total) from purchases p where p.supplier_id = s.id),0) as total_bought,
              (select count(*) from purchases p where p.supplier_id = s.id)::int as orders,
              coalesce((select sum(ap.amount - ap.paid_amount) from accounts_payable ap
                         where ap.supplier_id = s.id and ap.status in ('pendente','parcial','vencido')),0) as open_balance
         from suppliers s
        where s.company_id = $1 and s.deleted_at is null
          and (
            $2::text is null
            or s.document = $2
            or lower(s.legal_name) like $3 or lower(coalesce(s.trade_name,'')) like $3
            or to_tsvector('simple', coalesce(s.legal_name,'') || ' ' || coalesce(s.trade_name,'')) @@ to_tsquery('simple', $4)
            or s.legal_name ilike ('%' || $2 || '%') or s.trade_name ilike ('%' || $2 || '%')
          )
        order by s.legal_name`,
      [tenant.companyId, raw || null, raw ? prefixLike(raw) : null, raw ? ftsPrefix(raw) : "__none__:*"],
    );
    return rows.map((r) => ({
      id: num(r.id),
      legalName: String(r.legal_name ?? ""),
      tradeName: r.trade_name == null ? null : String(r.trade_name),
      document: r.document == null ? null : String(r.document),
      email: r.email == null ? null : String(r.email),
      phone: r.phone == null ? null : String(r.phone),
      whatsapp: r.whatsapp == null ? null : String(r.whatsapp),
      address: r.address == null ? null : String(r.address),
      city: r.city == null ? null : String(r.city),
      state: r.state == null ? null : String(r.state),
      representative: r.representative == null ? null : String(r.representative),
      notes: r.notes == null ? null : String(r.notes),
      totalBought: num(r.total_bought),
      orders: num(r.orders),
      openBalance: num(r.open_balance),
    }));
  });

export const getSupplierFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "suppliers.read");
    const [supplier] = await sql<Row>`select * from suppliers where id = ${data.id} and company_id = ${tenant.companyId}`;
    if (!supplier) throw new Error("Fornecedor não encontrado.");
    const purchases = await sql<Row>`
      select id, number, status, total, created_at, expected_at, received_at
      from purchases
      where supplier_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by created_at desc limit 40
    `;
    const payables = await sql<Row>`
      select id, description, due_date, amount, paid_amount, status
      from accounts_payable
      where supplier_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by due_date
    `;
    const products = await sql<Row>`
      select p.name, count(*)::int as times, coalesce(sum(pi.total),0) as total
      from purchase_items pi
      join purchases pu on pu.id = pi.purchase_id
      join products p on p.id = pi.product_id
      where pu.supplier_id = ${data.id} and pu.company_id = ${tenant.companyId}
      group by p.name
      order by times desc limit 15
    `;
    const stats = await sql<{ total: string | number; n: number }>`
      select coalesce(sum(total),0) as total, count(*)::int as n
      from purchases
      where supplier_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
    `;
    return dump({
      supplier: {
        id: num(supplier.id),
        legalName: String(supplier.legal_name ?? ""),
        tradeName: supplier.trade_name == null ? null : String(supplier.trade_name),
        document: supplier.document == null ? null : String(supplier.document),
        email: supplier.email == null ? null : String(supplier.email),
        phone: supplier.phone == null ? null : String(supplier.phone),
        whatsapp: supplier.whatsapp == null ? null : String(supplier.whatsapp),
        address: supplier.address == null ? null : String(supplier.address),
        city: supplier.city == null ? null : String(supplier.city),
        state: supplier.state == null ? null : String(supplier.state),
        zip: supplier.zip == null ? null : String(supplier.zip),
        representative: supplier.representative == null ? null : String(supplier.representative),
        notes: supplier.notes == null ? null : String(supplier.notes),
      },
      purchases: purchases.map((p) => ({
        id: num(p.id),
        number: num(p.number),
        status: String(p.status ?? ""),
        total: num(p.total),
        createdAt: String(p.created_at ?? ""),
        expectedAt: p.expected_at == null ? null : String(p.expected_at),
        receivedAt: p.received_at == null ? null : String(p.received_at),
      })),
      payables: payables.map((r) => ({
        id: num(r.id),
        description: String(r.description ?? ""),
        dueDate: String(r.due_date ?? ""),
        amount: num(r.amount),
        paid: num(r.paid_amount),
        status: String(r.status ?? ""),
      })),
      products: products.map((p) => ({
        name: String(p.name ?? ""),
        times: num(p.times),
        total: num(p.total),
      })),
      stats: {
        total: num(stats[0]?.total),
        count: num(stats[0]?.n),
      },
    });
  });

export const saveSupplierFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      legalName: string;
      tradeName?: string;
      document?: string;
      email?: string;
      phone?: string;
      whatsapp?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      representative?: string;
      notes?: string;
    }) => ({
      ...d,
      legalName: requireLine(d.legalName, "Razão social"),
      tradeName: optionalLine(d.tradeName) ?? undefined,
      document: parseCnpj(d.document) ?? undefined,
      email: optionalLine(d.email, 120) ?? undefined,
      phone: sanitizeCode(d.phone, 32) ?? undefined,
      whatsapp: sanitizeCode(d.whatsapp, 32) ?? undefined,
      address: optionalLine(d.address, 200) ?? undefined,
      city: optionalLine(d.city, 80) ?? undefined,
      state: optionalLine(d.state, 2) ?? undefined,
      zip: sanitizeCode(d.zip, 16) ?? undefined,
      representative: optionalLine(d.representative) ?? undefined,
      notes: sanitizeMultiline(d.notes) ?? undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "suppliers.write");
    await assertFreeDocument(sql, "suppliers", tenant.companyId, data.document, data.id, "um fornecedor");
    if (data.id) {
      await sql`
        update suppliers set legal_name = ${data.legalName}, trade_name = ${data.tradeName ?? null},
          document = ${data.document ?? null}, email = ${data.email ?? null}, phone = ${data.phone ?? null},
          whatsapp = ${data.whatsapp ?? null}, address = ${data.address ?? null}, city = ${data.city ?? null},
          state = ${data.state ?? null}, zip = ${data.zip ?? null}, representative = ${data.representative ?? null},
          notes = ${data.notes ?? null}, updated_at = now()
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into suppliers (
        company_id, legal_name, trade_name, document, email, phone, whatsapp, address, city, state, zip, representative, notes
      ) values (
        ${tenant.companyId}, ${data.legalName}, ${data.tradeName ?? null}, ${data.document ?? null}, ${data.email ?? null},
        ${data.phone ?? null}, ${data.whatsapp ?? null}, ${data.address ?? null}, ${data.city ?? null}, ${data.state ?? null},
        ${data.zip ?? null}, ${data.representative ?? null}, ${data.notes ?? null}
      ) returning id
    `;
    return { id: row!.id };
  });

export const listSellersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.read");
    const rows = await sql<Row>`
      select sl.*,
        coalesce((select sum(s.total) from sales s
                  where s.seller_id = sl.id and s.status = 'finalizada'
                    and s.sold_at >= date_trunc('month', now())),0) as month_revenue,
        coalesce((select sum(c.amount) from commissions c
                  where c.seller_id = sl.id
                    and c.created_at >= date_trunc('month', now())
                    and c.status <> 'cancelado'),0) as month_commission,
        coalesce((select sum(c.amount) from commissions c
                  where c.seller_id = sl.id and c.status = 'pendente'),0) as pending_commission,
        coalesce((select sum(coalesce(c.net_amount, c.amount)) from commissions c
                  where c.seller_id = sl.id and c.status = 'pendente'),0) as pending_net
      from sellers sl
      where sl.company_id = ${tenant.companyId} and sl.deleted_at is null
      order by sl.name
    `;
    return rows.map((r) => ({
      id: num(r.id),
      name: String(r.name ?? ""),
      email: r.email == null ? null : String(r.email),
      phone: r.phone == null ? null : String(r.phone),
      commission_pct: num(r.commission_pct),
      store_id: r.store_id == null ? null : num(r.store_id),
      is_active: Boolean(r.is_active),
      month_revenue: num(r.month_revenue),
      month_commission: num(r.month_commission),
      pending_commission: num(r.pending_commission),
      pending_net: num(r.pending_net),
      tax_regime: String(r.tax_regime ?? "none"),
      monthly_salary: num(r.monthly_salary),
      dependents: num(r.dependents),
      iss_rate: r.iss_rate == null ? null : num(r.iss_rate),
      document: r.document == null ? null : String(r.document),
    }));
  });

/**
 * Só id+nome, pro seletor de vendedor no PDV. `listSellersFn` também traz
 * salário, comissão e documento — não dá pra usá-lo ali sem vazar dado de
 * folha pra quem só teria acesso ao PDV. Sem perm própria: mesmo nível de
 * exposição do nome do vendedor já impresso no cupom.
 */
export const listActiveSellerNamesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { tenant, sql } = await requireTenant(context.userId);
    return sql<{ id: number; name: string }>`
      select id, name from sellers
      where company_id = ${tenant.companyId} and deleted_at is null and is_active = true
      order by name
    `;
  });

export const saveSellerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      email?: string;
      phone?: string;
      document?: string;
      commissionPct: number;
      storeId?: number | null;
      isActive?: boolean;
      taxRegime?: string;
      monthlySalary?: number;
      dependents?: number;
      issRate?: number | null;
    }) => ({
      ...d,
      name: requireLine(d.name, "Nome"),
      email: optionalLine(d.email, 120) ?? undefined,
      phone: sanitizeCode(d.phone, 32) ?? undefined,
      document: parseBrDocument(d.document, sellerDocKind(d.taxRegime)) ?? undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.write");
    await assertFreeDocument(sql, "sellers", tenant.companyId, data.document, data.id, "um vendedor");
    const taxRegime = data.taxRegime && ["none", "clt", "autonomo", "mei", "pj"].includes(data.taxRegime)
      ? data.taxRegime
      : "none";
    const monthlySalary = Math.max(0, Number(data.monthlySalary) || 0);
    const dependents = Math.max(0, Math.floor(Number(data.dependents) || 0));
    const issRate = data.issRate == null || data.issRate === undefined ? null : clampIss(data.issRate);
    const document = data.document ?? null;
    if (data.id) {
      await sql`
        update sellers set name = ${data.name}, email = ${data.email ?? null}, phone = ${data.phone ?? null},
          document = ${document},
          commission_pct = ${data.commissionPct}, store_id = ${data.storeId ?? null}, is_active = ${data.isActive ?? true},
          tax_regime = ${taxRegime}, monthly_salary = ${monthlySalary}, dependents = ${dependents}, iss_rate = ${issRate}
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into sellers (
        company_id, name, email, phone, document, commission_pct, store_id,
        tax_regime, monthly_salary, dependents, iss_rate
      )
      values (
        ${tenant.companyId}, ${data.name}, ${data.email ?? null}, ${data.phone ?? null}, ${document}, ${data.commissionPct},
        ${data.storeId ?? null}, ${taxRegime}, ${monthlySalary}, ${dependents}, ${issRate}
      )
      returning id
    `;
    return { id: row!.id };
  });
