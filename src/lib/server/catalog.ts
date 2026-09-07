import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { assertStore, audit, nextNumber, requireTenant } from "./context";
import { applyStockChange } from "./stock";
import { parseBarcode } from "@/lib/check-digit";
import { dump, type Row } from "@/lib/json";
import { ftsPrefix, prefixLike } from "@/lib/search";
import {
  optionalLine,
  requireLine,
  sanitizeCode,
  sanitizeHttpUrl,
  sanitizeLine,
  sanitizeMultiline,
} from "@/lib/sanitize";

export const listCategoriesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    return sql<{ id: number; name: string; parent_id: number | null }>`
      select id, name, parent_id from categories where company_id = ${tenant.companyId} order by name
    `;
  });

export const saveCategoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; parentId?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "products.write");
    const [row] = await sql<{ id: number }>`
      insert into categories (company_id, name, parent_id)
      values (${tenant.companyId}, ${data.name.trim()}, ${data.parentId ?? null})
      returning id
    `;
    return row;
  });

export const listBrandsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    return sql<{ id: number; name: string }>`
      select id, name from brands where company_id = ${tenant.companyId} order by name
    `;
  });

export const listProductsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; categoryId?: number; active?: boolean; storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const params: unknown[] = [tenant.companyId];
    const raw = data.q?.trim() || "";
    let extra = "";
    if (raw) {
      params.push(raw, prefixLike(raw), ftsPrefix(raw));
      const exact = params.length - 2;
      const pref = params.length - 1;
      const fts = params.length;
      extra += ` and (
        p.sku = $${exact} or p.barcode = $${exact} or p.internal_code = $${exact}
        or lower(p.name) like $${pref} or lower(coalesce(p.sku,'')) like $${pref}
        or to_tsvector('simple', coalesce(p.name,'')) @@ to_tsquery('simple', $${fts})
        or p.name ilike ('%' || $${exact} || '%')
      )`;
    }
    if (data.categoryId != null) {
      params.push(data.categoryId);
      extra += ` and p.category_id = $${params.length}`;
    }
    if (data.active != null) {
      params.push(data.active);
      extra += ` and p.is_active = $${params.length}`;
    }
    let stockJoin = `
         left join (
           select v.product_id, sum(i.quantity) as stock
             from product_variants v
             join inventories i on i.variant_id = v.id and i.company_id = v.company_id
            where v.company_id = $1 and v.deleted_at is null`;
    if (data.storeId != null) {
      params.push(data.storeId);
      stockJoin += ` and i.store_id = $${params.length}`;
    }
    stockJoin += `
            group by v.product_id
         ) st on st.product_id = p.id`;
    const rows = await sql.query<Row>(
      `select p.id, p.internal_code, p.barcode, p.sku, p.name, p.unit, p.cost, p.price, p.promo_price,
              p.min_stock, p.is_active, p.has_variants, p.location, p.image_url,
              c.name as category, b.name as brand,
              coalesce(st.stock, 0) as stock
         from products p
         left join categories c on c.id = p.category_id
         left join brands b on b.id = p.brand_id
         ${stockJoin}
        where p.company_id = $1 and p.deleted_at is null
          ${extra}
        order by p.name
        limit 200`,
      params,
    );
    return rows.map((r) => ({
      id: num(r.id),
      internalCode: strN(r.internal_code),
      barcode: strN(r.barcode),
      sku: strN(r.sku),
      name: String(r.name),
      unit: String(r.unit ?? "UN"),
      cost: num(r.cost),
      price: num(r.price),
      promoPrice: r.promo_price == null ? null : num(r.promo_price),
      minStock: num(r.min_stock),
      isActive: Boolean(r.is_active),
      hasVariants: Boolean(r.has_variants),
      location: strN(r.location),
      imageUrl: strN(r.image_url),
      category: strN(r.category),
      brand: strN(r.brand),
      stock: num(r.stock),
    }));
  });

function strN(v: unknown): string | null {
  return v == null || v === "" ? null : String(v);
}

