import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan, can } from "@/lib/permissions";
import { ncmValidSql, parseNcm } from "@/lib/ncm";
import { num } from "@/lib/utils";
import { assertOwned, assertStore, assertVariants, audit, nextNumber, requireTenant } from "./context";
import { applyStockChange } from "./stock";
import { parseBarcode } from "@/lib/check-digit";
import { parsePurchaseExtra, parseStockQuantity, parseUnitCost } from "@/lib/stock-input";
import { dump, type Row } from "@/lib/json";
import { PURCHASE_STATUS } from "@/lib/constants";
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
    await assertOwned(sql, tenant.companyId, "categories", data.parentId);
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
    assertCan(tenant.role, "products.read");
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
              p.min_stock, p.is_active, p.has_variants, p.location, p.image_url, p.ncm, p.cfop,
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
      ncm: strN(r.ncm),
      cfop: strN(r.cfop),
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
    assertCan(tenant.role, "products.read");
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
      ncm?: string;
      cfop?: string;
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
      // parseNcm e nao sanitizeCode: o sanitize so cortava em 8 caracteres,
      // entao "abc" virava NCM valido no banco e so explodia na recusa do
      // SEFAZ, no balcao, com o cliente esperando a nota.
      ncm: parseNcm(d.ncm) ?? undefined,
      cfop: sanitizeCode(d.cfop, 4) ?? undefined,
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
    // `data.id` faltava aqui -- as outras tres chaves estrangeiras (marca,
    // categoria, fornecedor) ja eram conferidas, mas o PROPRIO produto sendo
    // editado nao. O update logo abaixo ja e escopado por company_id (nao
    // altera produto de outra empresa), mas nao verificava se alterou
    // alguma linha: `productId = data.id` seguia valendo mesmo quando o
    // update nao encontrou nada, e a criacao de variante (mais abaixo, no
    // caminho sem `data.variants`) usa esse `productId` como FK sem checar
    // dono nenhum. Resultado: enviar o id de um produto de OUTRA empresa,
    // sem variantes no payload, criava uma linha em product_variants com
    // company_id da empresa que enviou o pedido mas product_id apontando pro
    // produto alheio -- um join variante->produto (o mesmo que
    // checkoutFn/searchPosFn fazem) passava a mostrar nome/preco/custo do
    // produto de outra empresa dentro do catalogo de quem nao e dono dele.
    // Verificado com transacao revertida antes desta correcao.
    await assertOwned(sql, tenant.companyId, "products", data.id);
    await assertOwned(sql, tenant.companyId, "brands", data.brandId ? num(data.brandId) : null);
    await assertOwned(sql, tenant.companyId, "categories", data.categoryId);
    await assertOwned(sql, tenant.companyId, "suppliers", data.supplierId);

    /*
      Produto, marca, variantes e auditoria numa transacao so.

      Sao ate sete escritas em sequencia. Uma falha no meio deixava um
      PRODUTO SEM VARIANTE: aparece na lista de produtos, nao aparece na
      busca do PDV (que procura variante) e nao tem estoque -- um item que
      existe pra quem cadastra e nao existe pra quem vende. O conserto e
      abrir e salvar de novo, mas so depois de alguem descobrir, e a
      descoberta costuma ser um cliente no balcao.

      O parametro se chama `sql` de proposito: sombrear o de fora mantem o
      corpo inteiro inalterado. Trocar ~40 referencias a mao pra ganhar um
      nome diferente seria arriscar o que ja funciona por estetica.
    */
    return sql.transaction(async (sql) => {
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
            ncm = ${data.ncm ?? null}, cfop = ${data.cfop ?? "5102"},
            has_variants = ${hasVariants}, updated_at = now()
          where id = ${productId} and company_id = ${tenant.companyId}
        `;
      } else {
        const [row] = await sql<{ id: number }>`
          insert into products (
            company_id, internal_code, barcode, sku, name, description, category_id, brand_id, supplier_id,
            unit, cost, price, promo_price, min_stock, location, image_url, is_active, has_variants, ncm, cfop
          ) values (
            ${tenant.companyId}, ${data.internalCode ?? null}, ${data.barcode ?? null}, ${data.sku ?? null},
            ${data.name}, ${data.description ?? null}, ${data.categoryId ?? null}, ${brandId}, ${data.supplierId ?? null},
            ${data.unit ?? "UN"}, ${data.cost}, ${data.price}, ${data.promoPrice ?? null}, ${data.minStock ?? 0},
            ${data.location ?? null}, ${data.imageUrl ?? null}, ${data.isActive ?? true}, ${hasVariants},
            ${data.ncm ?? null}, ${data.cfop ?? "5102"}
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
  });

export const searchPosFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q: string; storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    await assertStore(sql, tenant.companyId, data.storeId);
    /*
      O custo so vai pra quem ja pode ve-lo em outro lugar do sistema (a tela
      de Produtos mostra custo e margem sob products.read).

      Isto importa pelo papel "Operador de PDV", que NAO tem products.read: e
      o papel de quem fica no balcao, muitas vezes contratado, e o PDV
      recebia a margem de cada produto sem usar pra nada -- o checkout calcula
      o custo da venda no servidor, com consulta propria. A tela de Compras
      usa este campo pra preencher o custo do pedido, e todo papel que chega
      la tem products.read, entao continua funcionando.
    */
    const podeVerCusto = can(tenant.role, "products.read");
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
      cost: podeVerCusto ? num(r.cost) : 0,
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
    assertCan(tenant.role, "stock.read");
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
      `select v.id as variant_id, p.id as product_id, p.name, v.color, v.size, p.sku,
              -- MESMA definicao do painel: o maior entre o minimo daquela
              -- loja e o do produto. Antes esta tela olhava so p.min_stock,
              -- entao o filtro "abaixo do minimo" daqui discordava do
              -- alerta "Estoque baixo" do painel -- duas telas, mesmo
              -- conceito, respostas diferentes.
              greatest(coalesce(i.min_stock, 0), coalesce(p.min_stock, 0)) as min_stock,
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
    assertCan(tenant.role, "stock.read");
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
    await assertVariants(sql, tenant.companyId, [data.variantId]);
    // parseStockQuantity no lugar de `<= 0`: NaN <= 0 e false, entao a
    // checagem anterior deixava passar e o estoque virava NaN.
    const quantidade = parseStockQuantity(data.quantity);
    const delta = data.type === "entrada" || data.type === "ajuste" ? quantidade : -quantidade;
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
    await assertVariants(sql, tenant.companyId, [data.variantId]);
    // Aqui nao havia validacao NENHUMA de quantidade -- nem a de "maior que
    // zero" que o ajuste tinha.
    const quantidade = parseStockQuantity(data.quantity, "quantidade a transferir");
    // As duas pontas na MESMA transacao: sao duas escritas que so fazem
    // sentido juntas. Soltas, um erro entre elas (conexao caindo, o servico
    // sendo reiniciado) tirava a peca da loja de origem sem coloca-la na de
    // destino -- estoque que some sem deixar rastro de para onde foi.
    await sql.transaction(async (sql) => {
      await applyStockChange(sql, {
        companyId: tenant.companyId,
        storeId: data.fromStoreId,
        variantId: data.variantId,
        delta: -quantidade,
        type: "transferencia",
        userId: tenant.userId,
        note: data.note ?? "Transferência entre lojas",
      });
      await applyStockChange(sql, {
        companyId: tenant.companyId,
        storeId: data.toStoreId,
        variantId: data.variantId,
        delta: quantidade,
        type: "transferencia",
        userId: tenant.userId,
        note: data.note ?? "Transferência entre lojas",
        allowNegative: true,
      });
    });
    return { ok: true };
  });

export const listPurchasesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.read");
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
    assertCan(tenant.role, "purchases.read");
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
    // "recebido" so pelo receivePurchaseFn: salvo por aqui, o pedido ficava
    // recebido sem somar estoque nem gerar a conta a pagar, e o botao
    // Receber passava a recusar ("ja recebido").
    if (!(PURCHASE_STATUS as readonly string[]).includes(data.status) || data.status === "recebido") {
      throw new Error("Status de pedido inválido.");
    }
    await assertStore(sql, tenant.companyId, data.storeId);
    await assertOwned(sql, tenant.companyId, "suppliers", data.supplierId);
    await assertVariants(sql, tenant.companyId, data.items.map((i) => i.variantId));
    /*
      productId vem do CLIENTE, mas quem manda e a variante: o formulario
      monta os dois juntos, mas nada impede um payload direto com um par que
      nao bate (variantId de um produto, productId de outro). Sem isto,
      purchase_items gravaria o produto errado, e receivePurchaseFn dali a
      diante atualizaria custo do produto errado -- o mesmo desvio que o
      checkout ja evita derivando product_id da variante, nunca do cliente.
    */
    const produtoDaVariante = new Map(
      (
        await sql.query<{ id: number; product_id: number }>(
          `select id, product_id from product_variants where company_id = $1 and id = any($2::int[])`,
          [tenant.companyId, data.items.map((i) => i.variantId)],
        )
      ).map((r) => [r.id, r.product_id]),
    );
    /*
      Quantidade, custo e os extras entravam crus e iam direto pro banco.
      Dois buracos reais nisso:

      - Quantidade NEGATIVA vira estoque que DIMINUI ao receber o pedido
        (receivePurchaseFn usa allowNegative: true, porque receber compra
        normalmente so soma).
      - Valor nao finito contamina `purchases.total`, que e o numero que o
        financeiro soma depois -- e `num()` no recebimento salva o estoque,
        mas nao desfaz o total ja gravado como NaN.
    */
    const itens = data.items.map((i) => ({
      ...i,
      productId: produtoDaVariante.get(i.variantId) ?? i.productId,
      quantity: parseStockQuantity(i.quantity, `quantidade de "${i.description}"`),
      unitCost: parseUnitCost(i.unitCost, `custo de "${i.description}"`),
    }));
    const desconto = parsePurchaseExtra(data.discount, "desconto");
    const frete = parsePurchaseExtra(data.freight, "frete");
    const imposto = parsePurchaseExtra(data.tax, "imposto");
    const subtotal = itens.reduce((a, i) => a + i.quantity * i.unitCost, 0);
    const total = subtotal - desconto + frete + imposto;
    /*
      O pedido e os itens numa transacao: a gravacao APAGA os itens antigos
      antes de regravar. Um erro entre o delete e os inserts deixava o
      pedido existindo, com valor total, e sem item nenhum dentro.
    */
    const purchaseId = await sql.transaction(async (sql) => {
      let id = data.id;
      if (id) {
        const cur = await sql<{ status: string }>`
          select status from purchases where id = ${id} and company_id = ${tenant.companyId} for update
        `;
        if (!cur[0] || cur[0].status === "recebido") throw new Error("Pedido não pode ser alterado.");
        await sql`
          update purchases set supplier_id = ${data.supplierId ?? null}, status = ${data.status}, notes = ${data.notes ?? null},
            subtotal = ${subtotal}, discount = ${desconto}, freight = ${frete}, tax = ${imposto},
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
            ${subtotal}, ${desconto}, ${frete}, ${imposto}, ${total}, ${data.expectedAt ?? null}, ${tenant.userId}
          ) returning id
        `;
        id = row!.id;
      }
      for (const item of itens) {
        await sql`
          insert into purchase_items (company_id, purchase_id, variant_id, product_id, description, quantity, unit_cost, total)
          values (${tenant.companyId}, ${id}, ${item.variantId}, ${item.productId}, ${item.description}, ${item.quantity}, ${item.unitCost}, ${item.quantity * item.unitCost})
        `;
      }

      return id;
    });
    return { id: purchaseId };
  });

export const receivePurchaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.receive");
    /*
      Recebimento inteiro numa transacao. Solto, um erro no meio deixava
      estoque de PARTE dos itens ja somado com o pedido ainda 'pendente' --
      e a guarda de reentrada olha justamente o status, entao receber de
      novo somaria o estoque desses itens uma segunda vez.

      A guarda de status tambem fica aqui dentro, depois do `for update`.
      Lida fora, dois cliques em "Receber" (ou um reenvio da rede) passavam
      os dois: estoque somado em dobro e DUAS contas a pagar pro fornecedor.
    */
    await sql.transaction(async (sql) => {
      const [p] = await sql<{ id: number; status: string; store_id: number; supplier_id: number | null; total: string | number; number: number }>`
        select id, status, store_id, supplier_id, total, number from purchases
         where id = ${data.id} and company_id = ${tenant.companyId}
         for update
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
    });
    return { ok: true };
  });

