import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { computeCommission } from "@/lib/commission";
import { dump, type Row } from "@/lib/json";
import { assertCan } from "@/lib/permissions";
import { bestPromo, type Promo } from "@/lib/promo";
import { num } from "@/lib/utils";
import { ftsPrefix, prefixLike } from "@/lib/search";
import { parseBrDocument } from "@/lib/document";
import { sanitizeMultiline } from "@/lib/sanitize";
import { loadCommissionRules, loadSellerTargetBonuses, parseBreakdown, sellerMonthRevenue, taxForSeller, taxInsert } from "./commission";
import { assertStore, audit, nextNumber, requireTenant } from "./context";
import { applyStockChange } from "./stock";

export type CartItemIn = {
  variantId: number;
  quantity: number;
  unitPrice: number;
  discount?: number;
};

export type PayIn = {
  method: string;
  amount: number;
  received?: number;
  installments?: number;
  brand?: string;
};

function mapPromo(r: Row): Promo {
  return {
    id: num(r.id),
    name: String(r.name),
    kind: String(r.kind),
    percent: r.percent == null ? null : num(r.percent),
    amount: r.amount == null ? null : num(r.amount),
    promoPrice: r.promo_price == null ? null : num(r.promo_price),
    buyQty: r.buy_qty == null ? null : num(r.buy_qty),
    payQty: r.pay_qty == null ? null : num(r.pay_qty),
    minQty: r.min_qty == null ? null : num(r.min_qty),
    productId: r.product_id == null ? null : num(r.product_id),
    categoryId: r.category_id == null ? null : num(r.category_id),
    isActive: Boolean(r.is_active),
    startsAt: String(r.starts_at ?? ""),
    endsAt: String(r.ends_at ?? ""),
  };
}

