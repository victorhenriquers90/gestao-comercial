import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan, can } from "@/lib/permissions";
import { ncmValidSql, parseCfop, parseNcm } from "@/lib/ncm";
import { num } from "@/lib/utils";
import { assertOwned, assertStore, assertVariants, audit, auditUpdate, nextNumber, requireTenant } from "./context";
import { applyStockChange } from "./stock";
import { parseBarcode } from "@/lib/check-digit";
import { parsePurchaseExtra, parseStockDelta, parseStockQuantity, parseUnitCost } from "@/lib/stock-input";
import { dump, type Row } from "@/lib/json";
import { PURCHASE_STATUS } from "@/lib/constants";
import { checkUndoReceiveWindow } from "@/lib/purchase-undo";
import { effectivePrice } from "@/lib/promo";
import { parsePaging } from "@/lib/paging";
import { ftsPrefix, prefixLike } from "@/lib/search";
import {
  optionalLine,
  requireLine,
  sanitizeCode,
  sanitizeImageUrl,
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
  .validator(
    (d: {
      q?: string;
      categoryId?: number;
      active?: boolean;
      storeId?: number;
      /** Padrão 100, máximo 200. */
      limit?: number;
      offset?: number;
    }) => ({ ...d, page: parsePaging(d) }),
  )
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
    params.push(data.page.limit, data.page.offset);
    const limitAt = params.length - 1;
    const offsetAt = params.length;
    const rows = await sql.query<Row>(
      `select count(*) over() as total,
              p.id, p.internal_code, p.barcode, p.sku, p.name, p.unit, p.cost, p.price, p.promo_price,
              p.min_stock, p.is_active, p.has_variants, p.location, p.image_url, p.ncm, p.cfop,
              c.name as category, b.name as brand,
              coalesce(st.stock, 0) as stock
         from products p
         left join categories c on c.id = p.category_id
         left join brands b on b.id = p.brand_id
         ${stockJoin}
        where p.company_id = $1 and p.deleted_at is null
          ${extra}
        order by p.name, p.id
        limit $${limitAt} offset $${offsetAt}`,
      params,
    );
    // Antes o corte em 200 era silencioso: o 201o produto (em ordem alfabetica)
    // nao aparecia na lista nem em nenhum seletor, sem aviso. `total` deixa a
    // tela dizer "de quantos" e paginar; o desempate por id mantem a ordem
    // estavel entre paginas quando dois produtos tem o mesmo nome.
    const total = rows.length ? num(rows[0]!.total) : 0;
    const items = rows.map((r) => ({
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
    return { items, total };
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
    // s.legal_name/trade_name: sem isto o formulario de edicao so tinha o
    // supplier_id, e o SupplierPicker (busca por nome) abria sem nome
    // nenhum pra mostrar -- o campo parecia "sem fornecedor" mesmo com um
    // fornecedor de verdade salvo.
    const products = await sql<Row>`
      select p.*, s.legal_name as supplier_legal_name, s.trade_name as supplier_trade_name
        from products p
        left join suppliers s on s.id = p.supplier_id
       where p.id = ${data.id} and p.company_id = ${tenant.companyId}
    `;
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
      imageUrl: sanitizeImageUrl(d.imageUrl),
      // parseNcm/parseCfop e nao sanitizeCode: o sanitize so CORTA em
      // 8/4 caracteres -- "abc" virava NCM valido, e "5.102" (do jeito que
      // a tabela oficial escreve) virava CFOP "5.10", com ponto e faltando
      // um digito. Os dois so explodiam na recusa do SEFAZ, no balcao, com
      // o cliente esperando a nota.
      ncm: parseNcm(d.ncm) ?? undefined,
      cfop: parseCfop(d.cfop) ?? undefined,
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
    // Mesma classe de bug ja documentada em stock-input.ts: NaN/Infinity do
    // JS atravessam o driver intactos e o Postgres aceita 'NaN'::numeric --
    // sem checagem aqui, um custo/preco invalido (vindo de um campo sem
    // type="number" no cliente, ou de uma chamada direta ao servidor) ficava
    // gravado como NaN, e toda leitura via num() ZERA de volta em silencio.
    // Foi exatamente assim que o preco promocional parava de aplicar: NaN
    // gravado, lido como 0, `productPromo > 0 ? productPromo : list` caia
    // pro preco cheio sem erro nenhum avisando ninguem.
    const cost = parseUnitCost(data.cost, "custo");
    const price = parseUnitCost(data.price, "preço");
    const promoPrice = data.promoPrice == null ? null : parseUnitCost(data.promoPrice, "preço promocional");
    // "Promocional" maior ou igual ao preco cheio nao e promocao -- e
    // provavelmente um numero no campo errado. Sem esta trava, um preco
    // promocional digitado errado aparecia como o preco de venda na busca
    // do PDV (searchPosFn) e, uma vez cobrado, cobraria MAIS que o normal.
    if (promoPrice != null && promoPrice >= price) {
      throw new Error("O preço promocional precisa ser menor que o preço normal.");
    }

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
      const isNew = !data.id;
      let productId = data.id;
      let description = data.description ?? null;
      let categoryId = data.categoryId ?? null;
      let supplierId = data.supplierId ?? null;
      let hasVariants = Boolean(data.variants && data.variants.length > 0);
      /*
        Editar sem tocar em categoria/descricao/marca/fornecedor/grade nao
        pode apagar esses campos so porque chegaram undefined no payload --
        produtos.tsx nem tem campo de marca/fornecedor no formulario (por
        isso NUNCA manda os dois), e ate esta correcao tambem nao carregava
        categoria/descricao ao abrir pra editar. Sem isto, editar qualquer
        produto (so o preco, por exemplo) zerava os quatro campos e ainda
        virava `has_variants = false`, que dispara o bloco de baixo a
        sobrescrever UMA variante arbitraria com os dados do produto --
        foi o que corrompeu de verdade um produto do piloto (categoria,
        descricao, marca, fornecedor e a grade viraram null/errado num
        `saveProductFn` que so devia ter confirmado o dialogo sem mudar
        nada). So sobrescreve o que veio de verdade; o resto preserva o
        que ja esta gravado.
      */
      let auditBefore: Record<string, unknown> | null = null;
      if (productId) {
        const [cur] = await sql<{
          has_variants: boolean;
          description: string | null;
          category_id: number | null;
          brand_id: number | null;
          supplier_id: number | null;
          name: string;
          price: string | number | null;
          cost: string | number | null;
          promo_price: string | number | null;
          is_active: boolean;
        }>`
          select has_variants, description, category_id, brand_id, supplier_id,
                 name, price, cost, promo_price, is_active from products
           where id = ${productId} and company_id = ${tenant.companyId}
        `;
        if (cur) {
          auditBefore = {
            name: cur.name,
            price: num(cur.price),
            cost: num(cur.cost),
            promoPrice: cur.promo_price == null ? null : num(cur.promo_price),
            isActive: cur.is_active,
          };
        }
        if (data.variants === undefined) hasVariants = Boolean(cur?.has_variants);
        if (data.description === undefined) description = cur?.description ?? null;
        if (data.categoryId === undefined) categoryId = cur?.category_id ?? null;
        if (!data.brandId && !data.brandName?.trim()) brandId = cur?.brand_id ?? null;
        if (data.supplierId === undefined) supplierId = cur?.supplier_id ?? null;
        await sql`
          update products set
            name = ${data.name}, internal_code = ${data.internalCode ?? null}, barcode = ${data.barcode ?? null},
            sku = ${data.sku ?? null}, description = ${description},
            category_id = ${categoryId}, brand_id = ${brandId}, supplier_id = ${supplierId},
            unit = ${data.unit ?? "UN"}, cost = ${cost}, price = ${price},
            promo_price = ${promoPrice}, min_stock = ${data.minStock ?? 0},
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
            ${data.name}, ${description}, ${categoryId}, ${brandId}, ${supplierId},
            ${data.unit ?? "UN"}, ${cost}, ${price}, ${promoPrice}, ${data.minStock ?? 0},
            ${data.location ?? null}, ${data.imageUrl ?? null}, ${data.isActive ?? true}, ${hasVariants},
            ${data.ncm ?? null}, ${data.cfop ?? "5102"}
          ) returning id
        `;
        productId = row!.id;
      }
      if (data.variants && data.variants.length > 0) {
        for (const v of data.variants) {
          // Mesma classe do bug comentado acima pro produto (NaN/Infinity
          // atravessando o driver): custo/preco por variante vinham direto
          // do payload, sem passar por `parseUnitCost` -- um preco negativo
          // numa so variante gravava e `checkoutFn` cobrava (ou devolvia)
          // esse valor sem checar nada, ja que o catalogo em si estava
          // corrompido, nao a venda.
          const vCost = v.cost == null ? cost : parseUnitCost(v.cost, "custo da variante");
          const vPrice = v.price == null ? price : parseUnitCost(v.price, "preço da variante");
          if (v.id) {
            await sql`
              update product_variants set sku = ${v.sku ?? null}, barcode = ${v.barcode ?? null},
                color = ${v.color ?? null}, size = ${v.size ?? null}, model = ${v.model ?? null},
                cost = ${vCost}, price = ${vPrice}
              where id = ${v.id} and company_id = ${tenant.companyId}
            `;
          } else {
            await sql`
              insert into product_variants (company_id, product_id, sku, barcode, color, size, model, cost, price)
              values (${tenant.companyId}, ${productId}, ${v.sku ?? null}, ${v.barcode ?? null}, ${v.color ?? null}, ${v.size ?? null}, ${v.model ?? null}, ${vCost}, ${vPrice})
            `;
          }
        }
      } else if (isNew) {
        // Produto novo sem grade no payload: garante a variante unica
        // default. So roda na CRIACAO -- editar um produto existente sem
        // mandar `variants` nao mexe em product_variants de jeito nenhum
        // (ver comentario acima: era daqui que saia a variante arbitraria
        // sobrescrita com os dados do produto).
        const existing = await sql<{ id: number }>`
          select id from product_variants where product_id = ${productId} and company_id = ${tenant.companyId} and deleted_at is null
        `;
        if (!existing.length) {
          await sql`
            insert into product_variants (company_id, product_id, sku, barcode, cost, price)
            values (${tenant.companyId}, ${productId}, ${data.sku ?? null}, ${data.barcode ?? null}, ${cost}, ${price})
          `;
        }
      }
      // Preco e custo vao com o antes/depois: sem isso a auditoria diz que
      // alguem "alterou o produto" mas nao diz de quanto para quanto.
      await audit(sql, tenant, data.id ? "update" : "create", "product", productId, auditBefore, {
        name: data.name,
        price,
        cost,
        promoPrice,
        isActive: data.isActive ?? true,
      });
      return { id: productId };
    });
  });