/**
 * Produtos sem classificação fiscal, agrupados por categoria.
 *
 * Por CATEGORIA porque é assim que a resposta chega: o contador manda
 * "camiseta é 6109.10.00", não um código por SKU. Preencher peça a peça é
 * o caminho mais curto pra ninguém preencher.
 *
 * Os produtos de cada categoria vêm junto, e não só a contagem: categoria
 * não é garantia de mesmo NCM -- em "Acessórios" convivem bolsa (4202) e
 * cinto (4203). Quem aplica precisa poder ver o que vai mudar.
 */
export const listNcmPendingFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "products.read");
    // `classificado` vem do BANCO, pela mesma expressão que a
    // pré-checagem fiscal usa. Decidir aqui em JS e lá em SQL foi o que
    // fez as duas telas discordarem sobre o mesmo produto.
    const rows = await sql.query<{
      id: number;
      name: string;
      sku: string | null;
      ncm: string | null;
      categoria: string | null;
      classificado: boolean;
    }>(
      `select p.id, p.name, p.sku, p.ncm, c.name as categoria,
              ${ncmValidSql("p.ncm")} as classificado
         from products p
         left join categories c on c.id = p.category_id
        where p.company_id = $1 and p.deleted_at is null
        order by c.name nulls last, p.name`,
      [tenant.companyId],
    );

    const grupos = new Map<
      string,
      { categoria: string; total: number; pendentes: { id: number; name: string; sku: string | null; ncm: string | null }[] }
    >();
    for (const r of rows) {
      const cat = r.categoria == null ? "Sem categoria" : String(r.categoria);
      const g = grupos.get(cat) ?? { categoria: cat, total: 0, pendentes: [] };
      g.total += 1;
      if (r.classificado !== true) {
        g.pendentes.push({
          id: num(r.id),
          name: String(r.name),
          sku: r.sku == null ? null : String(r.sku),
          ncm: r.ncm == null ? null : String(r.ncm),
        });
      }
      grupos.set(cat, g);
    }

    const categorias = [...grupos.values()]
      .filter((g) => g.pendentes.length > 0)
      // Mais pendências primeiro: é onde uma aplicação em lote rende mais.
      .sort((a, b) => b.pendentes.length - a.pendentes.length || a.categoria.localeCompare(b.categoria));

    return dump({
      categorias,
      pendentes: categorias.reduce((a, g) => a + g.pendentes.length, 0),
      total: rows.length,
    });
  });