export const getProductFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const products = await sql<Row>`select * from products where id = ${data.id} and company_id = ${tenant.companyId}`;
    const product = products[0];
    if (!product) throw new Error("Produto não encontrado.");
    const vParams: unknown[] = [data.id, tenant.companyId];
    let invJoin = `left join inventories i on i.variant_id = v.id and i.company_id = v.company_id`;
    if (data.storeId != null) {
      vParams.push(data.storeId);
      invJoin += ` and i.store_id = $${vParams.length}`;
    }
    const variants = await sql.query<Row>(
      `select v.*, coalesce(i.quantity,0) as stock, coalesce(i.min_stock,0) as inv_min, i.location as inv_location
         from product_variants v
         ${invJoin}
        where v.product_id = $1 and v.company_id = $2 and v.deleted_at is null
        order by v.id`,
      vParams,
    );
    return dump({ product, variants });
  });

export const saveProductFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      internalCode?: string;
      barcode?: string;
      sku?: string;
      description?: string;
      categoryId?: number | null;
      brandId?: string | number | null;
      brandName?: string;
      supplierId?: number | null;
      unit?: string;
      cost: number;
      price: number;
      promoPrice?: number | null;
      minStock?: number;
      location?: string;
      imageUrl?: string | null;
      isActive?: boolean;
      variants?: { id?: number; sku?: string; barcode?: string; color?: string; size?: string; model?: string; cost?: number; price?: number }[];
    }) => ({
      ...d,
      name: requireLine(d.name, "Nome"),
      internalCode: sanitizeCode(d.internalCode) ?? undefined,
      barcode: parseBarcode(d.barcode) ?? undefined,
      sku: sanitizeCode(d.sku) ?? undefined,
      description: sanitizeMultiline(d.description, 2000) ?? undefined,
      brandName: optionalLine(d.brandName, 80) ?? undefined,
      unit: sanitizeLine(d.unit ?? "UN", 8) || "UN",
      location: optionalLine(d.location, 80) ?? undefined,
      imageUrl: sanitizeHttpUrl(d.imageUrl),
      variants: d.variants?.map((v) => ({
        ...v,
        sku: sanitizeCode(v.sku) ?? undefined,
        barcode: parseBarcode(v.barcode) ?? undefined,
        color: optionalLine(v.color, 40) ?? undefined,
        size: optionalLine(v.size, 20) ?? undefined,
        model: optionalLine(v.model, 40) ?? undefined,
      })),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "products.write");
    if (data.barcode) {
      const dup = await sql<{ id: number }>`
        select id from products
        where company_id = ${tenant.companyId} and barcode = ${data.barcode}
          and deleted_at is null and id <> ${data.id ?? 0}
        limit 1
      `;
      if (dup.length) throw new Error("Já existe um produto com este código de barras.");
    }
    let brandId = data.brandId ? num(data.brandId) : null;
    if (!brandId && data.brandName?.trim()) {
      const [b] = await sql<{ id: number }>`
        insert into brands (company_id, name) values (${tenant.companyId}, ${data.brandName.trim()}) returning id
      `;
      brandId = b!.id;
    }
    let productId = data.id;
    const hasVariants = Boolean(data.variants && data.variants.length > 0);
    if (productId) {
      await sql`
        update products set
          name = ${data.name}, internal_code = ${data.internalCode ?? null}, barcode = ${data.barcode ?? null},
          sku = ${data.sku ?? null}, description = ${data.description ?? null},
          category_id = ${data.categoryId ?? null}, brand_id = ${brandId}, supplier_id = ${data.supplierId ?? null},
          unit = ${data.unit ?? "UN"}, cost = ${data.cost}, price = ${data.price},
          promo_price = ${data.promoPrice ?? null}, min_stock = ${data.minStock ?? 0},
          location = ${data.location ?? null}, image_url = ${data.imageUrl ?? null},
          is_active = ${data.isActive ?? true},
          has_variants = ${hasVariants}, updated_at = now()
        where id = ${productId} and company_id = ${tenant.companyId}
      `;
    } else {
      const [row] = await sql<{ id: number }>`
        insert into products (
          company_id, internal_code, barcode, sku, name, description, category_id, brand_id, supplier_id,
          unit, cost, price, promo_price, min_stock, location, image_url, is_active, has_variants
        ) values (
          ${tenant.companyId}, ${data.internalCode ?? null}, ${data.barcode ?? null}, ${data.sku ?? null},
          ${data.name}, ${data.description ?? null}, ${data.categoryId ?? null}, ${brandId}, ${data.supplierId ?? null},
          ${data.unit ?? "UN"}, ${data.cost}, ${data.price}, ${data.promoPrice ?? null}, ${data.minStock ?? 0},
          ${data.location ?? null}, ${data.imageUrl ?? null}, ${data.isActive ?? true}, ${hasVariants}
        ) returning id
      `;
      productId = row!.id;
    }
    if (hasVariants && data.variants) {
      for (const v of data.variants) {
        if (v.id) {
          await sql`
            update product_variants set sku = ${v.sku ?? null}, barcode = ${v.barcode ?? null},
              color = ${v.color ?? null}, size = ${v.size ?? null}, model = ${v.model ?? null},
              cost = ${v.cost ?? data.cost}, price = ${v.price ?? data.price}
            where id = ${v.id} and company_id = ${tenant.companyId}
          `;
        } else {
          await sql`
            insert into product_variants (company_id, product_id, sku, barcode, color, size, model, cost, price)
            values (${tenant.companyId}, ${productId}, ${v.sku ?? null}, ${v.barcode ?? null}, ${v.color ?? null}, ${v.size ?? null}, ${v.model ?? null}, ${v.cost ?? data.cost}, ${v.price ?? data.price})
          `;
        }
      }
    } else {
      const existing = await sql<{ id: number }>`
        select id from product_variants where product_id = ${productId} and company_id = ${tenant.companyId} and deleted_at is null
      `;
      if (!existing.length) {
        await sql`
          insert into product_variants (company_id, product_id, sku, barcode, cost, price)
          values (${tenant.companyId}, ${productId}, ${data.sku ?? null}, ${data.barcode ?? null}, ${data.cost}, ${data.price})
        `;
      } else {
        await sql`
          update product_variants set sku = ${data.sku ?? null}, barcode = ${data.barcode ?? null}, cost = ${data.cost}, price = ${data.price}
          where id = ${existing[0]!.id}
        `;
      }
    }
    await audit(sql, tenant, data.id ? "update" : "create", "product", productId, null, { name: data.name });
    return { id: productId };
  });