export const checkoutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      storeId: number;
      customerId?: number | null;
      sellerId?: number | null;
      notes?: string;
      cpfNaNota?: string;
      discount?: number;
      items: CartItemIn[];
      payments: PayIn[];
    }) => ({
      ...d,
      notes: sanitizeMultiline(d.notes, 500) ?? undefined,
      cpfNaNota: parseBrDocument(d.cpfNaNota, "any") ?? undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "pdv.sell");
    await assertStore(sql, tenant.companyId, data.storeId);
    if (!data.items.length) throw new Error("Inclua ao menos um item.");
    const [regOpen] = await sql<{ id: number }>`
      select id from cash_registers
      where company_id = ${tenant.companyId} and store_id = ${data.storeId} and status = 'open'
      order by opened_at desc limit 1
    `;
    if (!regOpen) throw new Error("Abra o caixa da loja para finalizar a venda.");

    let customerId = data.customerId ?? null;
    if (data.cpfNaNota) {
      const [found] = await sql<{ id: number }>`
        select id from customers
        where company_id = ${tenant.companyId} and document = ${data.cpfNaNota} and deleted_at is null
        limit 1
      `;
      if (found) {
        customerId = found.id;
      } else {
        const [created] = await sql<{ id: number }>`
          insert into customers (company_id, kind, name, document, crm_stage)
          values (
            ${tenant.companyId},
            ${data.cpfNaNota.length === 14 ? "pj" : "pf"},
            ${data.cpfNaNota.length === 14 ? "Consumidor PJ" : "Consumidor"},
            ${data.cpfNaNota},
            'venda'
          )
          returning id
        `;
        customerId = created!.id;
      }
    }

    let customerName: string | null = null;
    let customerDocument: string | null = data.cpfNaNota ?? null;
    if (customerId) {
      const [c] = await sql<{ name: string; document: string | null }>`
        select name, document from customers where id = ${customerId}
      `;
      customerName = c?.name ?? null;
      customerDocument = c?.document ?? customerDocument;
    }

    const [settings] = await sql<{ allow_negative_stock: boolean }>`
      select allow_negative_stock from company_settings where company_id = ${tenant.companyId}
    `;
    const allowNeg = Boolean(settings?.allow_negative_stock);

    const ids = data.items.map((i) => i.variantId);
    const catalog = await sql.query<{
      variant_id: number;
      product_id: number;
      name: string;
      color: string | null;
      size: string | null;
      price: string | number;
      promo_price: string | number | null;
      cost: string | number;
      stock: string | number;
      category_id: number | null;
      category_parent_id: number | null;
    }>(
      `select v.id as variant_id, p.id as product_id, p.name, v.color, v.size,
              coalesce(v.price, p.price) as price, p.promo_price, coalesce(v.cost, p.cost) as cost,
              coalesce(i.quantity,0) as stock, p.category_id, c.parent_id as category_parent_id
         from product_variants v
         join products p on p.id = v.product_id
         left join categories c on c.id = p.category_id
         left join inventories i on i.variant_id = v.id and i.store_id = $2
        where v.company_id = $1 and v.id in (${ids.map((_, i) => `$${i + 3}`).join(",")})`,
      [tenant.companyId, data.storeId, ...ids],
    );
    const byVar = new Map(catalog.map((c) => [c.variant_id, c]));

    const promoRows = await sql<Row>`
      select id, name, kind, percent, amount, promo_price, buy_qty, pay_qty, min_qty,
             product_id, category_id, is_active, starts_at, ends_at
      from promotions
      where company_id = ${tenant.companyId} and is_active = true
        and starts_at::date <= current_date and ends_at::date >= current_date
    `;
    const promos: Promo[] = promoRows.map(mapPromo);

    let subtotal = 0;
    let costTotal = 0;
    const lines: {
      variantId: number;
      productId: number;
      description: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      total: number;
      cost: number;
      categoryId: number | null;
      parentCategoryId: number | null;
    }[] = [];

    for (const item of data.items) {
      const cat = byVar.get(item.variantId);
      if (!cat) throw new Error("Produto inválido no carrinho.");
      if (item.quantity <= 0) throw new Error("Quantidade inválida.");
      if (!allowNeg && num(cat.stock) < item.quantity) {
        throw new Error(`Estoque insuficiente: ${cat.name}.`);
      }
      const list = num(cat.price);
      const productPromo = num(cat.promo_price);
      const allowed = productPromo > 0 ? productPromo : list;
      const promo = bestPromo(
        promos,
        cat.product_id,
        cat.category_id,
        cat.category_parent_id,
        item.quantity,
        allowed,
      );
      if (
        Math.abs(item.unitPrice - allowed) > 0.009 &&
        Math.abs(item.unitPrice - list) > 0.009 &&
        !(promo && Math.abs(item.unitPrice - promo.unitPrice) < 0.009)
      ) {
        assertCan(tenant.role, "pdv.price_override");
      }
      const disc = Math.max(num(item.discount), promo?.discount ?? 0);
      const line = Number((item.unitPrice * item.quantity - disc).toFixed(2));
      subtotal += line;
      costTotal += num(cat.cost) * item.quantity;
      lines.push({
        variantId: item.variantId,
        productId: cat.product_id,
        description: [cat.name, cat.color, cat.size].filter(Boolean).join(" · "),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: disc,
        total: line,
        cost: num(cat.cost),
        categoryId: cat.category_id == null ? null : num(cat.category_id),
        parentCategoryId: cat.category_parent_id == null ? null : num(cat.category_parent_id),
      });
    }

    const headerDisc = num(data.discount);
    if (headerDisc > 0) assertCan(tenant.role, "pdv.discount");
    const total = Number((subtotal - headerDisc).toFixed(2));
    if (total < 0) throw new Error("Total inválido.");
    const discPct = subtotal > 0 ? (headerDisc / subtotal) * 100 : 0;
    if (discPct > tenant.discountLimit + 0.05) {
      throw new Error(`Desconto acima do limite (${tenant.discountLimit}%). Solicite autorização.`);
    }

    const paySum = data.payments.reduce((a, p) => a + num(p.amount), 0);
    if (paySum + 0.05 < total) throw new Error("Pagamento insuficiente.");

    const number = await nextNumber(sql, tenant.companyId, "sale");
    const [sale] = await sql<{ id: number }>`
      insert into sales (
        company_id, store_id, number, customer_id, seller_id, user_id, status, notes,
        subtotal, discount, total, cost_total, document
      ) values (
        ${tenant.companyId}, ${data.storeId}, ${number}, ${customerId}, ${data.sellerId ?? null},
        ${tenant.userId}, 'finalizada', ${data.notes ?? null}, ${subtotal}, ${headerDisc}, ${total}, ${costTotal},
        ${customerDocument}
      ) returning id
    `;
    const saleId = sale!.id;

    for (const line of lines) {
      await sql`
        insert into sale_items (
          company_id, sale_id, variant_id, product_id, description, quantity, unit_price, discount, total, cost
        ) values (
          ${tenant.companyId}, ${saleId}, ${line.variantId}, ${line.productId}, ${line.description},
          ${line.quantity}, ${line.unitPrice}, ${line.discount}, ${line.total}, ${line.cost}
        )
      `;
      await applyStockChange(sql, {
        companyId: tenant.companyId,
        storeId: data.storeId,
        variantId: line.variantId,
        delta: -line.quantity,
        type: "venda",
        userId: tenant.userId,
        referenceType: "sale",
        referenceId: saleId,
        allowNegative: allowNeg,
      });
    }

    const reg = regOpen;

    for (const pay of data.payments) {
      const received = pay.method === "dinheiro" ? num(pay.received ?? pay.amount) : num(pay.amount);
      const change = pay.method === "dinheiro" ? Math.max(0, received - num(pay.amount)) : 0;
      await sql`
        insert into payments (company_id, sale_id, method, amount, received, change_amount, installments, brand)
        values (
          ${tenant.companyId}, ${saleId}, ${pay.method}, ${pay.amount}, ${received}, ${change},
          ${pay.installments ?? 1}, ${pay.brand ?? null}
        )
      `;
      if (pay.method === "crediario") {
        if (!customerId) throw new Error("Crediário exige cliente identificado.");
        const due = new Date();
        due.setDate(due.getDate() + 30);
        await sql`
          insert into accounts_receivable (
            company_id, store_id, customer_id, sale_id, description, due_date, amount, status, user_id
          ) values (
            ${tenant.companyId}, ${data.storeId}, ${customerId}, ${saleId},
            ${"Crediário venda nº " + number}, ${due.toISOString().slice(0, 10)}, ${pay.amount}, 'pendente', ${tenant.userId}
          )
        `;
      }
      if (reg) {
        await sql`
          insert into cash_movements (
            company_id, store_id, register_id, user_id, type, method, amount, description, sale_id
          ) values (
            ${tenant.companyId}, ${data.storeId}, ${reg.id}, ${tenant.userId}, 'venda', ${pay.method}, ${pay.amount},
            ${"Venda nº " + number}, ${saleId}
          )
        `;
      }
    }

    let commission: {
      amount: number;
      percent: number;
      note: string;
      lines: { productName: string; amount: number; percent: number; ruleName: string }[];
      volumeNote: string;
      bonusNote: string;
      net?: number;
      tax?: {
        net: number;
        totalTax: number;
        inss: number;
        irrf: number;
        iss: number;
        other: number;
        note: string;
        regime: string;
      };
    } | null = null;
    if (data.sellerId) {
      const [seller] = await sql<{ commission_pct: string | number; name: string }>`
        select commission_pct, name from sellers where id = ${data.sellerId} and company_id = ${tenant.companyId}
      `;
      const pct = num(seller?.commission_pct ?? 0);
      const primaryPay = data.payments.reduce(
        (best, p) => (num(p.amount) > num(best.amount) ? p : best),
        data.payments[0] ?? { method: "", amount: 0 },
      );
      const rules = await loadCommissionRules(sql, tenant.companyId);
      const monthRevenue = await sellerMonthRevenue(sql, tenant.companyId, data.sellerId, saleId);
      const targets = await loadSellerTargetBonuses(sql, tenant.companyId, data.sellerId, {
        storeId: data.storeId,
        excludeSaleId: saleId,
      });
      const result = computeCommission({
        sellerId: data.sellerId,
        sellerPercent: pct,
        sellerName: seller?.name ?? "vendedor",
        paymentMethod: primaryPay?.method ?? null,
        headerDiscount: headerDisc,
        monthRevenue,
        rules,
        items: lines.map((l) => ({
          productId: l.productId,
          productName: l.description,
          categoryId: l.categoryId,
          parentCategoryId: l.parentCategoryId,
          quantity: l.quantity,
          total: l.total,
          costTotal: Number((l.cost * l.quantity).toFixed(2)),
          discount: l.discount,
        })),
        targets,
      });
      if (result.amount > 0.009) {
        const tax = await taxForSeller(sql, tenant.companyId, data.sellerId, result.amount, {
          excludeSaleId: saleId,
        });
        const cols = taxInsert(tax);
        await sql`
          insert into commissions (
            company_id, seller_id, sale_id, amount, percent, status, rule_id, note, breakdown,
            net_amount, tax_inss, tax_irrf, tax_iss, tax_other, tax_breakdown
          )
          values (
            ${tenant.companyId}, ${data.sellerId}, ${saleId}, ${result.amount}, ${result.percent},
            'pendente', ${result.ruleId}, ${result.note}, ${JSON.stringify(result.lines)}::jsonb,
            ${cols.net}, ${cols.inss}, ${cols.irrf}, ${cols.iss}, ${cols.other}, ${cols.json}::jsonb
          )
        `;
        commission = {
          amount: result.amount,
          percent: result.percent,
          note: result.note,
          lines: result.lines.map((l) => ({
            productName: l.productName,
            amount: l.amount,
            percent: l.percent,
            ruleName: l.ruleName,
          })),
          volumeNote: result.volumeNote,
          bonusNote: result.bonusNote,
          net: tax.net,
          tax: {
            net: tax.net,
            totalTax: tax.totalTax,
            inss: tax.inss,
            irrf: tax.irrf,
            iss: tax.iss,
            other: tax.other,
            note: tax.note,
            regime: tax.regime,
          },
        };
      }
    }

    if (headerDisc > 0) {
      await audit(sql, tenant, "discount", "sale", saleId, null, { headerDisc, discPct });
    }
    await audit(sql, tenant, "create", "sale", saleId, null, { number, total });

    let sellerName: string | null = null;
    if (data.sellerId) {
      const [s] = await sql<{ name: string }>`select name from sellers where id = ${data.sellerId}`;
      sellerName = s?.name ?? null;
    }
    const [store] = await sql<{ name: string }>`select name from stores where id = ${data.storeId}`;

    return {
      id: saleId,
      number,
      total,
      subtotal,
      discount: headerDisc,
      soldAt: new Date().toISOString(),
      storeName: store?.name ?? null,
      customerName,
      customerDocument,
      sellerName,
      notes: data.notes ?? null,
      items: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        total: l.total,
      })),
      payments: data.payments.map((p) => ({ method: p.method, amount: num(p.amount) })),
      commission,
    };
  });

