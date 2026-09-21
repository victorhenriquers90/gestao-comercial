import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan, can } from "@/lib/permissions";
import { dump, type Row } from "@/lib/json";
import { optionalLine } from "@/lib/sanitize";
import { parseCountedQuantity } from "@/lib/stock-count";
import { num } from "@/lib/utils";
import { assertStore, assertVariants, audit, requireTenant } from "./context";
import { applyStockChange } from "./stock";

/**
 * Inventario (contagem fisica / balanco).
 *
 * Ate aqui o saldo so mudava por venda, compra, devolucao, transferencia ou
 * ajuste avulso -- nao havia como conferir a PRATELEIRA contra o que o
 * sistema acha que existe. Em loja de roupa o saldo desencontra sozinho
 * (peca trocada no provador, furto, recebimento contado errado), e sem
 * contagem o "Estoque baixo" do painel vai virando ficcao.
 *
 * A decisao que define o recurso esta na migration 0024: ao aplicar,
 * lanca-se a DIFERENCA encontrada, nao o contado como saldo absoluto --
 * senao toda venda feita entre contar e aplicar e desfeita.
 */

export const listStockCountsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.read");
    const rows = await sql.query<Row>(
      `select c.id, c.store_id, c.status, c.note, c.created_at, c.applied_at,
              st.name as store_name,
              (select count(*)::int from stock_count_items i where i.count_id = c.id) as items,
              (select count(*)::int from stock_count_items i
                where i.count_id = c.id and i.counted <> i.expected) as divergentes
         from stock_counts c
         join stores st on st.id = c.store_id
        where c.company_id = $1
          and ($2::int is null or c.store_id = $2)
        order by c.created_at desc
        limit 50`,
      [tenant.companyId, data.storeId ?? null],
    );
    return dump(rows);
  });

export const openStockCountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number; note?: string }) => ({
    ...d,
    note: optionalLine(d.note, 200) ?? undefined,
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");
    await assertStore(sql, tenant.companyId, data.storeId);
    try {
      const [row] = await sql<{ id: number }>`
        insert into stock_counts (company_id, store_id, status, note, user_id)
        values (${tenant.companyId}, ${data.storeId}, 'aberto', ${data.note ?? null}, ${tenant.userId})
        returning id
      `;
      await audit(sql, tenant, "open", "stock_count", row!.id, null, { storeId: data.storeId });
      return { id: row!.id };
    } catch (err) {
      // O indice parcial `stock_counts_one_open_idx` e a guarda real contra
      // duas contagens simultaneas na mesma loja (duplo clique, duas abas);
      // sem isto o erro cru do Postgres (23505) vazaria pro operador.
      if (String((err as { code?: string }).code) === "23505") {
        throw new Error("Já existe um inventário em contagem nesta loja.");
      }
      throw err;
    }
  });

export const getStockCountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.read");
    const [count] = await sql<Row>`
      select c.*, st.name as store_name from stock_counts c
        join stores st on st.id = c.store_id
       where c.id = ${data.id} and c.company_id = ${tenant.companyId}
    `;
    if (!count) throw new Error("Inventário não encontrado.");

    // Custo so pra quem ja pode ve-lo em outro lugar (mesma regra do
    // searchPosFn): o valor da divergencia e informacao de margem.
    const podeVerCusto = can(tenant.role, "products.read");
    const items = await sql.query<Row>(
      `select i.id, i.variant_id, i.expected, i.counted, i.counted_at,
              p.name, v.color, v.size, coalesce(v.sku, p.sku) as sku,
              ${podeVerCusto ? "coalesce(v.cost, p.cost)" : "0"} as cost
         from stock_count_items i
         join product_variants v on v.id = i.variant_id
         join products p on p.id = v.product_id
        where i.count_id = $1 and i.company_id = $2
        order by i.counted_at desc, p.name`,
      [data.id, tenant.companyId],
    );
    return dump({ count, items });
  });