export const searchPosFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q: string; storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    await assertStore(sql, tenant.companyId, data.storeId);
    const q = data.q.trim();
    if (!q) return [];
    const rows = await sql.query<Row>(
      `select v.id as variant_id, p.id as product_id, p.name, v.color, v.size, v.model,
              coalesce(v.sku, p.sku) as sku, coalesce(v.barcode, p.barcode) as barcode,
              coalesce(v.price, p.price) as price, p.promo_price, coalesce(v.cost, p.cost) as cost,
              p.unit, coalesce(i.quantity,0) as stock, p.category_id, c.parent_id as category_parent_id,
              p.image_url
         from product_variants v
         join products p on p.id = v.product_id
         left join categories c on c.id = p.category_id
         left join inventories i on i.variant_id = v.id and i.store_id = $3
        where v.company_id = $1 and p.deleted_at is null and v.deleted_at is null and p.is_active = true and v.is_active = true
          and (
            v.barcode = $2
            or p.barcode = $2
            or v.sku = $2
            or p.sku = $2
            or p.internal_code = $2
            or lower(p.name) like $4
            or lower(coalesce(v.sku,'')) like $4
            or to_tsvector('simple', coalesce(p.name,'')) @@ to_tsquery('simple', $5)
            or p.name ilike ('%' || $2 || '%')
          )
        order by
          case when v.barcode = $2 or p.barcode = $2 then 0
               when v.sku = $2 or p.sku = $2 then 1
               else 2 end,
          p.name
        limit 30`,
      [tenant.companyId, q, data.storeId, prefixLike(q), ftsPrefix(q)],
    );
    return rows.map((r) => ({
      variantId: num(r.variant_id),
      productId: num(r.product_id),
      name: String(r.name),
      color: strN(r.color),
      size: strN(r.size),
      model: strN(r.model),
      sku: strN(r.sku),
      barcode: strN(r.barcode),
      price: num(r.promo_price) > 0 ? num(r.promo_price) : num(r.price),
      listPrice: num(r.price),
      cost: num(r.cost),
      unit: String(r.unit ?? "UN"),
      stock: num(r.stock),
      categoryId: r.category_id == null ? null : num(r.category_id),
      parentCategoryId: r.category_parent_id == null ? null : num(r.category_parent_id),
      imageUrl: strN(r.image_url),
      label: [r.name, r.color, r.size].filter(Boolean).join(" · "),
    }));
  });