export const listSalesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { storeId?: number; sellerId?: number; from?: string; to?: string; q?: string; status?: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    return dump(await sql.query<Row>(
      `select s.id, s.number, s.status, s.total, s.discount, s.sold_at, s.cost_total, s.document,
              c.name as customer_name, sl.name as seller_name, st.name as store_name
         from sales s
         left join customers c on c.id = s.customer_id
         left join sellers sl on sl.id = s.seller_id
         join stores st on st.id = s.store_id
        where s.company_id = $1 and s.deleted_at is null
          and ($2::int is null or s.store_id = $2)
          and ($3::int is null or s.seller_id = $3)
          and ($4::date is null or s.sold_at >= $4::date)
          and ($5::date is null or s.sold_at < ($5::date + interval '1 day'))
          and ($6::text is null or s.status = $6)
          and ($7::text is null or cast(s.number as text) = $7 or lower(c.name) like $8
               or to_tsvector('simple', coalesce(c.name,'')) @@ to_tsquery('simple', $9)
               or c.name ilike ('%' || $7 || '%'))
        order by s.sold_at desc
        limit 200`,
      [
        tenant.companyId,
        data.storeId ?? null,
        data.sellerId ?? null,
        data.from ?? null,
        data.to ?? null,
        data.status ?? null,
        data.q?.trim() || null,
        data.q?.trim() ? prefixLike(data.q) : null,
        data.q?.trim() ? ftsPrefix(data.q) : "__none__:*",
      ],
    ));
  });

