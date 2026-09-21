import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { dump, type Row } from "@/lib/json";
import { assertCan } from "@/lib/permissions";
import { dailyRate, parsePositiveDays, suggestQuantity } from "@/lib/purchase-suggestion";
import { num } from "@/lib/utils";
import { assertStore, requireTenant } from "./context";

/**
 * O que repor, quanto, e pra quem pedir.
 *
 * O minimo ja estava cadastrado e o painel ja apontava "Estoque baixo" --
 * o que faltava era virar pedido. A lista de alerta responde "o que esta
 * acabando"; esta responde "quanto comprar, de quem".
 *
 * Agrupa por FORNECEDOR porque e assim que se compra: ninguem faz um pedido
 * misturando cinco fornecedores. Com o agrupamento, cada bloco vira
 * diretamente um pedido de compra.
 */
export const suggestPurchaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number; coberturaDias?: number; janelaDias?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "purchases.read");
    await assertStore(sql, tenant.companyId, data.storeId);

    const cobertura = parsePositiveDays(data.coberturaDias ?? 30, "a cobertura", 365);
    const janela = parsePositiveDays(data.janelaDias ?? 60, "a janela de histórico", 365);

    const rows = await sql.query<Row>(
      `select v.id as variant_id, p.id as product_id, p.name, v.color, v.size,
              coalesce(v.sku, p.sku) as sku, p.unit,
              coalesce(i.quantity, 0) as saldo,
              -- MESMA definicao de "minimo" que o painel usa: o maior entre o
              -- minimo daquela loja e o do produto. A tela de Estoque olhava
              -- so o do produto, e as duas discordavam sobre o que esta
              -- abaixo do minimo.
              greatest(coalesce(i.min_stock, 0), coalesce(p.min_stock, 0)) as minimo,
              coalesce(v.cost, p.cost) as cost,
              p.supplier_id, f.legal_name as supplier_name,
              coalesce(sv.vendido, 0) as vendido
         from product_variants v
         join products p on p.id = v.product_id
         left join inventories i on i.variant_id = v.id and i.store_id = $2
         left join suppliers f on f.id = p.supplier_id
         left join (
           select si.variant_id, sum(si.quantity) as vendido
             from sale_items si
             join sales sa on sa.id = si.sale_id
            where sa.company_id = $1 and sa.status = 'finalizada' and sa.deleted_at is null
              and sa.store_id = $2
              -- Sem cast na coluna: comparar sold_at direto com now() menos o
              -- intervalo usa indice; castar a coluna para date nao usaria.
              and sa.sold_at >= now() - ($3 || ' days')::interval
            group by si.variant_id
         ) sv on sv.variant_id = v.id
        where v.company_id = $1 and v.deleted_at is null and p.deleted_at is null
          and p.is_active = true and v.is_active = true`,
      [tenant.companyId, data.storeId, String(janela)],
    );

    const itens = rows
      .map((r) => {
        const consumoDiario = dailyRate(num(r.vendido), janela);
        const s = suggestQuantity({
          saldo: num(r.saldo),
          minimo: num(r.minimo),
          consumoDiario,
          coberturaDias: cobertura,
        });
        const cost = num(r.cost);
        return {
          variantId: num(r.variant_id),
          productId: num(r.product_id),
          descricao: [r.name, r.color, r.size].filter(Boolean).join(" · "),
          sku: r.sku == null ? null : String(r.sku),
          unit: String(r.unit ?? "UN"),
          saldo: num(r.saldo),
          minimo: num(r.minimo),
          vendidoNaJanela: num(r.vendido),
          consumoDiario,
          diasDeCobertura: s.diasDeCobertura,
          sugerido: s.quantidade,
          motivo: s.motivo,
          cost,
          total: Number((s.quantidade * cost).toFixed(2)),
          supplierId: r.supplier_id == null ? null : num(r.supplier_id),
          supplierName: r.supplier_name == null ? null : String(r.supplier_name),
        };
      })
      .filter((i) => i.sugerido > 0)
      // Pelo mais urgente: quem ja esta abaixo do minimo primeiro, e dentro
      // disso quem acaba antes.
      .sort((a, b) => {
        if (a.motivo !== b.motivo) return a.motivo === "abaixo-do-minimo" ? -1 : 1;
        const ca = a.diasDeCobertura ?? Number.POSITIVE_INFINITY;
        const cb = b.diasDeCobertura ?? Number.POSITIVE_INFINITY;
        if (ca !== cb) return ca - cb;
        return a.descricao.localeCompare(b.descricao, "pt-BR");
      });

    // Agrupado por fornecedor: cada grupo vira um pedido.
    const grupos = new Map<string, { supplierId: number | null; supplierName: string; itens: typeof itens; total: number }>();
    for (const i of itens) {
      const chave = String(i.supplierId ?? "sem");
      const g = grupos.get(chave) ?? {
        supplierId: i.supplierId,
        supplierName: i.supplierName ?? "Sem fornecedor definido",
        itens: [] as typeof itens,
        total: 0,
      };
      g.itens.push(i);
      g.total = Number((g.total + i.total).toFixed(2));
      grupos.set(chave, g);
    }

    return dump({
      cobertura,
      janela,
      totalItens: itens.length,
      totalValor: Number(itens.reduce((a, i) => a + i.total, 0).toFixed(2)),
      // Fornecedor definido primeiro; "sem fornecedor" por ultimo, porque e
      // o grupo que exige decidir de quem comprar antes de virar pedido.
      grupos: [...grupos.values()].sort((a, b) => {
        if ((a.supplierId == null) !== (b.supplierId == null)) return a.supplierId == null ? 1 : -1;
        return b.total - a.total;
      }),
    });
  });