export const listStockFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; q?: string; filter?: "all" | "low" | "zero" | "stale" }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const params: unknown[] = [tenant.companyId];
    let storeSql = "";
    if (data.storeId != null) {
      params.push(data.storeId);
      storeSql = ` and i.store_id = $${params.length}`;
    }
    const raw = data.q?.trim() || "";
    let qSql = "";
    if (raw) {
      params.push(raw, prefixLike(raw), ftsPrefix(raw));
      qSql = ` and (
        p.sku = $${params.length - 2} or v.barcode = $${params.length - 2} or p.barcode = $${params.length - 2}
        or lower(p.name) like $${params.length - 1} or lower(coalesce(p.sku,'')) like $${params.length - 1}
        or to_tsvector('simple', coalesce(p.name,'')) @@ to_tsquery('simple', $${params.length})
        or p.name ilike ('%' || $${params.length - 2} || '%')
      )`;
    }
    const rows = await sql.query<Row>(
      `select v.id as variant_id, p.id as product_id, p.name, v.color, v.size, p.sku, p.min_stock,
              p.location, coalesce(i.quantity,0) as quantity, i.store_id, s.name as store_name,
              coalesce(v.cost, p.cost) as cost, coalesce(v.price, p.price) as price,
              lm.last_move
         from product_variants v
         join products p on p.id = v.product_id
         left join inventories i on i.variant_id = v.id and i.company_id = v.company_id
         left join stores s on s.id = i.store_id
         left join (
           select variant_id, max(created_at) as last_move
             from stock_movements
            where company_id = $1
            group by variant_id
         ) lm on lm.variant_id = v.id
        where v.company_id = $1 and p.deleted_at is null and v.deleted_at is null
          ${storeSql}
          ${qSql}
        order by p.name, v.id
        limit 400`,
      params,
    );
    let list = rows.map((r) => ({
      variantId: num(r.variant_id),
      productId: num(r.product_id),
      name: String(r.name),
      color: strN(r.color),
      size: strN(r.size),
      sku: strN(r.sku),
      minStock: num(r.min_stock),
      location: strN(r.location),
      quantity: num(r.quantity),
      storeId: r.store_id == null ? null : num(r.store_id),
      storeName: strN(r.store_name),
      cost: num(r.cost),
      price: num(r.price),
      lastMove: r.last_move ? String(r.last_move) : null,
    }));
    if (data.filter === "low") list = list.filter((r) => r.quantity <= r.minStock && r.minStock > 0);
    if (data.filter === "zero") list = list.filter((r) => r.quantity <= 0);
    if (data.filter === "stale") {
      const cut = Date.now() - 1000 * 60 * 60 * 24 * 45;
      list = list.filter((r) => !r.lastMove || new Date(r.lastMove).getTime() < cut);
    }
    return list;
  });

export const listMovementsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; variantId?: number; type?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    return dump(await sql.query<Row>(
      `select m.id, m.quantity, m.previous_qty, m.new_qty, m.type, m.user_id, m.note, m.created_at,
              p.name, v.color, v.size, s.name as store_name
         from stock_movements m
         join product_variants v on v.id = m.variant_id
         join products p on p.id = v.product_id
         join stores s on s.id = m.store_id
        where m.company_id = $1
          and ($2::int is null or m.store_id = $2)
          and ($3::int is null or m.variant_id = $3)
          and ($4::text is null or m.type = $4)
        order by m.created_at desc
        limit 200`,
      [tenant.companyId, data.storeId ?? null, data.variantId ?? null, data.type ?? null],
    ));
  });

export const adjustStockFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      storeId: number;
      variantId: number;
      type: "entrada" | "saida" | "ajuste" | "perda";
      quantity: number;
      note: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");
    await assertStore(sql, tenant.companyId, data.storeId);
    if (data.quantity <= 0) throw new Error("Informe uma quantidade maior que zero.");
    const delta = data.type === "entrada" || data.type === "ajuste" ? data.quantity : -Math.abs(data.quantity);
    const res = await applyStockChange(sql, {
      companyId: tenant.companyId,
      storeId: data.storeId,
      variantId: data.variantId,
      delta,
      type: data.type,
      userId: tenant.userId,
      note: data.note,
      allowNegative: data.type === "ajuste",
    });
    await audit(sql, tenant, "stock.adjust", "inventory", data.variantId, null, { ...data, ...res });
    return res;
  });