export const saveCountItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { countId: number; variantId: number; counted: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");
    await assertVariants(sql, tenant.companyId, [data.variantId]);
    const counted = parseCountedQuantity(data.counted);

    const [count] = await sql<{ store_id: number; status: string }>`
      select store_id, status from stock_counts
       where id = ${data.countId} and company_id = ${tenant.companyId}
    `;
    if (!count) throw new Error("Inventário não encontrado.");
    if (count.status !== "aberto") throw new Error("Este inventário já foi encerrado.");

    /*
      O `expected` e relido a CADA contagem, nao apenas na primeira.

      Recontar e uma observacao nova da prateleira. Se entre a primeira
      contagem e a recontagem uma peca foi vendida, o esperado de agora e
      outro -- e e contra ele que o contado de agora precisa ser comparado.
      Congelar o esperado da primeira vez faria a recontagem produzir uma
      diferenca que nao existe.
    */
    const [inv] = await sql<{ quantity: string | number }>`
      select quantity from inventories
       where company_id = ${tenant.companyId} and store_id = ${count.store_id}
         and variant_id = ${data.variantId}
    `;
    const expected = num(inv?.quantity);

    await sql`
      insert into stock_count_items (
        company_id, count_id, variant_id, expected, counted, counted_at, counted_by
      ) values (
        ${tenant.companyId}, ${data.countId}, ${data.variantId}, ${expected}, ${counted},
        now(), ${tenant.userId}
      )
      on conflict (count_id, variant_id) do update
        set expected = excluded.expected,
            counted = excluded.counted,
            counted_at = now(),
            counted_by = excluded.counted_by
    `;
    return { expected, counted, diff: Number((counted - expected).toFixed(3)) };
  });

export const removeCountItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { countId: number; variantId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");
    const [count] = await sql<{ status: string }>`
      select status from stock_counts where id = ${data.countId} and company_id = ${tenant.companyId}
    `;
    if (!count) throw new Error("Inventário não encontrado.");
    if (count.status !== "aberto") throw new Error("Este inventário já foi encerrado.");
    await sql`
      delete from stock_count_items
       where count_id = ${data.countId} and variant_id = ${data.variantId}
         and company_id = ${tenant.companyId}
    `;
    return { ok: true };
  });

export const cancelStockCountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");
    const rows = await sql<{ id: number }>`
      update stock_counts set status = 'cancelado'
       where id = ${data.id} and company_id = ${tenant.companyId} and status = 'aberto'
       returning id
    `;
    if (!rows.length) throw new Error("Inventário não encontrado ou já encerrado.");
    await audit(sql, tenant, "cancel", "stock_count", data.id);
    return { ok: true };
  });

export const applyStockCountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "stock.adjust");

    return sql.transaction(async (tx) => {
      /*
        `for update` no cabecalho: sem a trava, dois cliques em "Aplicar"
        passam os dois pela checagem de status e lancam a diferenca DUAS
        vezes. O estoque ficaria com o dobro do ajuste -- o inventario, que
        existe justamente pra corrigir o saldo, seria quem o quebraria.
      */
      const [count] = await tx<{ store_id: number; status: string }>`
        select store_id, status from stock_counts
         where id = ${data.id} and company_id = ${tenant.companyId} for update
      `;
      if (!count) throw new Error("Inventário não encontrado.");
      if (count.status !== "aberto") throw new Error("Este inventário já foi encerrado.");

      const items = await tx<{
        variant_id: number;
        expected: string | number;
        counted: string | number;
      }>`
        select variant_id, expected, counted from stock_count_items
         where count_id = ${data.id} and company_id = ${tenant.companyId}
      `;
      if (!items.length) throw new Error("Conte ao menos uma peça antes de aplicar.");

      let ajustados = 0;
      let sobras = 0;
      let faltas = 0;
      for (const item of items) {
        const diff = Number((num(item.counted) - num(item.expected)).toFixed(3));
        if (diff === 0) continue;
        ajustados++;
        if (diff > 0) sobras += diff;
        else faltas += -diff;
        await applyStockChange(tx, {
          companyId: tenant.companyId,
          storeId: count.store_id,
          variantId: item.variant_id,
          // A DIFERENCA, nao o contado. Aplicar o contado como saldo
          // absoluto desfaria toda venda feita entre contar e aplicar.
          delta: diff,
          type: "inventario",
          userId: tenant.userId,
          note: `Inventário #${data.id}`,
          referenceType: "stock_count",
          referenceId: data.id,
          // A contagem manda sobre a guarda de saldo negativo: se a
          // prateleira tem menos do que o sistema acha, o numero certo e o
          // da prateleira.
          allowNegative: true,
        });
      }

      await tx`
        update stock_counts
           set status = 'aplicado', applied_at = now(), applied_by = ${tenant.userId}
         where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await audit(tx, tenant, "apply", "stock_count", data.id, null, {
        items: items.length,
        ajustados,
        sobras: Number(sobras.toFixed(3)),
        faltas: Number(faltas.toFixed(3)),
      });
      return {
        items: items.length,
        ajustados,
        sobras: Number(sobras.toFixed(3)),
        faltas: Number(faltas.toFixed(3)),
      };
    });
  });