export const getSaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const [sale] = await sql.query<Row>(
      `select s.*, c.name as customer_name, sl.name as seller_name, st.name as store_name
         from sales s
         left join customers c on c.id = s.customer_id
         left join sellers sl on sl.id = s.seller_id
         join stores st on st.id = s.store_id
        where s.id = $1 and s.company_id = $2`,
      [data.id, tenant.companyId],
    );
    if (!sale) throw new Error("Venda não encontrada.");
    const items = await sql<Row>`select * from sale_items where sale_id = ${data.id}`;
    const payments = await sql<Row>`select * from payments where sale_id = ${data.id}`;
    const returned = await sql<{ sale_item_id: number; qty: string | number }>`
      select ri.sale_item_id, coalesce(sum(ri.quantity),0) as qty
        from return_items ri
        join returns r on r.id = ri.return_id
       where r.sale_id = ${data.id}
       group by ri.sale_item_id
    `;
    const retMap: Record<number, number> = {};
    for (const r of returned) retMap[num(r.sale_item_id)] = num(r.qty);
    const [comm] = await sql.query<Row>(
      `select c.amount, c.percent, c.status, c.note, c.breakdown, cr.name as rule_name,
              c.net_amount, c.tax_inss, c.tax_irrf, c.tax_iss, c.tax_other, c.tax_breakdown
         from commissions c
         left join commission_rules cr on cr.id = c.rule_id
        where c.sale_id = $1 and c.company_id = $2
        order by c.id desc limit 1`,
      [data.id, tenant.companyId],
    );
    return dump({
      sale,
      items: items.map((i) => ({
        id: num(i.id),
        variant_id: num(i.variant_id),
        product_id: num(i.product_id),
        description: String(i.description ?? ""),
        quantity: num(i.quantity),
        unit_price: num(i.unit_price),
        discount: num(i.discount),
        total: num(i.total),
        remaining_qty: num(i.quantity) - (retMap[num(i.id)] ?? 0),
      })),
      payments,
      commission: comm
        ? {
            amount: num(comm.amount),
            percent: num(comm.percent),
            status: String(comm.status ?? "pendente"),
            note: comm.note == null ? null : String(comm.note),
            ruleName: comm.rule_name == null ? null : String(comm.rule_name),
            lines: parseBreakdown(comm.breakdown),
            net: comm.net_amount == null ? num(comm.amount) : num(comm.net_amount),
            taxInss: num(comm.tax_inss),
            taxIrrf: num(comm.tax_irrf),
            taxIss: num(comm.tax_iss),
            taxOther: num(comm.tax_other),
            taxBreakdown: comm.tax_breakdown ?? null,
          }
        : null,
    });
  });