export const transferStockFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { fromStoreId: number; toStoreId: number; variantId: number; quantity: number; note?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");
    if (data.fromStoreId === data.toStoreId) throw new Error("Selecione lojas diferentes.");
    await assertStore(sql, tenant.companyId, data.fromStoreId);
    await assertStore(sql, tenant.companyId, data.toStoreId);
    await applyStockChange(sql, {
      companyId: tenant.companyId,
      storeId: data.fromStoreId,
      variantId: data.variantId,
      delta: -Math.abs(data.quantity),
      type: "transferencia",
      userId: tenant.userId,
      note: data.note ?? "Transferência entre lojas",
    });
    await applyStockChange(sql, {
      companyId: tenant.companyId,
      storeId: data.toStoreId,
      variantId: data.variantId,
      delta: Math.abs(data.quantity),
      type: "transferencia",
      userId: tenant.userId,
      note: data.note ?? "Transferência entre lojas",
      allowNegative: true,
    });
    return { ok: true };
  });

export const listPurchasesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const rows = await sql.query<Row>(
      `select p.*, s.legal_name as supplier_name, st.name as store_name
         from purchases p
         left join suppliers s on s.id = p.supplier_id
         join stores st on st.id = p.store_id
        where p.company_id = $1 and p.deleted_at is null
          and ($2::int is null or p.store_id = $2)
          and ($3::text is null or p.status = $3)
        order by p.created_at desc
        limit 100`,
      [tenant.companyId, data.storeId ?? null, data.status ?? null],
    );
    return rows.map((r) => ({
      id: num(r.id),
      number: num(r.number),
      status: String(r.status ?? ""),
      total: num(r.total),
      freight: num(r.freight),
      supplierId: r.supplier_id == null ? null : num(r.supplier_id),
      supplierName: r.supplier_name == null ? null : String(r.supplier_name),
      storeName: r.store_name == null ? null : String(r.store_name),
      expectedAt: r.expected_at == null ? null : String(r.expected_at),
      receivedAt: r.received_at == null ? null : String(r.received_at),
      createdAt: String(r.created_at ?? ""),
      notes: r.notes == null ? null : String(r.notes),
    }));
  });

export const getPurchaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const [purchase] = await sql<Row>`
      select p.*, s.legal_name as supplier_name, s.trade_name as supplier_trade, st.name as store_name
        from purchases p
        left join suppliers s on s.id = p.supplier_id
        join stores st on st.id = p.store_id
       where p.id = ${data.id} and p.company_id = ${tenant.companyId}
    `;
    if (!purchase) throw new Error("Pedido não encontrado.");
    const items = await sql<Row>`select * from purchase_items where purchase_id = ${data.id}`;
    return dump({
      purchase: {
        id: num(purchase.id),
        number: num(purchase.number),
        status: String(purchase.status ?? ""),
        supplierId: purchase.supplier_id == null ? null : num(purchase.supplier_id),
        supplierName: purchase.supplier_trade
          ? String(purchase.supplier_trade)
          : purchase.supplier_name == null
            ? null
            : String(purchase.supplier_name),
        storeId: num(purchase.store_id),
        storeName: purchase.store_name == null ? null : String(purchase.store_name),
        subtotal: num(purchase.subtotal),
        discount: num(purchase.discount),
        freight: num(purchase.freight),
        tax: num(purchase.tax),
        total: num(purchase.total),
        notes: purchase.notes == null ? null : String(purchase.notes),
        expectedAt: purchase.expected_at == null ? null : String(purchase.expected_at),
        receivedAt: purchase.received_at == null ? null : String(purchase.received_at),
        createdAt: String(purchase.created_at ?? ""),
      },
      items: items.map((i) => ({
        id: num(i.id),
        description: String(i.description ?? ""),
        quantity: num(i.quantity),
        unitCost: num(i.unit_cost),
        total: num(i.total),
      })),
    });
  });