export const searchPosFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q: string; storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    await assertStore(sql, tenant, data.storeId);
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
      price: effectivePrice(num(r.price), num(r.promo_price)),
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
  .validator(
    (d: {
      storeId?: number;
      q?: string;
      filter?: "all" | "low" | "zero" | "stale";
      limit?: number;
      offset?: number;
    }) => ({ ...d, page: parsePaging(d) }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.read");
    const params: unknown[] = [tenant.companyId];
    // Precisa entrar no ON do join, nao no WHERE: uma variante que nunca
    // teve movimento de estoque em loja nenhuma (produto novo sem compra
    // recebida) nao tem linha em `inventories`, entao o LEFT JOIN devolve
    // i.* nulo -- "WHERE i.store_id = $N" descartava essa linha (NULL = $N
    // nunca e verdadeiro), virando um INNER JOIN disfarcado e escondendo o
    // produto de QUALQUER filtro por loja especifica, inclusive "Zerados"
    // e "Abaixo do minimo", que sao exatamente os alertas que deveriam
    // pegar esse caso.
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
    // O filtro roda no SQL, antes do corte da pagina. Antes ele rodava em JS
    // DEPOIS de um `limit 400`: com mais de 400 variantes, "Abaixo do minimo"
    // e "Zerados" so olhavam as 400 primeiras em ordem alfabetica e nunca
    // mostravam o resto -- justamente o alerta que precisa enxergar tudo.
    const minSql = "greatest(coalesce(i.min_stock, 0), coalesce(p.min_stock, 0))";
    let filterSql = "";
    if (data.filter === "low") filterSql = ` and ${minSql} > 0 and coalesce(i.quantity, 0) <= ${minSql}`;
    else if (data.filter === "zero") filterSql = " and coalesce(i.quantity, 0) <= 0";
    else if (data.filter === "stale") filterSql = " and (lm.last_move is null or lm.last_move < now() - interval '45 days')";
    params.push(data.page.limit, data.page.offset);
    const limitAt = params.length - 1;
    const offsetAt = params.length;
    const rows = await sql.query<Row>(
      `select count(*) over() as total,
              v.id as variant_id, p.id as product_id, p.name, v.color, v.size, p.sku,
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
         left join inventories i on i.variant_id = v.id and i.company_id = v.company_id ${storeSql}
         left join stores s on s.id = i.store_id
         left join (
           select variant_id, max(created_at) as last_move
             from stock_movements
            where company_id = $1
            group by variant_id
         ) lm on lm.variant_id = v.id
        where v.company_id = $1 and p.deleted_at is null and v.deleted_at is null
          ${qSql}
          ${filterSql}
        order by p.name, v.id, i.store_id
        limit $${limitAt} offset $${offsetAt}`,
      params,
    );
    const total = rows.length ? num(rows[0]!.total) : 0;
    const items = rows.map((r) => ({
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
    return { items, total };
  });

export const listMovementsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { storeId?: number; variantId?: number; type?: string; limit?: number; offset?: number }) => ({
      ...d,
      page: parsePaging(d),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.read");
    // Mesmo teto silencioso do item 63 (listProductsFn/listStockFn/
    // listSalesFn), achado aqui depois: `limit 200` sem contagem nem
    // paginacao -- uma loja em operacao bate 200 movimentos (entrada, venda,
    // ajuste, transferencia) em poucas semanas, e o historico mais antigo
    // simplesmente sumia da tela sem nenhum aviso.
    const rows = await sql.query<Row>(
      `select count(*) over() as total,
              m.id, m.quantity, m.previous_qty, m.new_qty, m.type, m.user_id, m.note, m.created_at,
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
        limit $5 offset $6`,
      [tenant.companyId, data.storeId ?? null, data.variantId ?? null, data.type ?? null, data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.total) : 0;
    return { items: dump(rows.map((r) => { const { total: _t, ...rest } = r; return rest; })), total };
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
    await assertStore(sql, tenant, data.storeId);
    await assertVariants(sql, tenant.companyId, [data.variantId]);
    // parseStockQuantity no lugar de `<= 0`: NaN <= 0 e false, entao a
    // checagem anterior deixava passar e o estoque virava NaN.
    //
    // "ajuste" NAO passa por parseStockQuantity: o rotulo da tela e "Ajuste
    // (define delta)", mas forcar quantidade > 0 igual aos outros tipos
    // deixava "ajuste" so capaz de SOMAR -- idem a "entrada" com outro nome,
    // sem jeito de corrigir uma contagem pra baixo sem abusar de "perda"
    // (que tem outro significado: extravio/quebra, nao erro de contagem).
    const delta =
      data.type === "ajuste"
        ? parseStockDelta(data.quantity)
        : data.type === "entrada"
          ? parseStockQuantity(data.quantity)
          : -parseStockQuantity(data.quantity);
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
    await assertStore(sql, tenant, data.fromStoreId);
    await assertStore(sql, tenant, data.toStoreId);
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
  .validator(
    (d: { storeId?: number; status?: string; limit?: number; offset?: number }) => ({
      ...d,
      page: parsePaging(d),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.read");
    // Mesmo teto silencioso do item 63/77: `limit 100` sem contagem nem
    // paginacao -- um pedido de compra a cada poucos dias ja passa de 100
    // dentro de um ano de loja aberta.
    // `row_count`, nao `total`: `p.*` ja traz uma coluna `total` (o valor do
    // pedido) -- usar o mesmo nome faria o objeto da linha sobrescrever a
    // contagem pelo valor do pedido (a ultima coluna repetida vence).
    const rows = await sql.query<Row>(
      `select count(*) over() as row_count,
              p.*, s.legal_name as supplier_name, st.name as store_name
         from purchases p
         left join suppliers s on s.id = p.supplier_id
         join stores st on st.id = p.store_id
        where p.company_id = $1 and p.deleted_at is null
          and ($2::int is null or p.store_id = $2)
          and ($3::text is null or p.status = $3)
        order by p.created_at desc
        limit $4 offset $5`,
      [tenant.companyId, data.storeId ?? null, data.status ?? null, data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.row_count) : 0;
    const items = rows.map((r) => ({
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
    return { items, total };
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
    await assertStore(sql, tenant, data.storeId);
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
    // Mesma ideia do promoPrice >= price acima: desconto maior que
    // subtotal+frete+imposto grava um pedido com total NEGATIVO, que
    // receivePurchaseFn copia direto pra uma conta a pagar -- uma divida
    // negativa que o financeiro soma como credito, subestimando o que a
    // loja deve ao fornecedor.
    if (total < 0) throw new Error("O desconto não pode deixar o total da compra negativo.");
    /*
      O pedido e os itens numa transacao: a gravacao APAGA os itens antigos
      antes de regravar. Um erro entre o delete e os inserts deixava o
      pedido existindo, com valor total, e sem item nenhum dentro.
    */
    // Mesma forma que listTargetsFn/saveSupplierFn usam pro resumo de
    // auditoria: so os campos que importam pra reconstruir o que mudou, nao
    // o registro inteiro (itens entram so como contagem -- diferenca de
    // quantidade/custo linha a linha e demais pra uma linha de auditoria).
    const after = {
      supplierId: data.supplierId ?? null,
      storeId: data.storeId,
      status: data.status,
      itemCount: itens.length,
      freight: frete,
      tax: imposto,
      discount: desconto,
      total,
    };
    const purchaseId = await sql.transaction(async (sql) => {
      let id = data.id;
      if (id) {
        const cur = await sql<Row>`
          select status, supplier_id, store_id, freight, tax, discount, total,
                 (select count(*)::int from purchase_items where purchase_id = ${id}) as item_count
          from purchases where id = ${id} and company_id = ${tenant.companyId} for update
        `;
        if (!cur[0] || cur[0].status === "recebido") throw new Error("Pedido não pode ser alterado.");
        await sql`
          update purchases set supplier_id = ${data.supplierId ?? null}, status = ${data.status}, notes = ${data.notes ?? null},
            subtotal = ${subtotal}, discount = ${desconto}, freight = ${frete}, tax = ${imposto},
            total = ${total}, expected_at = ${data.expectedAt ?? null}, updated_at = now()
          where id = ${id} and company_id = ${tenant.companyId}
        `;
        await sql`delete from purchase_items where purchase_id = ${id}`;
        await auditUpdate(
          sql,
          tenant,
          "purchase",
          id,
          {
            supplierId: cur[0].supplier_id,
            storeId: cur[0].store_id,
            status: cur[0].status,
            itemCount: num(cur[0].item_count),
            freight: num(cur[0].freight),
            tax: num(cur[0].tax),
            discount: num(cur[0].discount),
            total: num(cur[0].total),
          },
          after,
        );
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
        await audit(sql, tenant, "create", "purchase", id, null, after);
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
 * Desfaz o recebimento de um pedido -- versao estreita, ver
 * `src/lib/purchase-undo.ts` pro que isto resolve e pro que nao resolve.
 *
 * As DUAS travas de verdade (nao a janela de tempo, que e so o primeiro
 * filtro) sao: nenhum estoque das variantes do pedido pode ter se mexido
 * desde o recebimento, e a conta a pagar gerada nao pode ter pagamento
 * registrado. Sem as duas, "desfazer" teria que inventar de onde tirar o
 * estoque que ja foi vendido, ou estornar um pagamento que ja saiu do
 * caixa -- duas operacoes bem mais arriscadas que um clique errado.
 */
export const undoReceivePurchaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.receive");
    await sql.transaction(async (sql) => {
      const [p] = await sql<{
        id: number;
        status: string;
        store_id: number;
        received_at: string | null;
        number: number;
      }>`
        select id, status, store_id, received_at, number from purchases
         where id = ${data.id} and company_id = ${tenant.companyId}
         for update
      `;
      if (!p) throw new Error("Pedido não encontrado.");
      if (p.status !== "recebido") throw new Error("Este pedido não está recebido.");

      const janela = checkUndoReceiveWindow(p.received_at);
      if (!janela.ok) throw new Error(janela.motivo);

      const items = await sql<{ variant_id: number; quantity: string | number }>`
        select variant_id, quantity from purchase_items where purchase_id = ${p.id}
      `;
      const variantIds = items.map((i) => i.variant_id);

      // Qualquer movimentacao do estoque destas variantes DEPOIS do
      // recebimento -- menos a do proprio recebimento -- derruba o
      // desfazer. "Depois", nao "diferente de zero": a peca pode ter sido
      // vendida e devolvida, e o saldo fechar igual, mas algo aconteceu
      // com ela que este botao nao tem como saber se ainda vale desfazer.
      const [mexeu] = await sql<{ id: number }>`
        select id from stock_movements
         where company_id = ${tenant.companyId} and store_id = ${p.store_id}
           and variant_id = any(${variantIds}::int[])
           and created_at > ${p.received_at}
           and not (reference_type = 'purchase' and reference_id = ${p.id})
         limit 1
      `;
      if (mexeu) {
        throw new Error("O estoque de algum item já mudou desde o recebimento — não dá pra desfazer. Ajuste manualmente em Estoque.");
      }

      /*
        `purchase_id = p.id` sozinho nao basta: um pedido ja recebido,
        desfeito e recebido de novo deixa a conta a pagar CANCELADA do
        ciclo anterior ainda na tabela (historico, nunca apagada) ao lado
        da conta ATIVA do recebimento atual -- duas linhas pro mesmo
        purchase_id. Sem o filtro de status, a consulta podia devolver a
        cancelada (sempre com paid_amount=0) e deixar a checagem de
        pagamento cega pra conta de verdade, que tem o pagamento. So pode
        haver uma nao-cancelada por vez (cada ciclo recebe-desfaz cancela a
        anterior antes de a proxima existir), mas o `order by ... limit 1`
        fica como segunda trava, nao so a primeira.
      */
      const [pagavel] = await sql<{ id: number; paid_amount: string | number; status: string }>`
        select id, paid_amount, status from accounts_payable
         where purchase_id = ${p.id} and company_id = ${tenant.companyId} and status <> 'cancelado'
         order by id desc
         limit 1
         for update
      `;
      if (pagavel && (pagavel.status === "pago" || num(pagavel.paid_amount) > 0.009)) {
        throw new Error(
          "A conta a pagar desta compra já tem pagamento registrado — não dá pra desfazer. Estorne o pagamento em Financeiro primeiro.",
        );
      }

      /*
        Sem `allowNegative`, de proposito -- ao contrario do recebimento
        original. Ja conferimos acima que nada mexeu nestas variantes desde
        o recebimento, entao subtrair a mesma quantidade nunca deveria
        passar de zero; se passar (uma condicao que a checagem de cima nao
        previu, ou uma corrida bem estreita), o proprio applyStockChange
        recusa em vez de deixar o estoque negativo.
      */
      for (const item of items) {
        await applyStockChange(sql, {
          companyId: tenant.companyId,
          storeId: p.store_id,
          variantId: item.variant_id,
          delta: -num(item.quantity),
          type: "compra",
          userId: tenant.userId,
          referenceType: "purchase",
          referenceId: p.id,
          note: "Estorno de recebimento",
        });
      }

      if (pagavel) {
        await sql`update accounts_payable set status = 'cancelado' where id = ${pagavel.id}`;
      }

      // Volta pra 'enviado' (nao pro status original, que nao fica
      // gravado): se foi recebido, o fornecedor ja tinha enviado -- e o
      // pedido reaparece em Compras com o botao "Receber" disponivel de
      // novo, pronto pra corrigir e tentar outra vez.
      await sql`
        update purchases set status = 'enviado', received_at = null, updated_at = now()
        where id = ${p.id}
      `;
      await audit(sql, tenant, "undo-receive", "purchase", p.id);
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
      category_id: number | null;
      categoria: string | null;
      classificado: boolean;
    }>(
      `select p.id, p.name, p.sku, p.ncm, p.category_id, c.name as categoria,
              ${ncmValidSql("p.ncm")} as classificado
         from products p
         left join categories c on c.id = p.category_id
        where p.company_id = $1 and p.deleted_at is null
        order by c.name nulls last, p.name`,
      [tenant.companyId],
    );

    const grupos = new Map<
      number | null,
      {
        categoryId: number | null;
        categoria: string;
        total: number;
        pendentes: { id: number; name: string; sku: string | null; ncm: string | null }[];
      }
    >();
    for (const r of rows) {
      // Agrupado pelo ID da categoria, nao pelo nome: nada impede duas
      // categorias com o MESMO nome (ex. "Camisetas" dentro de "Masculino"
      // e dentro de "Feminino" -- `saveCategoryFn` nao exige nome unico).
      // Agrupar por nome juntava os pendentes das duas num bloco so,
      // "Aplicar a N produto(s)" gravava o mesmo NCM nas duas categorias de
      // uma vez so, e nada na tela (nem a lista expandida) dava pra notar --
      // justamente o erro fiscal que o aviso da propria tela ("categoria NAO
      // garante mesmo NCM") tenta evitar.
      const catId = r.category_id == null ? null : num(r.category_id);
      const cat = r.categoria == null ? "Sem categoria" : String(r.categoria);
      const g = grupos.get(catId) ?? { categoryId: catId, categoria: cat, total: 0, pendentes: [] };
      g.total += 1;
      if (r.classificado !== true) {
        g.pendentes.push({
          id: num(r.id),
          name: String(r.name),
          sku: r.sku == null ? null : String(r.sku),
          ncm: r.ncm == null ? null : String(r.ncm),
        });
      }
      grupos.set(catId, g);
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
