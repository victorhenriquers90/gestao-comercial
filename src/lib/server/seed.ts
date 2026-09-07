import type { Sql } from "@/lib/db";
import { computeCommission, type CommissionRule } from "@/lib/commission";
import { computeNetCommission, resolveTaxProfile, taxToJson } from "@/lib/tax";
import { applyStockChange } from "./stock";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedCompany(
  sql: Sql,
  ctx: {
    companyId: number;
    storeId: number;
    userId: string;
    companyName: string;
    userName: string;
  },
) {
  const claimed = await sql<{ id: number }>`
    update companies set seeded = true, updated_at = now()
     where id = ${ctx.companyId} and seeded = false
     returning id
  `;
  if (!claimed.length) return;

  const { companyId, storeId, userId } = ctx;
  const stores = await sql<{ id: number }>`
    select id from stores where company_id = ${companyId} order by id
  `;
  const storeB = stores[1]?.id ?? storeId;

  const catNames = [
    ["Vestuário", ["Camisetas", "Calças"]],
    ["Calçados", []],
    ["Acessórios", []],
    ["Alimentos", []],
    ["Higiene", []],
    ["Eletrônicos", []],
  ] as const;
  const catIds: Record<string, number> = {};
  const catParent: Record<string, number | null> = {};
  for (const [name, children] of catNames) {
    const [row] = await sql<{ id: number }>`
      insert into categories (company_id, name) values (${companyId}, ${name}) returning id
    `;
    catIds[name] = row!.id;
    catParent[name] = null;
    for (const child of children) {
      const [c] = await sql<{ id: number }>`
        insert into categories (company_id, name, parent_id)
        values (${companyId}, ${child}, ${row!.id}) returning id
      `;
      catIds[child] = c!.id;
      catParent[child] = row!.id;
    }
  }

  const brandIds: Record<string, number> = {};
  for (const name of ["Aurora", "Norte", "Lumen", "Campo"]) {
    const [b] = await sql<{ id: number }>`
      insert into brands (company_id, name) values (${companyId}, ${name}) returning id
    `;
    brandIds[name] = b!.id;
  }

  const [sup1] = await sql<{ id: number }>`
    insert into suppliers (company_id, legal_name, trade_name, document, email, phone, whatsapp, city, state, representative)
    values (${companyId}, 'Aurora Têxtil Ltda', 'Aurora Têxtil', '11222333000181', 'vendas@aurora.example', '1130001000', '11988880001', 'São Paulo', 'SP', 'Marina Alves')
    returning id
  `;
  const [sup2] = await sql<{ id: number }>`
    insert into suppliers (company_id, legal_name, trade_name, document, email, phone, city, state)
    values (${companyId}, 'Norte Distribuidora SA', 'Norte Dist.', '44555666000181', 'contato@norte.example', '1140002000', 'Campinas', 'SP')
    returning id
  `;

  const [seller1] = await sql<{ id: number }>`
    insert into sellers (company_id, name, email, phone, document, commission_pct, store_id, tax_regime, monthly_salary, dependents)
    values (${companyId}, ${ctx.userName || "Administrador"}, null, null, null, 4, ${storeId}, 'none', 0, 0)
    returning id
  `;
  const [seller2] = await sql<{ id: number }>`
    insert into sellers (company_id, name, email, phone, document, commission_pct, store_id, tax_regime, monthly_salary, dependents)
    values (${companyId}, 'Camila Ribeiro', 'camila@loja.example', '11990001122', '41582739005', 5, ${storeId}, 'clt', 2800, 1)
    returning id
  `;
  const [seller3] = await sql<{ id: number }>`
    insert into sellers (company_id, name, email, phone, document, commission_pct, store_id, tax_regime, monthly_salary, dependents)
    values (${companyId}, 'João Martins', 'joao@loja.example', '11990003344', '26318475044', 4.5, ${storeB}, 'autonomo', 0, 0)
    returning id
  `;
  const [seller4] = await sql<{ id: number }>`
    insert into sellers (company_id, name, email, phone, document, commission_pct, store_id, tax_regime, monthly_salary, dependents)
    values (${companyId}, 'Marina Costa', 'marina@loja.example', '11990005566', '39817264000178', 4, ${storeB}, 'mei', 0, 0)
    returning id
  `;

  const ruleDefs: {
    name: string;
    kind: string;
    percent: number;
    category?: string;
    payment?: string;
    onlyPromo?: boolean;
    tiers?: { min: number; percent: number }[];
    tierBasis?: "none" | "sale" | "month";
  }[] = [
    { name: "Vestuário 6%", kind: "percent_sales", percent: 6, category: "Vestuário" },
    { name: "Camisetas 7%", kind: "percent_sales", percent: 7, category: "Camisetas" },
    { name: "Eletrônicos 3%", kind: "percent_sales", percent: 3, category: "Eletrônicos" },
    { name: "Crédito 2,5%", kind: "percent_sales", percent: 2.5, payment: "credito" },
    { name: "Sem comissão em promoção", kind: "exclude", percent: 0, onlyPromo: true },
    { name: "R$ 1,50 por acessório", kind: "fixed_unit", percent: 1.5, category: "Acessórios" },
    {
      name: "Faixa mensal 5 / 7 / 9%",
      kind: "percent_sales",
      percent: 5,
      tierBasis: "month",
      tiers: [
        { min: 0, percent: 5 },
        { min: 8000, percent: 7 },
        { min: 18000, percent: 9 },
      ],
    },
  ];
  const commissionRules: CommissionRule[] = [];
  for (const def of ruleDefs) {
    const categoryId = def.category ? (catIds[def.category] ?? null) : null;
    if (def.category && categoryId == null) continue;
    const tiers = def.tiers ?? [];
    const tierBasis = def.tierBasis ?? "none";
    const [row] = await sql<{ id: number }>`
      insert into commission_rules (
        company_id, name, kind, percent, category_id, payment_method, only_promo, is_active,
        tiers, tier_basis
      ) values (
        ${companyId}, ${def.name}, ${def.kind}, ${def.percent}, ${categoryId},
        ${def.payment ?? null}, ${Boolean(def.onlyPromo)}, true,
        ${JSON.stringify(tiers)}::jsonb, ${tierBasis}
      ) returning id
    `;
    commissionRules.push({
      id: row!.id,
      name: def.name,
      kind: def.kind,
      sellerId: null,
      categoryId,
      productId: null,
      paymentMethod: def.payment ?? null,
      percent: def.percent,
      minAmount: 0,
      skipPromo: false,
      onlyPromo: Boolean(def.onlyPromo),
      priority: 0,
      isActive: true,
      tiers,
      tierBasis,
    });
  }

  type PDef = {
    name: string;
    cat: string;
    brand: string;
    cost: number;
    price: number;
    sku: string;
    barcode: string;
    min: number;
    variants?: { color: string; size: string }[];
    supplier: number;
  };

  const defs: PDef[] = [
    {
      name: "Camiseta Algodão Premium",
      cat: "Camisetas",
      brand: "Aurora",
      cost: 28.9,
      price: 79.9,
      sku: "CAM-001",
      barcode: "7891000000014",
      min: 8,
      supplier: sup1!.id,
      variants: [
        { color: "Preta", size: "P" },
        { color: "Preta", size: "M" },
        { color: "Preta", size: "G" },
        { color: "Branca", size: "P" },
        { color: "Branca", size: "M" },
        { color: "Branca", size: "G" },
      ],
    },
    {
      name: "Calça Jeans Reta",
      cat: "Calças",
      brand: "Norte",
      cost: 62,
      price: 159.9,
      sku: "CAL-010",
      barcode: "7891000000021",
      min: 4,
      supplier: sup1!.id,
      variants: [
        { color: "Azul", size: "38" },
        { color: "Azul", size: "40" },
        { color: "Azul", size: "42" },
      ],
    },
    {
      name: "Tênis Urban Mesh",
      cat: "Calçados",
      brand: "Lumen",
      cost: 95,
      price: 249.9,
      sku: "TEN-020",
      barcode: "7891000000038",
      min: 3,
      supplier: sup2!.id,
    },
    {
      name: "Bolsa Couro Mini",
      cat: "Acessórios",
      brand: "Aurora",
      cost: 78,
      price: 219,
      sku: "BOL-030",
      barcode: "7891000000045",
      min: 2,
      supplier: sup1!.id,
    },
    {
      name: "Cinto Couro 3cm",
      cat: "Acessórios",
      brand: "Aurora",
      cost: 22,
      price: 69.9,
      sku: "CIN-031",
      barcode: "7891000000052",
      min: 4,
      supplier: sup1!.id,
    },
    {
      name: "Café Torrado 500g",
      cat: "Alimentos",
      brand: "Campo",
      cost: 14.5,
      price: 32.9,
      sku: "CAF-040",
      barcode: "7891000000069",
      min: 12,
      supplier: sup2!.id,
    },
    {
      name: "Biscoito Amanteigado 180g",
      cat: "Alimentos",
      brand: "Campo",
      cost: 4.2,
      price: 9.9,
      sku: "BIS-041",
      barcode: "7891000000076",
      min: 20,
      supplier: sup2!.id,
    },
    {
      name: "Shampoo Neutro 300ml",
      cat: "Higiene",
      brand: "Lumen",
      cost: 8.4,
      price: 22.5,
      sku: "SHA-050",
      barcode: "7891000000083",
      min: 10,
      supplier: sup2!.id,
    },
    {
      name: "Sabonete Barra 90g",
      cat: "Higiene",
      brand: "Campo",
      cost: 1.8,
      price: 5.5,
      sku: "SAB-051",
      barcode: "7891000000090",
      min: 24,
      supplier: sup2!.id,
    },
    {
      name: "Fone Bluetooth Compact",
      cat: "Eletrônicos",
      brand: "Lumen",
      cost: 48,
      price: 129.9,
      sku: "FON-060",
      barcode: "7891000000106",
      min: 3,
      supplier: sup2!.id,
    },
    {
      name: "Carregador USB-C 30W",
      cat: "Eletrônicos",
      brand: "Lumen",
      cost: 27,
      price: 79.9,
      sku: "CAR-061",
      barcode: "7891000000113",
      min: 5,
      supplier: sup2!.id,
    },
    {
      name: "Meia Cano Médio (par)",
      cat: "Vestuário",
      brand: "Norte",
      cost: 6.5,
      price: 19.9,
      sku: "MEI-002",
      barcode: "7891000000120",
      min: 15,
      supplier: sup1!.id,
    },
  ];

  const variants: {
    id: number;
    productId: number;
    price: number;
    cost: number;
    name: string;
    categoryId: number | null;
    parentCategoryId: number | null;
  }[] = [];

  for (const d of defs) {
    const [p] = await sql<{ id: number }>`
      insert into products (
        company_id, internal_code, barcode, sku, name, category_id, brand_id, supplier_id,
        unit, cost, price, min_stock, location, is_active, has_variants, description
      ) values (
        ${companyId}, ${d.sku}, ${d.barcode}, ${d.sku}, ${d.name}, ${catIds[d.cat] ?? null},
        ${brandIds[d.brand] ?? null}, ${d.supplier}, 'UN', ${d.cost}, ${d.price}, ${d.min},
        'Gôndola A', true, ${Boolean(d.variants)}, ${"Produto ativo no mix da loja."}
      ) returning id
    `;
    const productId = p!.id;
    if (d.variants?.length) {
      await sql`update products set has_variants = true where id = ${productId}`;
      for (const v of d.variants) {
        const sku = `${d.sku}-${v.color.slice(0, 3).toUpperCase()}-${v.size}`;
        const barcode = sku;
        const [row] = await sql<{ id: number }>`
          insert into product_variants (company_id, product_id, sku, barcode, color, size, cost, price)
          values (${companyId}, ${productId}, ${sku}, ${barcode}, ${v.color}, ${v.size}, ${d.cost}, ${d.price})
          returning id
        `;
        variants.push({
          id: row!.id,
          productId,
          price: d.price,
          cost: d.cost,
          name: `${d.name} ${v.color} ${v.size}`,
          categoryId: catIds[d.cat] ?? null,
          parentCategoryId: catParent[d.cat] ?? null,
        });
      }
    } else {
      const [row] = await sql<{ id: number }>`
        insert into product_variants (company_id, product_id, sku, barcode, cost, price)
        values (${companyId}, ${productId}, ${d.sku}, ${d.barcode}, ${d.cost}, ${d.price})
        returning id
      `;
      variants.push({
        id: row!.id,
        productId,
        price: d.price,
        cost: d.cost,
        name: d.name,
        categoryId: catIds[d.cat] ?? null,
        parentCategoryId: catParent[d.cat] ?? null,
      });
    }
  }

  for (const v of variants) {
    const qtyA = 6 + (v.id % 18);
    await applyStockChange(sql, {
      companyId,
      storeId,
      variantId: v.id,
      delta: qtyA,
      type: "entrada",
      userId,
      note: "Estoque inicial",
      referenceType: "seed",
    });
    await applyStockChange(sql, {
      companyId,
      storeId: storeB,
      variantId: v.id,
      delta: 3 + (v.id % 8),
      type: "entrada",
      userId,
      note: "Estoque inicial filial",
      referenceType: "seed",
    });
  }

  const customers = [
    ["Ana Paula Costa", "pf", "venda", "11981112233"],
    ["Bruno Ferreira", "pf", "venda", "11982223344"],
    ["Carla Mendes", "pf", "negociacao", "11983334455"],
    ["Diego Souza", "pf", "interessado", "11984445566"],
    ["Ateliê Lélis ME", "pj", "venda", "1130904000"],
    ["Escola Horizonte", "pj", "orcamento", "1140805000"],
    ["Helena Dias", "pf", "novo", "11985556677"],
    ["Igor Nascimento", "pf", "perdido", "11986667788"],
  ] as const;

  const customerIds: number[] = [];
  for (const [name, kind, stage, phone] of customers) {
    const [c] = await sql<{ id: number }>`
      insert into customers (
        company_id, kind, name, phone, whatsapp, city, state, crm_stage, seller_id, credit_limit
      ) values (
        ${companyId}, ${kind}, ${name}, ${phone}, ${phone}, 'São Paulo', 'SP', ${stage},
        ${seller2!.id}, ${kind === "pj" ? 2500 : 800}
      ) returning id
    `;
    customerIds.push(c!.id);
  }

  await sql`
    insert into crm_tasks (company_id, customer_id, user_id, title, due_at)
    values
      (${companyId}, ${customerIds[2]}, ${userId}, 'Enviar proposta de uniforme', now() + interval '1 day'),
      (${companyId}, ${customerIds[5]}, ${userId}, 'Retornar orçamento escolar', now() + interval '2 day')
  `;

  const methods = ["dinheiro", "pix", "debito", "credito"] as const;
  const rand = rng(companyId * 997);
  const sellerMeta: Record<
    number,
    { pct: number; name: string; regime: string; salary: number; dependents: number; issRate?: number | null }
  > = {
    [seller1!.id]: { pct: 4, name: ctx.userName || "Administrador", regime: "none", salary: 0, dependents: 0 },
    [seller2!.id]: { pct: 5, name: "Camila Ribeiro", regime: "clt", salary: 2800, dependents: 1 },
    [seller3!.id]: { pct: 4.5, name: "João Martins", regime: "autonomo", salary: 0, dependents: 0 },
    [seller4!.id]: { pct: 4, name: "Marina Costa", regime: "mei", salary: 0, dependents: 0, issRate: null },
  };
  const sellers = [seller1!.id, seller2!.id, seller3!.id, seller4!.id];
  let saleNo = 0;

  for (let day = 27; day >= 0; day--) {
    const nSales = 1 + Math.floor(rand() * 3);
    for (let s = 0; s < nSales; s++) {
      const v = variants[Math.floor(rand() * variants.length)]!;
      const qty = 1 + Math.floor(rand() * 2);
      const price = v.price;
      const total = Number((price * qty).toFixed(2));
      const cost = Number((v.cost * qty).toFixed(2));
      const method = methods[Math.floor(rand() * methods.length)]!;
      const sellerId = sellers[Math.floor(rand() * sellers.length)]!;
      const customerId = customerIds[Math.floor(rand() * 4)]!;
      const store = day === 0 || rand() > 0.25 ? storeId : storeB;
      saleNo += 1;
      const hour = 9 + Math.floor(rand() * 10);
      const minute = Math.floor(rand() * 60);
      const soldAt = new Date(Date.now() - day * 86400000);
      soldAt.setHours(hour, minute, 0, 0);
      const [sale] = await sql<{ id: number }>`
        insert into sales (
          company_id, store_id, number, customer_id, seller_id, user_id, status,
          subtotal, discount, total, cost_total, sold_at
        ) values (
          ${companyId}, ${store}, ${saleNo}, ${customerId}, ${sellerId}, ${userId}, 'finalizada',
          ${total}, 0, ${total}, ${cost}, ${soldAt.toISOString()}
        ) returning id
      `;
      await sql`
        insert into sale_items (
          company_id, sale_id, variant_id, product_id, description, quantity, unit_price, discount, total, cost
        ) values (
          ${companyId}, ${sale!.id}, ${v.id}, ${v.productId}, ${v.name}, ${qty}, ${price}, 0, ${total}, ${v.cost}
        )
      `;
      await sql`
        insert into payments (company_id, sale_id, method, amount, received, change_amount, installments)
        values (${companyId}, ${sale!.id}, ${method}, ${total}, ${method === "dinheiro" ? total + 10 : total}, ${method === "dinheiro" ? 10 : 0}, ${method === "credito" ? 2 : 1})
      `;
      try {
        await applyStockChange(sql, {
          companyId,
          storeId: store,
          variantId: v.id,
          delta: -qty,
          type: "venda",
          userId,
          referenceType: "sale",
          referenceId: sale!.id,
        });
      } catch {
        /* ignore insufficient on seed */
      }
      const meta = sellerMeta[sellerId] ?? { pct: 4, name: "Vendedor" };
      const result = computeCommission({
        sellerId,
        sellerPercent: meta.pct,
        sellerName: meta.name,
        paymentMethod: method,
        monthRevenue: 0,
        rules: commissionRules,
        items: [
          {
            productId: v.productId,
            productName: v.name,
            categoryId: v.categoryId,
            parentCategoryId: v.parentCategoryId,
            quantity: qty,
            total,
            costTotal: cost,
            discount: 0,
          },
        ],
      });
      if (result.amount > 0.009) {
        const tax = computeNetCommission({
          gross: result.amount,
          profile: resolveTaxProfile({
            regime: meta.regime,
            monthlySalary: meta.salary,
            dependents: meta.dependents,
            sellerIssRate: meta.issRate ?? null,
            companyIssRate: 5,
            companyWithholdIss: true,
          }),
        });
        await sql`
          insert into commissions (
            company_id, seller_id, sale_id, amount, percent, status, rule_id, note, breakdown,
            net_amount, tax_inss, tax_irrf, tax_iss, tax_other, tax_breakdown
          )
          values (
            ${companyId}, ${sellerId}, ${sale!.id}, ${result.amount}, ${result.percent},
            'pendente', ${result.ruleId}, ${result.note}, ${JSON.stringify(result.lines)}::jsonb,
            ${tax.net}, ${tax.inss}, ${tax.irrf}, ${tax.iss}, ${tax.other}, ${JSON.stringify(taxToJson(tax))}::jsonb
          )
        `;
      }
    }
  }

  await sql.query(
    `insert into company_counters (company_id, key, value) values ($1, 'sale', $2)
     on conflict (company_id, key) do update set value = excluded.value`,
    [companyId, saleNo],
  );

  const [purchase] = await sql<{ id: number }>`
    insert into purchases (
      company_id, store_id, supplier_id, number, status, notes, subtotal, freight, tax, total,
      expected_at, user_id
    ) values (
      ${companyId}, ${storeId}, ${sup1!.id}, 1, 'pedido', 'Reposição de malha', 890, 45, 0, 935,
      current_date + 5, ${userId}
    ) returning id
  `;
  const restock = variants[0]!;
  await sql`
    insert into purchase_items (
      company_id, purchase_id, variant_id, product_id, description, quantity, unit_cost, total
    ) values (
      ${companyId}, ${purchase!.id}, ${restock.id}, ${restock.productId}, ${restock.name}, 20, ${restock.cost}, ${20 * restock.cost}
    )
  `;
  await sql.query(
    `insert into company_counters (company_id, key, value) values ($1, 'purchase', 1)
     on conflict (company_id, key) do update set value = excluded.value`,
    [companyId],
  );

  await sql`
    insert into accounts_payable (
      company_id, store_id, supplier_id, purchase_id, description, category, due_date, amount, status, user_id
    ) values
      (${companyId}, ${storeId}, ${sup1!.id}, ${purchase!.id}, 'Pedido Aurora Têxtil', 'Compras', current_date + 7, 935, 'pendente', ${userId}),
      (${companyId}, ${storeId}, null, null, 'Aluguel loja centro', 'Aluguel', current_date - 2, 4200, 'pendente', ${userId}),
      (${companyId}, ${storeId}, ${sup2!.id}, null, 'Norte Dist. NF 441', 'Compras', current_date + 12, 1580, 'pendente', ${userId})
  `;

  await sql`
    insert into accounts_receivable (
      company_id, store_id, customer_id, description, due_date, amount, status, user_id
    ) values
      (${companyId}, ${storeId}, ${customerIds[4]}, 'Crediário uniforme Ateliê Lélis', current_date + 10, 890, 'pendente', ${userId}),
      (${companyId}, ${storeId}, ${customerIds[1]}, 'Restante venda parcelada', current_date - 3, 249.9, 'pendente', ${userId})
  `;

  await sql`
    insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id)
    values
      (${companyId}, ${storeId}, 'Energia elétrica', 'Energia', 640, current_date - 8, 'banco', ${userId}),
      (${companyId}, ${storeId}, 'Anúncio redes', 'Marketing', 320, current_date - 4, 'pix', ${userId})
  `;

  const monthStart = new Date();
  monthStart.setDate(1);
  const y = monthStart.getFullYear();
  const m = String(monthStart.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, monthStart.getMonth() + 1, 0).getDate();
  await sql`
    insert into targets (company_id, store_id, name, period_start, period_end, amount)
    values
      (${companyId}, ${storeId}, 'Faturamento mensal — Centro', ${`${y}-${m}-01`}, ${`${y}-${m}-${last}`}, 45000),
      (${companyId}, null, 'Faturamento consolidado', ${`${y}-${m}-01`}, ${`${y}-${m}-${last}`}, 70000)
  `;
  await sql`
    insert into targets (company_id, seller_id, name, period_start, period_end, amount, bonus_kind, bonus_value)
    values
      (${companyId}, ${seller1!.id}, ${`Meta ${ctx.userName || "Administrador"}`}, ${`${y}-${m}-01`}, ${`${y}-${m}-${last}`}, 1500, 'extra_percent', 2),
      (${companyId}, ${seller2!.id}, 'Meta Camila Ribeiro', ${`${y}-${m}-01`}, ${`${y}-${m}-${last}`}, 18000, 'extra_percent', 1.5),
      (${companyId}, ${seller3!.id}, 'Meta João Martins', ${`${y}-${m}-01`}, ${`${y}-${m}-${last}`}, 10000, 'extra_fixed', 150)
  `;

  await sql`
    insert into promotions (company_id, name, kind, percent, min_qty, starts_at, ends_at, is_active)
    values (${companyId}, 'Leve 3 e ganhe 10%', 'qty', 10, 3, current_date - 2, current_date + 20, true)
  `;
  await sql`
    insert into promotions (company_id, name, kind, percent, category_id, starts_at, ends_at, is_active)
    values (${companyId}, 'Vestuário -15%', 'percent', 15, ${catIds["Vestuário"]}, current_date - 1, current_date + 10, true)
  `;

  await sql`
    insert into cash_registers (company_id, store_id, user_id, opening_amount, status)
    values (${companyId}, ${storeId}, ${userId}, 350, 'open')
  `;

  await sql`update companies set updated_at = now() where id = ${companyId}`;
}