export const savePurchaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      storeId: number;
      supplierId?: number | null;
      status: string;
      notes?: string;
      freight?: number;
      tax?: number;
      discount?: number;
      expectedAt?: string | null;
      items: { variantId: number; productId: number; description: string; quantity: number; unitCost: number }[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.write");
    await assertStore(sql, tenant.companyId, data.storeId);
    const subtotal = data.items.reduce((a, i) => a + i.quantity * i.unitCost, 0);
    const total = subtotal - (data.discount ?? 0) + (data.freight ?? 0) + (data.tax ?? 0);
    let id = data.id;
    if (id) {
      const cur = await sql<{ status: string }>`select status from purchases where id = ${id} and company_id = ${tenant.companyId}`;
      if (!cur[0] || cur[0].status === "recebido") throw new Error("Pedido não pode ser alterado.");
      await sql`
        update purchases set supplier_id = ${data.supplierId ?? null}, status = ${data.status}, notes = ${data.notes ?? null},
          subtotal = ${subtotal}, discount = ${data.discount ?? 0}, freight = ${data.freight ?? 0}, tax = ${data.tax ?? 0},
          total = ${total}, expected_at = ${data.expectedAt ?? null}, updated_at = now()
        where id = ${id} and company_id = ${tenant.companyId}
      `;
      await sql`delete from purchase_items where purchase_id = ${id}`;
    } else {
      const number = await nextNumber(sql, tenant.companyId, "purchase");
      const [row] = await sql<{ id: number }>`
        insert into purchases (
          company_id, store_id, supplier_id, number, status, notes, subtotal, discount, freight, tax, total, expected_at, user_id
        ) values (
          ${tenant.companyId}, ${data.storeId}, ${data.supplierId ?? null}, ${number}, ${data.status}, ${data.notes ?? null},
          ${subtotal}, ${data.discount ?? 0}, ${data.freight ?? 0}, ${data.tax ?? 0}, ${total}, ${data.expectedAt ?? null}, ${tenant.userId}
        ) returning id
      `;
      id = row!.id;
    }
    for (const item of data.items) {
      await sql`
        insert into purchase_items (company_id, purchase_id, variant_id, product_id, description, quantity, unit_cost, total)
        values (${tenant.companyId}, ${id}, ${item.variantId}, ${item.productId}, ${item.description}, ${item.quantity}, ${item.unitCost}, ${item.quantity * item.unitCost})
      `;
    }
    return { id };
  });

export const receivePurchaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.receive");
    const [p] = await sql<{ id: number; status: string; store_id: number; supplier_id: number | null; total: string | number; number: number }>`
      select id, status, store_id, supplier_id, total, number from purchases where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    if (!p) throw new Error("Pedido não encontrado.");
    if (p.status === "recebido") throw new Error("Pedido já recebido.");
    if (p.status === "cancelado") throw new Error("Pedido cancelado.");
    const items = await sql<{ variant_id: number; product_id: number; quantity: string | number; unit_cost: string | number }>`
      select variant_id, product_id, quantity, unit_cost from purchase_items where purchase_id = ${p.id}
    `;
    for (const item of items) {
      await applyStockChange(sql, {
        companyId: tenant.companyId,
        storeId: p.store_id,
        variantId: item.variant_id,
        delta: num(item.quantity),
        type: "compra",
        userId: tenant.userId,
        referenceType: "purchase",
        referenceId: p.id,
        allowNegative: true,
      });
      await sql`
        update products set cost = ${num(item.unit_cost)}, updated_at = now()
        where id = ${item.product_id} and company_id = ${tenant.companyId}
      `;
      await sql`
        update product_variants set cost = ${num(item.unit_cost)}
        where id = ${item.variant_id} and company_id = ${tenant.companyId}
      `;
    }
    await sql`
      update purchases set status = 'recebido', received_at = now(), updated_at = now()
      where id = ${p.id}
    `;
    await sql`
      insert into accounts_payable (
        company_id, store_id, supplier_id, purchase_id, description, category, due_date, amount, status, user_id
      ) values (
        ${tenant.companyId}, ${p.store_id}, ${p.supplier_id}, ${p.id},
        ${"Compra nº " + p.number}, 'Compras', current_date + 14, ${num(p.total)}, 'pendente', ${tenant.userId}
      )
    `;
    await audit(sql, tenant, "receive", "purchase", p.id);
    return { ok: true };
  });