export const cancelSaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "pdv.cancel");
    const [sale] = await sql<{ id: number; status: string; store_id: number; number: number }>`
      select id, status, store_id, number from sales where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    if (!sale) throw new Error("Venda não encontrada.");
    if (sale.status === "cancelada") throw new Error("Venda já cancelada.");
    const items = await sql<{ variant_id: number; quantity: string | number }>`
      select variant_id, quantity from sale_items where sale_id = ${sale.id}
    `;
    for (const item of items) {
      await applyStockChange(sql, {
        companyId: tenant.companyId,
        storeId: sale.store_id,
        variantId: item.variant_id,
        delta: num(item.quantity),
        type: "devolucao",
        userId: tenant.userId,
        note: data.reason,
        referenceType: "sale",
        referenceId: sale.id,
        allowNegative: true,
      });
    }
    await sql`
      update sales set status = 'cancelada', cancelled_at = now(), cancel_reason = ${data.reason}
      where id = ${sale.id}
    `;
    await sql`
      update accounts_receivable set status = 'cancelado'
      where sale_id = ${sale.id} and status in ('pendente','parcial')
    `;
    await sql`
      update commissions set status = 'cancelado'
       where sale_id = ${sale.id} and company_id = ${tenant.companyId} and status = 'pendente'
    `;
    const [reg] = await sql<{ id: number }>`
      select id from cash_registers where store_id = ${sale.store_id} and status = 'open' limit 1
    `;
    if (reg) {
      await sql`
        insert into cash_movements (company_id, store_id, register_id, user_id, type, amount, description, sale_id)
        values (${tenant.companyId}, ${sale.store_id}, ${reg.id}, ${tenant.userId}, 'cancelamento', 0, ${"Cancelamento venda nº " + sale.number}, ${sale.id})
      `;
    }
    await sql`
      insert into notifications (company_id, kind, title, body, href)
      values (${tenant.companyId}, 'venda', ${"Venda nº " + sale.number + " cancelada"}, ${data.reason}, ${"/app/vendas?id=" + sale.id})
    `;
    await audit(sql, tenant, "cancel", "sale", sale.id, { status: sale.status }, { reason: data.reason });
    return { ok: true };
  });

export const createReturnFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      saleId: number;
      kind: "total" | "parcial" | "troca";
      reason: string;
      items: { saleItemId: number; variantId: number; quantity: number; amount: number }[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "returns.write");
    const [sale] = await sql<{ id: number; store_id: number; status: string; number: number }>`
      select id, store_id, status, number from sales where id = ${data.saleId} and company_id = ${tenant.companyId}
    `;
    if (!sale) throw new Error("Venda não encontrada.");
    if (sale.status === "cancelada") throw new Error("Venda cancelada não aceita devolução.");
    if (!data.items.length) throw new Error("Informe os itens a devolver.");
    const original = await sql<{
      id: number;
      variant_id: number;
      quantity: string | number;
      total: string | number;
    }>`
      select id, variant_id, quantity, total from sale_items where sale_id = ${sale.id}
    `;
    const already = await sql<{ sale_item_id: number; qty: string | number }>`
      select ri.sale_item_id, coalesce(sum(ri.quantity),0) as qty
        from return_items ri
        join returns r on r.id = ri.return_id
       where r.sale_id = ${sale.id}
       group by ri.sale_item_id
    `;
    const used: Record<number, number> = {};
    for (const r of already) used[num(r.sale_item_id)] = num(r.qty);
    for (const item of data.items) {
      if (item.quantity <= 0) throw new Error("Quantidade inválida.");
      const orig = original.find((o) => o.id === item.saleItemId);
      if (!orig) throw new Error("Item não pertence a esta venda.");
      const left = num(orig.quantity) - (used[item.saleItemId] ?? 0);
      if (item.quantity > left + 0.001) {
        throw new Error(`Quantidade acima do disponível para devolução (${left}).`);
      }
    }
    const total = Number(data.items.reduce((a, i) => a + i.amount, 0).toFixed(2));
    const [ret] = await sql<{ id: number }>`
      insert into returns (company_id, store_id, sale_id, user_id, kind, reason, total)
      values (${tenant.companyId}, ${sale.store_id}, ${sale.id}, ${tenant.userId}, ${data.kind}, ${data.reason}, ${total})
      returning id
    `;
    for (const item of data.items) {
      await sql`
        insert into return_items (company_id, return_id, sale_item_id, variant_id, quantity, amount)
        values (${tenant.companyId}, ${ret!.id}, ${item.saleItemId}, ${item.variantId}, ${item.quantity}, ${item.amount})
      `;
      await applyStockChange(sql, {
        companyId: tenant.companyId,
        storeId: sale.store_id,
        variantId: item.variantId,
        delta: item.quantity,
        type: "devolucao",
        userId: tenant.userId,
        note: data.reason,
        referenceType: "return",
        referenceId: ret!.id,
        allowNegative: true,
      });
    }
    const leftover = original.reduce((a, o) => {
      const back = data.items
        .filter((i) => i.saleItemId === o.id)
        .reduce((s, i) => s + i.quantity, 0);
      return a + Math.max(0, num(o.quantity) - (used[o.id] ?? 0) - back);
    }, 0);
    const kind = leftover <= 0.001 ? "total" : data.kind === "troca" ? "troca" : "parcial";
    if (kind !== data.kind) {
      await sql`update returns set kind = ${kind} where id = ${ret!.id}`;
    }
    const newStatus = kind === "total" ? "devolvida" : "devolvida_parcial";
    await sql`update sales set status = ${newStatus} where id = ${sale.id}`;
    if (kind === "total") {
      await sql`
        update commissions set status = 'cancelado'
         where sale_id = ${sale.id} and company_id = ${tenant.companyId} and status = 'pendente'
      `;
    } else {
      const origValue = original.reduce((a, o) => a + num(o.total), 0);
      const remainingValue = original.reduce((a, o) => {
        const qty = num(o.quantity);
        if (qty <= 0) return a;
        const unit = num(o.total) / qty;
        const back =
          (used[o.id] ?? 0) +
          data.items.filter((i) => i.saleItemId === o.id).reduce((s, i) => s + i.quantity, 0);
        return a + Math.max(0, qty - back) * unit;
      }, 0);
      const [pending] = await sql<{
        id: number;
        amount: string | number;
        breakdown: unknown;
        seller_id: number;
      }>`
        select id, amount, breakdown, seller_id from commissions
         where sale_id = ${sale.id} and company_id = ${tenant.companyId} and status = 'pendente'
         limit 1
      `;
      if (pending && origValue > 0) {
        const ratio = remainingValue / origValue;
        const next = Number((num(pending.amount) * ratio).toFixed(2));
        if (next <= 0.009) {
          await sql`update commissions set status = 'cancelado' where id = ${pending.id}`;
        } else {
          const lines = parseBreakdown(pending.breakdown).map((l) => ({
            ...l,
            amount: Number((l.amount * ratio).toFixed(2)),
            base: Number((l.base * ratio).toFixed(2)),
          }));
          const tax = await taxForSeller(sql, tenant.companyId, pending.seller_id, next, {
            excludeSaleId: sale.id,
          });
          const cols = taxInsert(tax);
          await sql`
            update commissions
               set amount = ${next},
                   breakdown = ${JSON.stringify(lines)}::jsonb,
                   net_amount = ${cols.net},
                   tax_inss = ${cols.inss},
                   tax_irrf = ${cols.irrf},
                   tax_iss = ${cols.iss},
                   tax_other = ${cols.other},
                   tax_breakdown = ${cols.json}::jsonb
             where id = ${pending.id}
          `;
        }
      }
    }

    const [ar] = await sql<{
      id: number;
      amount: string | number;
      received_amount: string | number;
      due_date: string;
    }>`
      select id, amount, received_amount, due_date from accounts_receivable
       where sale_id = ${sale.id} and company_id = ${tenant.companyId}
         and status in ('pendente','parcial','vencido')
       limit 1
    `;
    if (ar) {
      const nextAmt = Math.max(0, Number((num(ar.amount) - total).toFixed(2)));
      const received = num(ar.received_amount);
      const today = new Date().toISOString().slice(0, 10);
      const status =
        nextAmt <= 0.009
          ? "cancelado"
          : received + 0.009 >= nextAmt
            ? "pago"
            : String(ar.due_date).slice(0, 10) < today
              ? "vencido"
              : "pendente";
      await sql`
        update accounts_receivable set amount = ${nextAmt}, status = ${status}
        where id = ${ar.id}
      `;
    }

    const cashPaid = (
      await sql<{ v: string | number }>`
        select coalesce(sum(amount),0) as v from payments
         where sale_id = ${sale.id} and method = 'dinheiro'
      `
    )[0];
    const alreadyCash = (
      await sql<{ v: string | number }>`
        select coalesce(sum(amount),0) as v from cash_movements
         where sale_id = ${sale.id} and type in ('devolucao','cancelamento')
      `
    )[0];
    const cashRefund = Math.min(
      Math.max(0, num(cashPaid?.v) - num(alreadyCash?.v)),
      total,
    );
    if (cashRefund > 0.009) {
      const [reg] = await sql<{ id: number }>`
        select id from cash_registers where store_id = ${sale.store_id} and status = 'open' limit 1
      `;
      if (reg) {
        await sql`
          insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description, sale_id)
          values (${tenant.companyId}, ${sale.store_id}, ${reg.id}, ${tenant.userId}, 'devolucao', 'dinheiro', ${cashRefund}, ${"Devolução venda nº " + sale.number}, ${sale.id})
        `;
      }
    }

    await sql`
      insert into notifications (company_id, kind, title, body, href)
      values (
        ${tenant.companyId}, 'venda',
        ${"Devolução na venda nº " + sale.number},
        ${data.reason},
        ${"/app/devolucoes"}
      )
    `;
    await audit(sql, tenant, "create", "return", ret!.id, null, { saleId: sale.id, total, kind });
    return { id: ret!.id, kind, total };
  });

export const listReturnsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    return dump(await sql<Row>`
      select r.*, s.number as sale_number
      from returns r
      join sales s on s.id = r.sale_id
      where r.company_id = ${tenant.companyId}
      order by r.created_at desc
      limit 100
    `);
  });

export type HeldPayload = {
  cart: LineHold[];
  headerDisc: number;
  customerId: number | null;
  sellerId: number | null;
  notes: string;
};

type LineHold = {
  variantId: number;
  qty: number;
  lineDiscount: number;
  override?: number;
  promoName?: string | null;
  productId: number;
  name: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  color: string | null;
  size: string | null;
  model: string | null;
  price: number;
  listPrice: number;
  cost: number;
  unit: string;
  stock: number;
  imageUrl: string | null;
};

export const holdSaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      storeId: number;
      customerId?: number | null;
      sellerId?: number | null;
      notes?: string;
      discount?: number;
      payloadJson: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "pdv.sell");
    await assertStore(sql, tenant.companyId, data.storeId);
    let parsed: HeldPayload;
    try {
      parsed = JSON.parse(data.payloadJson) as HeldPayload;
    } catch {
      throw new Error("Carrinho inválido.");
    }
    if (!parsed.cart?.length) throw new Error("Não há itens para guardar.");
    const [row] = await sql<{ id: number }>`
      insert into held_sales (
        company_id, store_id, user_id, customer_id, seller_id, notes, discount, payload
      ) values (
        ${tenant.companyId}, ${data.storeId}, ${tenant.userId}, ${data.customerId ?? null},
        ${data.sellerId ?? null}, ${data.notes ?? null}, ${data.discount ?? 0}, ${data.payloadJson}
      )
      returning id
    `;
    return { id: row!.id };
  });

export const listHeldFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    await assertStore(sql, tenant.companyId, data.storeId);
    const rows = await sql<Row>`
      select h.id, h.created_at, h.discount, h.notes, h.payload, c.name as customer_name, s.name as seller_name
        from held_sales h
        left join customers c on c.id = h.customer_id
        left join sellers s on s.id = h.seller_id
       where h.company_id = ${tenant.companyId} and h.store_id = ${data.storeId}
       order by h.created_at desc
       limit 40
    `;
    return rows.map((r) => {
      let items = 0;
      try {
        const p = JSON.parse(String(r.payload ?? "{}")) as HeldPayload;
        items = Array.isArray(p.cart) ? p.cart.length : 0;
      } catch {
        items = 0;
      }
      return {
        id: num(r.id),
        createdAt: String(r.created_at ?? ""),
        customerName: r.customer_name == null ? null : String(r.customer_name),
        sellerName: r.seller_name == null ? null : String(r.seller_name),
        notes: r.notes == null ? null : String(r.notes),
        items,
      };
    });
  });

export const resumeHeldFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "pdv.sell");
    const [row] = await sql<Row>`
      select * from held_sales
       where id = ${data.id} and company_id = ${tenant.companyId} and store_id = ${data.storeId}
    `;
    if (!row) throw new Error("Venda em espera não encontrada.");
    await sql`delete from held_sales where id = ${data.id} and company_id = ${tenant.companyId}`;
    return {
      id: num(row.id),
      customerId: row.customer_id == null ? null : num(row.customer_id),
      sellerId: row.seller_id == null ? null : num(row.seller_id),
      notes: row.notes == null ? "" : String(row.notes),
      discount: num(row.discount),
      payloadJson: String(row.payload ?? "{}"),
    };
  });

export const discardHeldFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "pdv.sell");
    await sql`delete from held_sales where id = ${data.id} and company_id = ${tenant.companyId}`;
    return { ok: true as const };
  });

export const listPromotionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const rows = await sql<Row>`select * from promotions where company_id = ${tenant.companyId} order by created_at desc`;
    return rows.map(mapPromo);
  });

export const savePromotionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      kind: string;
      percent?: number | null;
      amount?: number | null;
      promoPrice?: number | null;
      buyQty?: number | null;
      payQty?: number | null;
      minQty?: number | null;
      productId?: number | null;
      categoryId?: number | null;
      startsAt: string;
      endsAt: string;
      isActive?: boolean;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "promotions.write");
    if (data.id) {
      await sql`
        update promotions set name = ${data.name}, kind = ${data.kind}, percent = ${data.percent ?? null},
          amount = ${data.amount ?? null}, promo_price = ${data.promoPrice ?? null},
          buy_qty = ${data.buyQty ?? null}, pay_qty = ${data.payQty ?? null}, min_qty = ${data.minQty ?? null},
          product_id = ${data.productId ?? null}, category_id = ${data.categoryId ?? null},
          starts_at = ${data.startsAt}, ends_at = ${data.endsAt}, is_active = ${data.isActive ?? true}
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into promotions (
        company_id, name, kind, percent, amount, promo_price, buy_qty, pay_qty, min_qty,
        product_id, category_id, starts_at, ends_at, is_active
      ) values (
        ${tenant.companyId}, ${data.name}, ${data.kind}, ${data.percent ?? null}, ${data.amount ?? null},
        ${data.promoPrice ?? null}, ${data.buyQty ?? null}, ${data.payQty ?? null}, ${data.minQty ?? null},
        ${data.productId ?? null}, ${data.categoryId ?? null}, ${data.startsAt}, ${data.endsAt}, ${data.isActive ?? true}
      ) returning id
    `;
    return { id: row!.id };
  });