/**
 * Aplica um NCM a uma lista de produtos.
 *
 * Recebe IDS, não uma categoria: se chegasse categoria, o servidor
 * aplicaria a tudo que estivesse nela NAQUELE instante -- inclusive um
 * produto cadastrado depois que a tela carregou, que ninguém olhou. A
 * lista de ids é exatamente o que o operador viu.
 */
export const applyNcmFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { ncm: string; productIds: number[] }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "products.write");
    const ncm = parseNcm(data.ncm);
    if (!ncm) throw new Error("Informe o NCM.");
    const ids = [...new Set((data.productIds ?? []).map((v) => num(v)).filter((v) => v > 0))];
    if (!ids.length) throw new Error("Selecione ao menos um produto.");

    const alterados = await sql<{ id: number }>`
      update products set ncm = ${ncm}, updated_at = now()
       where company_id = ${tenant.companyId} and deleted_at is null
         and id = any(${ids}::int[])
      returning id
    `;
    // Dado fiscal em lote: quem mudou, quando, para qual código e em
    // quantos produtos. Um NCM errado não dá erro -- dá nota autorizada
    // com imposto errado, e o log é o único caminho de volta.
    await audit(sql, tenant, "set-ncm", "product", null, null, {
      ncm,
      produtos: alterados.length,
      ids: alterados.map((r) => num(r.id)),
    });
    return { ok: true, alterados: alterados.length };
  });
