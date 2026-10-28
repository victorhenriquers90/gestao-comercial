import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  CASH_DIFFERENCE_TOLERANCE,
  breakdownExactTotal,
  classifyDifference,
  needsExplanation,
  normalizeBreakdown,
} from "@/lib/cash-count";
import { isReceiptMethod, isTargetBonusKind, type TargetBonusKind } from "@/lib/constants";
import type { Sql } from "@/lib/db";
import { dump, type Row } from "@/lib/json";
import { assertCan, can } from "@/lib/permissions";
import { optionalLine, requireIsoDate, requireLine, requireMoney, requireMultiline } from "@/lib/sanitize";
import { planReversal, planSettlement } from "@/lib/settlement";
import { checkHandover, parseHandoverAmount, safeAmount } from "@/lib/shift-handover";
import { num } from "@/lib/utils";
import { parsePaging } from "@/lib/paging";
import { allocateTax, money, type TaxResult } from "@/lib/tax";
import type { CommissionSlipData } from "@/components/commission-slip";
import { assertOwned, assertStore, assertStoreOptional, audit, auditUpdate, requireTenant, type Tenant } from "./context";
import { taxForSeller, taxInsert } from "./commission";
import { ymdLocal } from "@/lib/local-date";

function accountStatus(row: { status: string; due_date: string; amount: unknown; paid?: unknown; received?: unknown }) {
  if (row.status === "pago" || row.status === "cancelado") return row.status;
  const open = num(row.amount) - num(row.paid ?? row.received);
  if (open <= 0.009) return "pago";
  if (row.due_date < ymdLocal() && row.status !== "pago") return "vencido";
  if (open < num(row.amount)) return "parcial";
  return row.status;
}

export const listPayablesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; status?: string; q?: string; limit?: number; offset?: number }) => ({
    ...d,
    page: parsePaging(d),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    const termo = data.q?.trim();
    // Sem busca nem paginacao antes: uma despesa recorrente (aluguel,
    // fornecedor fixo) sozinha ja passa de 100 lancamentos em menos de um
    // ano, mesmo teto silencioso do item 63/77 (ver listExpensesFn acima) --
    // so que aqui ninguem tinha notado ainda porque a lista nunca tinha
    // ficado grande o bastante no piloto. `status` continua filtrado em JS
    // (accountStatus calcula "vencido" por linha, nao da pra repetir isso
    // no SQL sem arriscar descasar da mesma logica) -- so busca e paginacao
    // viram SQL.
    const rows = await sql.query<Row>(
      `select count(*) over() as row_count, ap.*, s.legal_name as supplier_name,
              ls.amount as last_settlement_amount, ls.method as last_settlement_method
         from accounts_payable ap
         left join suppliers s on s.id = ap.supplier_id
         left join lateral (
           select st.amount, st.method from account_settlements st
            where st.company_id = ap.company_id and st.kind = 'payable' and st.account_id = ap.id
              and st.reversed_at is null
            order by st.id desc limit 1
         ) ls on true
        where ap.company_id = $1 and ap.deleted_at is null
          and ($2::int is null or ap.store_id = $2)
          and ($3::text is null or ap.description ilike $3 or s.legal_name ilike $3)
        order by ap.due_date asc
        limit $4 offset $5`,
      [tenant.companyId, data.storeId ?? null, termo ? `%${termo}%` : null, data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.row_count) : 0;
    const items = rows
      .map((r) => {
        const { row_count: _rc, ...rest } = r;
        return {
          ...rest,
          amount: num(r.amount),
          paid_amount: num(r.paid_amount),
          status: accountStatus({
            status: String(r.status),
            due_date: String(r.due_date).slice(0, 10),
            amount: r.amount,
            paid: r.paid_amount,
          }),
        };
      })
      .filter((r) => !data.status || r.status === data.status);
    // Contagem de vencidos independente da busca/paginacao -- o card
    // "Títulos vencidos" do financeiro precisa do total real da empresa,
    // nao so do que coube na pagina atual ou bateu com o termo buscado.
    // Mesma definicao de "vencido" do accountStatus (saldo aberto > 0 e
    // venceu), so que calculada em SQL pra nao precisar trazer a tabela
    // inteira so pra contar -- `ymdLocal()` continua sendo quem decide
    // "hoje" (passado como parametro), o mesmo valor que accountStatus usa
    // pra cada linha, pra nao arriscar as duas contas descasarem.
    const [{ overdue_count }] = await sql.query<{ overdue_count: number }>(
      `select count(*)::int as overdue_count
         from accounts_payable ap
        where ap.company_id = $1 and ap.deleted_at is null
          and ($2::int is null or ap.store_id = $2)
          and ap.status not in ('pago', 'cancelado')
          and (ap.amount - ap.paid_amount) > 0.009
          and ap.due_date < $3::date`,
      [tenant.companyId, data.storeId ?? null, ymdLocal()],
    );
    return { items: dump(items), total, overdueTotal: overdue_count };
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
    }) => ({
      id: d.id,
      storeId: d.storeId,
      supplierId: d.supplierId,
      description: requireLine(d.description, "Campo descrição", 200),
      category: optionalLine(d.category, 60),
      dueDate: requireIsoDate(d.dueDate, "Vencimento"),
      amount: requireMoney(d.amount, "Valor"),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    await assertOwned(sql, tenant.companyId, "suppliers", data.supplierId);
    await assertStoreOptional(sql, tenant, data.storeId);
    if (data.id) {
      const id = data.id;
      return sql.transaction(async (sql) => {
        const [cur] = await sql<Row>`
          select description, category, due_date, amount, paid_amount, status, supplier_id, store_id, purchase_id
            from accounts_payable
           where id = ${id} and company_id = ${tenant.companyId} and deleted_at is null
           for update
        `;
        if (!cur) throw new Error("Conta a pagar não encontrada.");
        if (cur.status !== "pendente" && cur.status !== "parcial") {
          throw new Error("Só contas em aberto podem ser editadas.");
        }
        // Valor abaixo do que já foi pago deixaria a conta "parcial" para
        // sempre, com saldo negativo, e a baixa seguinte nunca fecharia.
        if (data.amount < num(cur.paid_amount)) {
          throw new Error("O valor não pode ficar abaixo do que já foi pago.");
        }
        // Conta que nasceu do recebimento de uma compra: vencimento, descrição
        // e categoria são do financeiro, mas valor, fornecedor e loja são da
        // compra — mexer neles aqui desencontra a conta do pedido.
        if (
          cur.purchase_id != null &&
          (Math.abs(data.amount - num(cur.amount)) > 0.005 ||
            (data.supplierId ?? null) !== (cur.supplier_id == null ? null : num(cur.supplier_id)) ||
            (data.storeId ?? null) !== (cur.store_id == null ? null : num(cur.store_id)))
        ) {
          throw new Error("Conta gerada por uma compra: só descrição, categoria e vencimento podem mudar.");
        }
        await sql`
          update accounts_payable set description = ${data.description}, category = ${data.category},
            due_date = ${data.dueDate}, amount = ${data.amount}, supplier_id = ${data.supplierId ?? null},
            store_id = ${data.storeId ?? null}
          where id = ${id} and company_id = ${tenant.companyId}
        `;
        await auditUpdate(
          sql,
          tenant,
          "accounts_payable",
          id,
          {
            description: String(cur.description),
            category: cur.category == null ? null : String(cur.category),
            dueDate: String(cur.due_date).slice(0, 10),
            amount: num(cur.amount),
            supplierId: cur.supplier_id == null ? null : num(cur.supplier_id),
            storeId: cur.store_id == null ? null : num(cur.store_id),
          },
          {
            description: data.description,
            category: data.category,
            dueDate: data.dueDate,
            amount: data.amount,
            supplierId: data.supplierId ?? null,
            storeId: data.storeId ?? null,
          },
        );
        return { id };
      });
    }
    return sql.transaction(async (sql) => {
      const [row] = await sql<{ id: number }>`
        insert into accounts_payable (
          company_id, store_id, supplier_id, description, category, due_date, amount, status, user_id
        ) values (
          ${tenant.companyId}, ${data.storeId ?? null}, ${data.supplierId ?? null}, ${data.description},
          ${data.category}, ${data.dueDate}, ${data.amount}, 'pendente', ${tenant.userId}
        ) returning id
      `;
      await audit(sql, tenant, "create", "accounts_payable", row!.id, null, {
        description: data.description,
        amount: data.amount,
        dueDate: data.dueDate,
      });
      return { id: row!.id };
    });
  });

export const settlePayableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: number;
      amount: number;
      interest?: number;
      discount?: number;
      method: string;
      /** Loja cujo caixa paga o dinheiro (a tela atual). */
      storeId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const baixa = parseSettlement(data);
    if (!isReceiptMethod(data.method)) throw new Error("Informe como foi pago.");
    const metodo = data.method;
    const status = await sql.transaction(async (sql) => {
      // `for update` trava a linha ate o commit: sem isso, duas baixas
      // simultaneas leem o mesmo paid_amount e a segunda sobrescreve a
      // primeira -- some um pagamento sem deixar rastro.
      const [row] = await sql<{
        amount: string | number;
        paid_amount: string | number;
        interest: string | number;
        discount: string | number;
        store_id: number | null;
        description: string | null;
        status: string;
      }>`
        select amount, paid_amount, interest, discount, store_id, description, status from accounts_payable
         where id = ${data.id} and company_id = ${tenant.companyId} for update
      `;
      if (!row) throw new Error("Título não encontrado.");
      if (row.status === "cancelado") throw new Error("Este título foi cancelado e não aceita baixa.");
      // Juros/desconto omitidos mantêm o que o título já tinha: uma baixa parcial
      // sem eles não pode zerar o que a anterior combinou.
      const interest = baixa.interest ?? num(row.interest);
      const discount = baixa.discount ?? num(row.discount);
      const plano = planSettlement({
        amount: num(row.amount),
        paid: num(row.paid_amount),
        interest,
        discount,
        payment: baixa.amount,
        status: row.status,
      });
      let movimentoId: number | null = null;

      /*
        Mesma correcao de settleReceivableFn, no sentido contrario: pagar um
        fornecedor em DINHEIRO (comum em entrega -- o entregador cobra na
        hora) tirava da gaveta sem lancar nada em `cash_movements`. O
        `expectedCash` do fechamento nunca descontava, e a loja fechava o
        dia com SOBRA sem explicacao -- mesma classe do bug ja corrigido em
        settleSellerBatch (pagamento de comissao). Vira sangria no caixa
        aberto da loja; sem caixa aberto nao da pra pagar em especie, igual
        ao recebimento. Tipo `sangria_liquidacao`, nao `sangria` pura -- ver
        o comentario em settleSellerBatch sobre o motivo (evitar duplicar
        este valor em cashflowFn, que ja soma `paid`).
      */
      if (metodo === "dinheiro") {
        const lojaId = data.storeId ?? row.store_id ?? null;
        if (!lojaId) throw new Error("Selecione a loja que está pagando em dinheiro.");
        await assertStore(sql, tenant, lojaId);
        const [reg] = await sql<{ id: number }>`
          select id from cash_registers
           where company_id = ${tenant.companyId} and store_id = ${lojaId} and status = 'open'
           limit 1
        `;
        if (!reg) throw new Error("Abra o caixa desta loja para pagar em dinheiro.");
        const [mov] = await sql<{ id: number }>`
          insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
          values (${tenant.companyId}, ${lojaId}, ${reg.id}, ${tenant.userId}, 'sangria_liquidacao', 'dinheiro',
                  ${baixa.amount}, ${`Pagamento: ${row.description ?? `título ${data.id}`}`})
          returning id
        `;
        movimentoId = mov!.id;
      }
      await sql`
        update accounts_payable set paid_amount = ${plano.paid}, interest = ${interest},
          discount = ${discount}, status = ${plano.status},
          paid_at = ${plano.status === "pago" ? new Date().toISOString() : null}
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await sql`
        insert into account_settlements (
          company_id, kind, account_id, amount, interest, discount, prev_interest, prev_discount,
          method, cash_movement_id, user_id
        ) values (
          ${tenant.companyId}, 'payable', ${data.id}, ${baixa.amount}, ${interest}, ${discount},
          ${num(row.interest)}, ${num(row.discount)}, ${metodo}, ${movimentoId}, ${tenant.userId}
        )
      `;
      await audit(sql, tenant, "pay", "accounts_payable", data.id, null, {
        description: row.description,
        amount: baixa.amount,
        status: plano.status,
        method: metodo,
      });
      return plano.status;
    });
    return { status };
  });

export const listReceivablesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; status?: string; q?: string; limit?: number; offset?: number }) => ({
    ...d,
    page: parsePaging(d),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    const termo = data.q?.trim();
    const rows = await sql.query<Row>(
      `select count(*) over() as row_count, ar.*, c.name as customer_name,
              ls.amount as last_settlement_amount, ls.method as last_settlement_method
         from accounts_receivable ar
         left join customers c on c.id = ar.customer_id
         left join lateral (
           select st.amount, st.method from account_settlements st
            where st.company_id = ar.company_id and st.kind = 'receivable' and st.account_id = ar.id
              and st.reversed_at is null
            order by st.id desc limit 1
         ) ls on true
        where ar.company_id = $1 and ar.deleted_at is null
          and ($2::int is null or ar.store_id = $2)
          and ($3::text is null or ar.description ilike $3 or c.name ilike $3)
        order by ar.due_date asc
        limit $4 offset $5`,
      [tenant.companyId, data.storeId ?? null, termo ? `%${termo}%` : null, data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.row_count) : 0;
    const items = rows
      .map((r) => {
        const { row_count: _rc, ...rest } = r;
        return {
          ...rest,
          amount: num(r.amount),
          received_amount: num(r.received_amount),
          status: accountStatus({
            status: String(r.status),
            due_date: String(r.due_date).slice(0, 10),
            amount: r.amount,
            received: r.received_amount,
          }),
        };
      })
      .filter((r) => !data.status || r.status === data.status);
    // Mesmo raciocinio do listPayablesFn: contagem de vencidos independente
    // da busca/paginacao, pro card "Títulos vencidos".
    const [{ overdue_count }] = await sql.query<{ overdue_count: number }>(
      `select count(*)::int as overdue_count
         from accounts_receivable ar
        where ar.company_id = $1 and ar.deleted_at is null
          and ($2::int is null or ar.store_id = $2)
          and ar.status not in ('pago', 'cancelado')
          and (ar.amount - ar.received_amount) > 0.009
          and ar.due_date < $3::date`,
      [tenant.companyId, data.storeId ?? null, ymdLocal()],
    );
    return { items: dump(items), total, overdueTotal: overdue_count };
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
    }) => ({
      id: d.id,
      storeId: d.storeId,
      customerId: d.customerId,
      description: requireLine(d.description, "Campo descrição", 200),
      dueDate: requireIsoDate(d.dueDate, "Vencimento"),
      amount: requireMoney(d.amount, "Valor"),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    await assertOwned(sql, tenant.companyId, "customers", data.customerId);
    await assertStoreOptional(sql, tenant, data.storeId);
    if (data.id) {
      const id = data.id;
      return sql.transaction(async (sql) => {
        const [cur] = await sql<Row>`
          select description, due_date, amount, received_amount, status, origin, customer_id, store_id
            from accounts_receivable
           where id = ${id} and company_id = ${tenant.companyId} and deleted_at is null
           for update
        `;
        if (!cur) throw new Error("Conta a receber não encontrada.");
        // Parcela de crediário/cartão nasce da venda; editar o valor aqui
        // desencontra o título da venda e da conciliação com a operadora.
        if (cur.origin !== "manual") {
          throw new Error("Título gerado por venda não pode ser editado aqui.");
        }
        if (cur.status !== "pendente" && cur.status !== "parcial") {
          throw new Error("Só contas em aberto podem ser editadas.");
        }
        if (data.amount < num(cur.received_amount)) {
          throw new Error("O valor não pode ficar abaixo do que já foi recebido.");
        }
        await sql`
          update accounts_receivable set description = ${data.description}, due_date = ${data.dueDate},
            amount = ${data.amount}, customer_id = ${data.customerId ?? null}, store_id = ${data.storeId ?? null}
          where id = ${id} and company_id = ${tenant.companyId}
        `;
        await auditUpdate(
          sql,
          tenant,
          "accounts_receivable",
          id,
          {
            description: String(cur.description),
            dueDate: String(cur.due_date).slice(0, 10),
            amount: num(cur.amount),
            customerId: cur.customer_id == null ? null : num(cur.customer_id),
            storeId: cur.store_id == null ? null : num(cur.store_id),
          },
          {
            description: data.description,
            dueDate: data.dueDate,
            amount: data.amount,
            customerId: data.customerId ?? null,
            storeId: data.storeId ?? null,
          },
        );
        return { id };
      });
    }
    return sql.transaction(async (sql) => {
      const [row] = await sql<{ id: number }>`
        insert into accounts_receivable (
          company_id, store_id, customer_id, description, due_date, amount, status, user_id
        ) values (
          ${tenant.companyId}, ${data.storeId ?? null}, ${data.customerId ?? null}, ${data.description},
          ${data.dueDate}, ${data.amount}, 'pendente', ${tenant.userId}
        ) returning id
      `;
      await audit(sql, tenant, "create", "accounts_receivable", row!.id, null, {
        description: data.description,
        amount: data.amount,
        dueDate: data.dueDate,
      });
      return { id: row!.id };
    });
  });

export const settleReceivableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: number;
      amount: number;
      interest?: number;
      discount?: number;
      method: string;
      /** Loja cujo caixa recebe o dinheiro (a tela atual). */
      storeId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const baixa = parseSettlement(data);
    if (!isReceiptMethod(data.method)) throw new Error("Informe como o cliente pagou.");
    const metodo = data.method;
    const status = await sql.transaction(async (sql) => {
      const [row] = await sql<{
        amount: string | number;
        received_amount: string | number;
        interest: string | number;
        discount: string | number;
        store_id: number | null;
        description: string | null;
        status: string;
      }>`
        select amount, received_amount, interest, discount, store_id, description, status from accounts_receivable
         where id = ${data.id} and company_id = ${tenant.companyId} for update
      `;
      if (!row) throw new Error("Título não encontrado.");
      if (row.status === "cancelado") throw new Error("Este título foi cancelado e não aceita baixa.");
      const interest = baixa.interest ?? num(row.interest);
      const discount = baixa.discount ?? num(row.discount);
      const plano = planSettlement({
        amount: num(row.amount),
        paid: num(row.received_amount),
        interest,
        discount,
        payment: baixa.amount,
        status: row.status,
      });
      let movimentoId: number | null = null;

      /*
        Parcela paga em DINHEIRO no balcao entra na gaveta. Antes a baixa nao
        lancava nada no caixa: o esperado do fechamento nao sabia desse
        dinheiro e a gaveta fechava com SOBRA sem explicacao -- todo dia, numa
        loja que vive de crediario. Agora vira movimentacao 'recebimento' no
        caixa aberto da loja (e sem caixa aberto nao da pra receber em
        especie, igual a venda).
      */
      if (metodo === "dinheiro") {
        const lojaId = data.storeId ?? row.store_id ?? null;
        if (!lojaId) throw new Error("Selecione a loja que está recebendo o dinheiro.");
        await assertStore(sql, tenant, lojaId);
        const [reg] = await sql<{ id: number }>`
          select id from cash_registers
           where company_id = ${tenant.companyId} and store_id = ${lojaId} and status = 'open'
           limit 1
        `;
        if (!reg) throw new Error("Abra o caixa desta loja para receber em dinheiro.");
        const [mov] = await sql<{ id: number }>`
          insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
          values (${tenant.companyId}, ${lojaId}, ${reg.id}, ${tenant.userId}, 'recebimento', 'dinheiro',
                  ${baixa.amount}, ${`Recebimento: ${row.description ?? `título ${data.id}`}`})
          returning id
        `;
        movimentoId = mov!.id;
      }
      await sql`
        update accounts_receivable set received_amount = ${plano.paid}, interest = ${interest},
          discount = ${discount}, status = ${plano.status},
          received_at = ${plano.status === "pago" ? new Date().toISOString() : null}
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await sql`
        insert into account_settlements (
          company_id, kind, account_id, amount, interest, discount, prev_interest, prev_discount,
          method, cash_movement_id, user_id
        ) values (
          ${tenant.companyId}, 'receivable', ${data.id}, ${baixa.amount}, ${interest}, ${discount},
          ${num(row.interest)}, ${num(row.discount)}, ${metodo}, ${movimentoId}, ${tenant.userId}
        )
      `;
      // Auditoria que faltava: dar baixa em recebimento nao deixava rastro
      // nenhum, enquanto o pagamento deixava. Era justamente o lado que some
      // dinheiro de dentro pra fora.
      await audit(sql, tenant, "receive", "accounts_receivable", data.id, null, {
        description: row.description,
        amount: baixa.amount,
        status: plano.status,
        method: metodo,
      });
      return plano.status;
    });
    return { status };
  });

/**
 * Desfaz a ULTIMA baixa de um titulo (pagou o fornecedor errado, recebeu do
 * cliente errado, digitou o valor errado).
 *
 * So a ultima, e so quando o razao (account_settlements) explica 100% do total
 * baixado: baixa anterior ao razao, baixa feita pelo servico antigo ou parcela
 * de cartao conciliada nao tem como ser desfeita sem adivinhar -- o estorno
 * recusa em vez de inventar.
 *
 * Baixa em dinheiro mexe na gaveta de novo: pagamento a fornecedor devolve o
 * dinheiro (estorno_liquidacao) e recebimento tira (estorno_recebimento), no
 * caixa ABERTO da loja -- e la que o dinheiro realmente volta a se mover, mesmo
 * que o caixa da baixa original ja tenha fechado (esse fechamento nao muda).
 */
export const reverseSettlementFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: string; id: number; reason: string }) => {
    if (d.kind !== "payable" && d.kind !== "receivable") throw new Error("Tipo de título inválido.");
    return { kind: d.kind, id: d.id, reason: parseCancelReason(d.reason) };
  })
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    const pagar = data.kind === "payable";
    return sql.transaction(async (sql) => {
      const [t] = pagar
        ? await sql<Row>`
            select amount, paid_amount as paid, description, status from accounts_payable
             where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null for update
          `
        : await sql<Row>`
            select amount, received_amount as paid, description, status from accounts_receivable
             where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null for update
          `;
      if (!t) throw new Error("Título não encontrado.");
      if (t.status === "cancelado") throw new Error("Título cancelado não tem baixa a estornar.");
      const abertas = await sql<Row>`
        select id, amount, method, cash_movement_id, prev_interest, prev_discount from account_settlements
         where company_id = ${tenant.companyId} and kind = ${data.kind} and account_id = ${data.id}
           and reversed_at is null
         order by id desc for update
      `;
      const ultima = abertas[0];
      if (!ultima) {
        throw new Error(
          num(t.paid) > 0.009
            ? "Esta baixa é anterior ao registro de estornos, então o sistema não consegue desfazê-la sozinho."
            : "Este título não tem baixa a estornar.",
        );
      }
      const registrado = abertas.reduce((a, r) => a + num(r.amount), 0);
      if (Math.abs(registrado - num(t.paid)) > 0.011) {
        throw new Error(
          "O total baixado deste título não bate com o registro das baixas (há baixa anterior ao registro de estornos), então o sistema não consegue desfazê-la sozinho.",
        );
      }
      const valor = num(ultima.amount);

      let estornoId: number | null = null;
      if (ultima.cash_movement_id != null) {
        const [orig] = await sql<Row>`
          select store_id from cash_movements
           where id = ${num(ultima.cash_movement_id)} and company_id = ${tenant.companyId}
        `;
        if (!orig) throw new Error("Não foi possível localizar a movimentação de caixa desta baixa.");
        // `for update` serializa com o fechamento: o caixa não fecha entre a checagem e o estorno.
        const [reg] = await sql<{ id: number }>`
          select id from cash_registers
           where company_id = ${tenant.companyId} and store_id = ${num(orig.store_id)} and status = 'open'
           limit 1 for update
        `;
        if (!reg) {
          throw new Error(
            pagar
              ? "Abra o caixa desta loja para estornar um pagamento feito em dinheiro: o dinheiro volta para a gaveta."
              : "Abra o caixa desta loja para estornar um recebimento feito em dinheiro: o dinheiro sai da gaveta.",
          );
        }
        const [mov] = await sql<{ id: number }>`
          insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
          values (${tenant.companyId}, ${num(orig.store_id)}, ${reg.id}, ${tenant.userId},
                  ${pagar ? "estorno_liquidacao" : "estorno_recebimento"}, 'dinheiro', ${valor},
                  ${`${pagar ? "Estorno de pagamento" : "Estorno de recebimento"}: ${String(t.description ?? `título ${data.id}`)}`})
          returning id
        `;
        estornoId = mov!.id;
      }

      const novo = planReversal({ paid: num(t.paid), amount: valor });
      if (pagar) {
        await sql`
          update accounts_payable set paid_amount = ${novo.paid}, interest = ${num(ultima.prev_interest)},
            discount = ${num(ultima.prev_discount)}, status = ${novo.status}, paid_at = null
           where id = ${data.id} and company_id = ${tenant.companyId}
        `;
      } else {
        await sql`
          update accounts_receivable set received_amount = ${novo.paid}, interest = ${num(ultima.prev_interest)},
            discount = ${num(ultima.prev_discount)}, status = ${novo.status}, received_at = null
           where id = ${data.id} and company_id = ${tenant.companyId}
        `;
      }
      await sql`
        update account_settlements set reversed_at = now(), reversed_by = ${tenant.userId},
          reverse_reason = ${data.reason}, reverse_movement_id = ${estornoId}
         where id = ${num(ultima.id)} and company_id = ${tenant.companyId}
      `;
      await audit(
        sql,
        tenant,
        pagar ? "reverse-pay" : "reverse-receive",
        pagar ? "accounts_payable" : "accounts_receivable",
        data.id,
        null,
        {
          description: String(t.description ?? ""),
          amount: valor,
          method: String(ultima.method),
          status: novo.status,
          cashReversal: estornoId != null && pagar ? valor : null,
          cashRemoved: estornoId != null && !pagar ? valor : null,
          reason: data.reason,
        },
      );
      return { status: novo.status, paid: novo.paid };
    });
  });

export const cashflowFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { from: string; to: string; storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    const inflows = await sql.query<{ method: string; total: string | number }>(
      // p.amount (nao s.total): o que entrou de verdade por forma de
      // pagamento no checkout -- devolucao nao desfaz o pagamento original,
      // entao so devolvida_parcial entra no filtro, sem descontar nada.
      `select p.method, coalesce(sum(p.amount),0) as total
         from payments p
         join sales s on s.id = p.sale_id
        where s.company_id = $1 and s.status in ('finalizada','devolvida_parcial') and s.deleted_at is null
          and s.sold_at >= $2::date and s.sold_at < ($3::date + interval '1 day')
          and ($4::int is null or s.store_id = $4)
        group by p.method`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    /*
      `received_amount`/`paid_amount` sao CUMULATIVOS na linha do titulo, e
      `received_at`/`paid_at` so gravam data quando o titulo fecha 100% (ver
      settleReceivableFn/settlePayableFn) -- ficam NULL enquanto o status e
      'parcial'. Um titulo pago em duas parcelas em dias diferentes (comum
      no crediario) sumia do fluxo de caixa no dia da PRIMEIRA parcela e
      aparecia inteiro (as duas parcelas somadas) no dia da ULTIMA, mesmo que
      so uma fracao tivesse entrado naquele dia. Verificado com transacao
      revertida: consulta antiga dava 0 no dia 1 e o total das duas parcelas
      no dia 3, quando o certo e cada parcela no seu proprio dia.

      audit_logs ja guarda, por evento, o valor daquela baixa especifica
      (`after_data.amount`, nao cumulativo) com a data real do evento -- soma
      daqui em vez da linha resumo.
    */
    const rec = await sql.query<{ total: string | number }>(
      `select coalesce(sum(case when al.action = 'receive' then 1 else -1 end * (al.after_data->>'amount')::numeric),0) as total
         from audit_logs al
         join accounts_receivable ar on ar.id = al.entity_id::int
        where al.company_id = $1 and al.entity = 'accounts_receivable' and al.action in ('receive', 'reverse-receive')
          and al.created_at >= $2::date and al.created_at < ($3::date + interval '1 day')
          and ($4::int is null or ar.store_id = $4)`,
      [tenant.companyId, data.from, data.to, data.storeId ?? null],
    );
    const paid = await sql.query<{ total: string | number }>(
      `select coalesce(sum(case when al.action = 'pay' then 1 else -1 end * (al.after_data->>'amount')::numeric),0) as total
         from audit_logs al
         join accounts_payable ap on ap.id = al.entity_id::int
        where al.company_id = $1 and al.entity = 'accounts_payable' and al.action in ('pay', 'reverse-pay')
          and al.created_at >= $2::date and al.created_at < ($3::date + interval '1 day')
          and ($4::int is null or ap.store_id = $4)`,
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
    /*
      Cartao (debito/credito) e crediario nao viram dinheiro no dia da venda
      -- viram um recebivel que so chega de verdade na liquidacao (cartao)
      ou na cobranca (crediario), e É POR ISSO que `extraIn`, logo abaixo,
      soma esses eventos separadamente. Somar o valor da VENDA aqui (em
      `salesIn`) e o valor da LIQUIDACAO/COBRANCA depois (em `extraIn`)
      contava o mesmo dinheiro duas vezes -- uma venda de R$100 no cartao
      inflava "Entradas" pra R$197 assim que a parcela caia, e numa venda
      parcelada em varios meses o mesmo furo se repete a cada parcela
      cobrada. `inflows` (a lista por forma de pagamento, exibida na aba
      Fluxo de caixa) continua com todos os metodos -- ali o interesse e
      "quanto se vendeu por forma", nao "quanto dinheiro entrou de verdade".
    */
    const NAO_E_DINHEIRO_NO_DIA = new Set(["debito", "credito", "crediario"]);
    const salesIn = inflows
      .filter((r) => !NAO_E_DINHEIRO_NO_DIA.has(String(r.method)))
      .reduce((a, r) => a + num(r.total), 0);
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

type RegisterCash = {
  /** Total vendido no turno, todos os meios. */
  sales: number;
  cashSales: number;
  expectedCash: number;
};

type RegisterSummary = {
  /** Quantas vendas passaram pelo turno. Quantidade, nao valor. */
  salesCount: number;
  pix: number;
  cards: number;
  sangria: number;
  suprimento: number;
  devolucoes: number;
  /** Parcelas/titulos recebidos em dinheiro no turno. */
  recebimentos: number;
  /**
   * Os numeros que entregam o dinheiro esperado. `null` enquanto a
   * conferencia esta cega.
   *
   * Ausente, nao zerado: zero passaria por valor conferido, e no dia em que
   * um bug zerasse isto o fechamento pareceria bater sozinho. Ausente
   * quebra a tela -- que e o comportamento certo pra um numero que nao pode
   * ser adivinhado.
   *
   * `sales` mora aqui junto com `cashSales` porque total menos PIX menos
   * cartao E o dinheiro: publicar o total "que nao e sensivel" devolveria a
   * ancora por subtracao.
   */
  cash: RegisterCash | null;
};

type OpenRegister = {
  id: number;
  opening_amount: number;
  notes: string | null;
  opened_at: string | null;
  user_id: string | null;
  /** Quando (e se) alguem revelou o esperado antes do fechamento. */
  expected_revealed_at: string | null;
  /** Dias de calendario desde a abertura. 0 = aberto hoje. */
  days_open: number;
};

/**
 * Turno anterior que deixou dinheiro na gaveta e ainda nao foi recebido.
 *
 * O VALOR NAO VEM AQUI de proposito: quem entra conta a gaveta antes de ver
 * quanto o outro disse ter deixado. Mandar o numero junto seria o mesmo erro
 * do "dinheiro esperado" na tela do fechamento -- a segunda contagem viraria
 * transcricao da primeira, e a troca deixaria de conferir coisa nenhuma.
 */
type PendingHandover = {
  registerId: number;
  closedAt: string | null;
  by: string | null;
};

type RegisterView = {
  register: OpenRegister | null;
  /** So quando nao ha caixa aberto: ha troco esperando ser conferido. */
  handover: PendingHandover | null;
  movements: Row[];
  summary: RegisterSummary | null;
};

/**
 * Estado do caixa aberto.
 *
 * `canReveal` e a permissao de quem pergunta; `force` e o fechamento, que
 * calcula o esperado pra comparar. Sem um dos dois, os numeros de dinheiro
 * nao sao carregados -- e os lancamentos de VENDA tambem nao saem daqui,
 * porque a lista de movimentacoes fica logo abaixo do campo da contagem e
 * somar treze linhas na tela e ancora igual.
 *
 * Sangria, suprimento e devolucao continuam visiveis de proposito: foi o
 * proprio operador que lancou, ele precisa conferir se lancou certo, e
 * nenhum deles revela quanto se vendeu em dinheiro.
 */
async function loadOpenRegister(
  sql: Sql,
  companyId: number,
  storeId: number,
  opts: { canReveal?: boolean; force?: boolean; lock?: boolean } = {},
): Promise<RegisterView> {
  const [reg] = await sql.query<Row>(
    // `days_open` sai daqui, e nao do cliente: `current_date` e
    // `opened_at::date` usam o mesmo fuso da sessao do banco. Calcular o dia
    // em JS com toISOString() daria UTC, e um caixa aberto as 22h em
    // Brasilia ja nasceria "de ontem".
    `select *, (current_date - opened_at::date)::int as days_open
       from cash_registers
      where company_id = $1 and store_id = $2 and status = 'open'
      order by opened_at desc limit 1` + (opts.lock ? " for update" : ""),
    [companyId, storeId],
  );
  if (!reg) {
    return {
      register: null,
      handover: await loadPendingHandover(sql, companyId, storeId),
      movements: [],
      summary: null,
    };
  }
  const revelar = opts.force === true || (opts.canReveal === true && reg.expected_revealed_at != null);

  const movements = await sql<Row>`
    select * from cash_movements
     where register_id = ${num(reg.id)} and company_id = ${companyId}
     order by created_at desc
  `;
  const byMethod = await sql<{ method: string | null; type: string; total: string | number }>`
    select method, type, coalesce(sum(amount),0) as total
    from cash_movements where register_id = ${num(reg.id)} and company_id = ${companyId}
    group by method, type
  `;
  // count(distinct sale_id) e nao count(*): venda paga metade no cartao e
  // metade em dinheiro gera dois lancamentos e continua sendo uma venda.
  const [vendas] = await sql<{ n: number }>`
    select count(distinct sale_id)::int as n from cash_movements
     where register_id = ${num(reg.id)} and company_id = ${companyId} and type = 'venda'
  `;

  const sales = byMethod.filter((m) => m.type === "venda").reduce((a, m) => a + num(m.total), 0);
  const cashSales = num(byMethod.find((m) => m.type === "venda" && m.method === "dinheiro")?.total);
  const pix = num(byMethod.find((m) => m.type === "venda" && m.method === "pix")?.total);
  const cards = byMethod
    .filter((m) => m.type === "venda" && (m.method === "debito" || m.method === "credito"))
    .reduce((a, m) => a + num(m.total), 0);
  // 'sangria_liquidacao' e o mesmo dinheiro saindo da gaveta que
  // settleSellerBatch/settlePayableFn ja lancam quando pagam em especie --
  // conta aqui pro fechamento (expectedCash so soma cash_movements), mas
  // NAO em cashflowFn (que ja soma esse mesmo valor via `expenses`/`paid`;
  // somar os dois ali duplicava o valor em "Saidas").
  // 'estorno_liquidacao' e o dinheiro de uma despesa cancelada voltando pra
  // gaveta: entra COM SINAL NEGATIVO aqui, entao o esperado volta ao que era
  // antes do pagamento sem mexer na formula do fechamento.
  const sangria = byMethod.reduce((a, m) => {
    if (m.type === "sangria" || m.type === "sangria_liquidacao") return a + num(m.total);
    if (m.type === "estorno_liquidacao") return a - num(m.total);
    return a;
  }, 0);
  const suprimento = byMethod.filter((m) => m.type === "suprimento").reduce((a, m) => a + num(m.total), 0);
  const refunds = byMethod
    .filter((m) => m.type === "devolucao" || m.type === "cancelamento")
    .reduce((a, m) => a + num(m.total), 0);
  // Parcela de crediario/titulo paga em especie no balcao: entra na gaveta.
  // 'estorno_recebimento' e um recebimento em dinheiro desfeito: sai da soma.
  const recebimentos = byMethod.reduce((a, m) => {
    if (m.type === "recebimento" && m.method === "dinheiro") return a + num(m.total);
    if (m.type === "estorno_recebimento") return a - num(m.total);
    return a;
  }, 0);
  const expectedCash = num(reg.opening_amount) + cashSales + recebimentos + suprimento - sangria - refunds;

  return {
    register: {
      id: num(reg.id),
      opening_amount: num(reg.opening_amount),
      notes: reg.notes == null ? null : String(reg.notes),
      opened_at: reg.opened_at == null ? null : String(reg.opened_at),
      user_id: reg.user_id == null ? null : String(reg.user_id),
      expected_revealed_at:
        reg.expected_revealed_at == null ? null : String(reg.expected_revealed_at),
      days_open: num(reg.days_open),
    },
    handover: null,
    movements: revelar ? movements : movements.filter((m) => String(m.type) !== "venda"),
    summary: {
      salesCount: num(vendas?.n),
      pix,
      cards,
      sangria,
      suprimento,
      devolucoes: refunds,
      recebimentos,
      cash: revelar ? { sales, cashSales, expectedCash: money(expectedCash) } : null,
    },
  };
}

/**
 * O ultimo fechamento desta loja deixou troco na gaveta e ninguem abriu
 * desde entao.
 *
 * Sem recorte por dia: troco que dormiu na gaveta e troco que passou pro
 * turno da tarde tem a mesma mecanica -- alguem deixou, outro alguem vai
 * contar. Recortar por dia descartaria o caso da virada e o dinheiro sumiria
 * da cadeia sem nenhum aviso.
 *
 * `not exists` garante que um fechamento so alimenta UM turno seguinte; o
 * indice unico parcial (migration 0026) e o backstop real contra a corrida.
 */
async function loadPendingHandover(
  sql: Sql,
  companyId: number,
  storeId: number,
): Promise<PendingHandover | null> {
  const [row] = await sql.query<Row>(
    `select r.id, r.closed_at, coalesce(uf.name, ua.name) as by_name
       from cash_registers r
       left join "user" uf on uf.id = r.closed_by
       left join "user" ua on ua.id = r.user_id
      where r.company_id = $1 and r.store_id = $2 and r.status = 'closed'
        and r.handover_amount is not null and r.handover_amount > 0
        and not exists (
          select 1 from cash_registers n where n.previous_register_id = r.id
        )
      order by r.closed_at desc nulls last
      limit 1`,
    [companyId, storeId],
  );
  if (!row) return null;
  return {
    registerId: num(row.id),
    closedAt: row.closed_at == null ? null : String(row.closed_at),
    by: row.by_name == null ? null : String(row.by_name),
  };
}

export const getRegisterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.read");
    await assertStore(sql, tenant, data.storeId);
    return dump(
      await loadOpenRegister(sql, tenant.companyId, data.storeId, {
        canReveal: can(tenant.role, "cash.reveal"),
      }),
    );
  });

/**
 * Revelar o esperado antes do fechamento -- permitido, e registrado.
 *
 * Proibir seria fingir que a loja nunca precisa do numero (decidir uma
 * sangria, conferir um caixa que o operador abandonou no meio do turno).
 * Quem pode revelar e quem supervisiona, nunca quem opera: se o proprio
 * caixa pudesse, a conferencia cega viraria um botao de desligar.
 *
 * O que torna isto um controle e a marca que fica: o fechamento guarda se o
 * esperado ja tinha sido revelado. Fechamento que nao foi cego nao pode
 * PARECER cego na hora de auditar.
 */
export const revealExpectedCashFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.reveal");
    await assertStore(sql, tenant, data.storeId);
    const [reg] = await sql<{ id: number }>`
      select id from cash_registers
       where company_id = ${tenant.companyId} and store_id = ${data.storeId} and status = 'open'
       order by opened_at desc limit 1
    `;
    if (!reg) throw new Error("Nenhum caixa aberto.");
    // `is null` no WHERE: a primeira revelacao e a que vale. Um segundo
    // gerente espiando nao pode empurrar o carimbo pra frente e fazer
    // parecer que o turno correu cego ate o fim.
    await sql`
      update cash_registers
         set expected_revealed_at = now(), expected_revealed_by = ${tenant.userId}
       where id = ${reg.id} and company_id = ${tenant.companyId} and expected_revealed_at is null
    `;
    // Auditado toda vez, mesmo quando ja estava revelado: o carimbo diz
    // quando a cegueira caiu, o log diz quem olhou.
    await audit(sql, tenant, "reveal-expected", "cash_register", reg.id, null, {
      storeId: data.storeId,
    });
    return dump(
      await loadOpenRegister(sql, tenant.companyId, data.storeId, { force: true }),
    );
  });

/**
 * Valores de uma baixa de titulo.
 *
 * Entravam crus, e nao e so a questao do NaN: `Infinity` e alcancavel por
 * JSON comum -- `{"amount": 1e999}` vira Infinity no JSON.parse, e o
 * Postgres aceita Infinity em coluna numeric. Tres buracos no mesmo lugar:
 *
 * 1. Valor NEGATIVO "desrecebia" um titulo ja quitado.
 * 2. Valor Infinity marcava como pago e gravava Infinity no ledger.
 * 3. DESCONTO ilimitado fazia o alvo virar negativo, entao qualquer centavo
 *    (ou zero) ja fechava como "pago" -- um titulo sumindo sem dinheiro.
 */
function parseSettlement(data: { amount: number; interest?: number; discount?: number }): {
  amount: number;
  /** undefined = nao informado: a baixa mantem o que o titulo ja tem. */
  interest: number | undefined;
  discount: number | undefined;
} {
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Informe um valor maior que zero.");
  }
  const naoNegativo = (v: unknown, rotulo: string) => {
    if (v == null || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Valor de ${rotulo} inválido.`);
    return n;
  };
  return {
    amount: Number(amount.toFixed(2)),
    interest: naoNegativo(data.interest, "juros"),
    discount: naoNegativo(data.discount, "desconto"),
  };
}

/**
 * Abrir o caixa -- e, quando o turno anterior deixou troco, RECEBER a gaveta.
 *
 * Receber e contar: quem entra lanca o que achou na gaveta e so depois ve
 * quanto o turno anterior declarou ter deixado. Aceitar o numero do outro
 * sem conferir herda o erro alheio, e a diferenca volta a nao ter dono --
 * que e o problema inteiro que a troca de turno existe pra resolver.
 */
export const openRegisterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      storeId: number;
      amount?: number;
      breakdown?: Record<string, unknown> | null;
      notes?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    await assertStore(sql, tenant, data.storeId);
    const breakdown = normalizeBreakdown(data.breakdown ?? null);
    // Ficha preenchida MANDA, igual no fechamento: o valor sai das cedulas.
    const contado = breakdown ? breakdownExactTotal(breakdown) : Number(data.amount);
    // Number.isFinite junto, e nao so `< 0`: NaN < 0 e FALSE, entao um fundo
    // NaN passava direto e virava opening_amount = NaN. Dali em diante o
    // esperado do fechamento (abertura + vendas + suprimento - sangria -
    // devolucoes) e NaN pra sempre, e o caixa desta loja nunca mais fecha.
    // Chegar em NaN e facil: "350,00" digitado no campo vira NaN no Number().
    if (!Number.isFinite(contado) || contado < 0) {
      throw new Error("Fundo inicial inválido.");
    }

    return sql.transaction(async (tx) => {
      const existing = await tx`
        select id from cash_registers
         where store_id = ${data.storeId} and company_id = ${tenant.companyId} and status = 'open'
      `;
      if (existing.length) throw new Error("Já existe um caixa aberto nesta loja.");

      const pendente = await loadPendingHandover(tx, tenant.companyId, data.storeId);
      let anterior: { id: number; handover_amount: string | number } | undefined;
      if (pendente) {
        // `for update` na linha do turno anterior: sem a trava, duas
        // aberturas simultaneas leriam o mesmo troco como disponivel. O
        // indice unico parcial ainda barra a segunda, mas aqui a recusa sai
        // como mensagem de negocio em vez de erro cru do Postgres.
        [anterior] = await tx<{ id: number; handover_amount: string | number }>`
          select id, handover_amount from cash_registers
           where id = ${pendente.registerId} and company_id = ${tenant.companyId}
           for update
        `;
      }

      let row: { id: number } | undefined;
      try {
        [row] = await tx<{ id: number }>`
          insert into cash_registers (
            company_id, store_id, user_id, opening_amount, notes, status,
            previous_register_id, opening_verified
          ) values (
            ${tenant.companyId}, ${data.storeId}, ${tenant.userId}, ${contado},
            ${optionalLine(data.notes, 400)}, 'open',
            ${anterior?.id ?? null}, ${breakdown != null}
          )
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

      // A revelacao acontece AQUI, depois de a contagem estar gravada: e o
      // mesmo contrato do fechamento cego, do outro lado da virada.
      const troca = anterior ? checkHandover(num(anterior.handover_amount), contado) : null;
      await audit(tx, tenant, "open", "cash_register", row!.id, null, {
        amount: contado,
        conferido: breakdown != null,
        breakdown,
        trocaDe: anterior?.id ?? null,
        trocaDiferenca: troca?.diferenca ?? null,
      });
      return { id: row!.id, counted: contado, verified: breakdown != null, handover: troca };
    });
  });

/**
 * Fechar o caixa: a contagem entra e o esperado e calculado no MESMO
 * instante, dentro de uma transacao.
 *
 * Um passo so, e nao "registrar contagem" -> "ver resultado" -> "fechar".
 * Dois passos abririam uma janela entre a contagem e o calculo em que uma
 * venda ainda entra: o esperado mudaria por baixo de uma contagem ja feita,
 * e a saida seria recontar -- agora sabendo o numero. A conferencia cega
 * morre exatamente ai.
 *
 * Nao existe reabrir. Contagem errada se conserta pela EXPLICACAO da
 * diferenca, que fica anexada ao fechamento com autor e hora. Trocar o
 * numero depois de ver o esperado e o unico movimento que este recurso
 * existe pra impedir -- oferecer um botao pra isso seria desfazer tudo.
 */
export const closeRegisterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      storeId: number;
      counted?: number;
      breakdown?: Record<string, unknown> | null;
      /** Quanto fica na gaveta pro proximo turno. Vazio/0 = fim do dia. */
      handover?: number;
      notes?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    await assertStore(sql, tenant, data.storeId);
    // Fora da transacao: ficha malformada nao merece abrir transacao nem
    // travar a linha do caixa.
    const breakdown = normalizeBreakdown(data.breakdown ?? null);
    const observacao = optionalLine(data.notes, 400);

    return sql.transaction(async (tx) => {
      const view = await loadOpenRegister(tx, tenant.companyId, data.storeId, {
        force: true,
        lock: true,
      });
      const aberto = view.register;
      const cash = view.summary?.cash;
      if (!aberto || !cash) throw new Error("Nenhum caixa aberto.");

      // Ficha preenchida MANDA: o total sai das cedulas, nao do campo. Sem
      // isto a ficha vira decoracao -- o numero que conta continuaria sendo
      // um valor digitado, e a contagem por cedula so daria aparencia de
      // rigor a um palpite.
      const contado = breakdown ? breakdownExactTotal(breakdown) : Number(data.counted);
      if (!Number.isFinite(contado) || contado < 0) {
        throw new Error("Informe o valor conferido em dinheiro.");
      }
      const expected = money(cash.expectedCash);
      if (!Number.isFinite(expected)) throw new Error("Não foi possível calcular o esperado.");
      const diff = money(contado - expected);
      // Validado contra o CONTADO, que so existe agora: deixar na gaveta
      // mais do que se contou inventaria dinheiro na virada.
      const troco = parseHandoverAmount(data.handover, contado);

      // `status = 'open'` no WHERE fecha a corrida do duplo clique: a
      // segunda chamada nao acha mais linha aberta e nao reescreve o
      // fechamento com uma contagem diferente.
      const [fechado] = await tx<{ id: number }>`
        update cash_registers
           set status = 'closed', closed_at = now(), closed_by = ${tenant.userId},
               closing_amount = ${contado}, expected_amount = ${expected},
               difference_amount = ${diff},
               count_breakdown = ${breakdown ? JSON.stringify(breakdown) : null}::jsonb,
               handover_amount = ${troco},
               notes = ${observacao ?? aberto.notes}
         where id = ${aberto.id} and company_id = ${tenant.companyId} and status = 'open'
        returning id
      `;
      if (!fechado) throw new Error("Este caixa já foi fechado.");

      const cego = aberto.expected_revealed_at == null;
      await audit(tx, tenant, "close", "cash_register", aberto.id, null, {
        expected,
        counted: contado,
        diff,
        cego,
        breakdown,
        ficaNaGaveta: troco,
        vaiProCofre: safeAmount(contado, troco),
      });
      return {
        registerId: aberto.id,
        expected,
        counted: contado,
        diff,
        cego,
        precisaExplicacao: needsExplanation(diff),
        ficaNaGaveta: troco,
        vaiProCofre: safeAmount(contado, troco),
        tolerancia: CASH_DIFFERENCE_TOLERANCE,
        summary: view.summary,
      };
    });
  });

/**
 * Fechamentos recentes.
 *
 * Antes o fechamento aparecia uma vez, na tela de quem fechou, e sumia. Uma
 * conferencia que ninguem revisita nao e controle: o valor esta na SERIE --
 * tres faltas seguidas de R$ 20 dizem algo que uma falta de R$ 20 nao diz.
 */
export const listCashClosuresFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.read");
    const rows = await sql.query<Row>(
      `select r.id, r.store_id, r.opened_at, r.closed_at, r.opening_amount,
              r.expected_amount, r.closing_amount, r.difference_amount,
              r.difference_reason, r.difference_explained_at,
              r.expected_revealed_at, r.count_breakdown,
              r.handover_amount, r.opening_verified, p.handover_amount as recebido_esperado,
              ua.name as opened_by_name, uf.name as closed_by_name,
              ue.name as explained_by_name,
              exists(
                select 1 from cash_registers n where n.previous_register_id = r.id
              ) as handover_consumed
         from cash_registers r
         left join "user" ua on ua.id = r.user_id
         left join "user" uf on uf.id = r.closed_by
         left join "user" ue on ue.id = r.difference_explained_by
         left join cash_registers p on p.id = r.previous_register_id
        where r.company_id = $1 and r.status = 'closed'
          and ($2::int is null or r.store_id = $2)
        order by r.closed_at desc nulls last
        limit 15`,
      [tenant.companyId, data.storeId ?? null],
    );
    return dump(
      rows.map((r) => {
        const diff = num(r.difference_amount);
        return {
          id: num(r.id),
          openedAt: r.opened_at == null ? null : String(r.opened_at),
          closedAt: r.closed_at == null ? null : String(r.closed_at),
          opening: num(r.opening_amount),
          expected: num(r.expected_amount),
          counted: num(r.closing_amount),
          diff,
          kind: classifyDifference(diff).kind,
          pendente: needsExplanation(diff) && r.difference_reason == null,
          reason: r.difference_reason == null ? null : String(r.difference_reason),
          explainedAt:
            r.difference_explained_at == null ? null : String(r.difference_explained_at),
          explainedBy: r.explained_by_name == null ? null : String(r.explained_by_name),
          // Fechamento em que o esperado ja tinha sido revelado nao e cego,
          // e quem revisa precisa saber disso pra ler a diferenca (ou a
          // ausencia dela) pelo que ela vale.
          cego: r.expected_revealed_at == null,
          openedBy: r.opened_by_name == null ? null : String(r.opened_by_name),
          closedBy: r.closed_by_name == null ? null : String(r.closed_by_name),
          breakdown: (r.count_breakdown ?? null) as Record<string, number> | null,
          /*
            Lado do turno que a lista nao mostrava: quanto ficou na gaveta pro
            proximo e se quem abriu CONFERIU o que recebeu. Sem isso, turno
            aberto no olho e turno conferido ficam identicos no relatorio e a
            diferenca dos dois se le com a mesma confianca.

            Mas so revela o VALOR depois que o proximo turno ja abriu (ja fez
            a propria contagem cega) -- `handover_consumed`, mesma condicao de
            `loadPendingHandover`. Antes disso, esta MESMA tela (Caixa) e que
            mostra o formulario de abertura cega pro operador seguinte: listar
            o valor aqui, logo abaixo do formulario, entregava de bandeja
            exatamente o numero que a contagem cega existe pra nao revelar
            antes de contar -- o "Fechamentos recentes" nao e tela separada, e
            a secao seguinte da mesma pagina.
          */
          handoverPendente: r.handover_amount != null && num(r.handover_amount) > 0 && !r.handover_consumed,
          ficaNaGaveta: podeRevelarHandover(r) ? num(r.handover_amount) : null,
          vaiProCofre: podeRevelarHandover(r)
            ? safeAmount(num(r.closing_amount), num(r.handover_amount))
            : null,
          aberturaConferida: r.opening_verified === true,
          recebido:
            r.recebido_esperado == null
              ? null
              : checkHandover(num(r.recebido_esperado), num(r.opening_amount)),
        };
      }),
    );
  });

/** So revela o troco de turno depois que o proximo ja abriu (ja contou as cegas). */
function podeRevelarHandover(r: Row): boolean {
  return r.handover_amount != null && (r.handover_consumed === true || num(r.handover_amount) === 0);
}

/**
 * Explicar a diferenca de um fechamento.
 *
 * So preenche o que esta vazio (`is null` no WHERE): a primeira explicacao e
 * a que fica. Permitir reescrever transformaria o campo num rascunho, e um
 * rascunho nao serve de prova de nada.
 */
export const explainCashDifferenceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { registerId: number; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    const motivo = requireMultiline(data.reason, "Explicação", 600);
    if (motivo.length < 5) {
      throw new Error("Descreva o que aconteceu — uma palavra não explica uma diferença.");
    }
    const [reg] = await sql<Row>`
      select id, status, difference_amount, difference_reason
        from cash_registers
       where id = ${num(data.registerId)} and company_id = ${tenant.companyId}
    `;
    if (!reg) throw new Error("Fechamento não encontrado.");
    if (String(reg.status) !== "closed") throw new Error("Este caixa ainda está aberto.");
    const [ok] = await sql<{ id: number }>`
      update cash_registers
         set difference_reason = ${motivo}, difference_explained_at = now(),
             difference_explained_by = ${tenant.userId}
       where id = ${num(reg.id)} and company_id = ${tenant.companyId}
         and difference_reason is null
      returning id
    `;
    if (!ok) throw new Error("Esta diferença já foi explicada.");
    await audit(sql, tenant, "explain-difference", "cash_register", num(reg.id), null, {
      diff: num(reg.difference_amount),
      reason: motivo,
    });
    return { ok: true };
  });

export const cashMoveFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId: number; type: "sangria" | "suprimento"; amount: number; description: string }) => {
    // Validado AQUI, nao so na tela. A checagem que existia vivia em
    // caixa.tsx, e validacao de tela nao vale para quem chama o servidor
    // direto. Importa porque estes valores entram no expectedCash do
    // fechamento (= abertura + vendas em dinheiro + suprimento - sangria -
    // devolucoes): um suprimento NEGATIVO derruba o dinheiro esperado, e a
    // diferenca em especie some da conferencia -- o mesmo desvio que a
    // validacao de pagamento fechou por outra porta.
    if (d.type !== "sangria" && d.type !== "suprimento") {
      throw new Error("Tipo de movimentação inválido.");
    }
    return {
      storeId: d.storeId,
      type: d.type,
      amount: requireMoney(d.amount, "Valor"),
      description: optionalLine(d.description, 200),
    };
  })
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "cash.write");
    await assertStore(sql, tenant, data.storeId);
    await sql.transaction(async (sql) => {
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
      // Dinheiro entrando ou saindo da gaveta sem rastro de quem lançou e por
      // quê é o buraco que a Auditoria existe pra fechar.
      await audit(sql, tenant, data.type, "cash_register", reg.id, null, {
        amount: data.amount,
        reason: data.description,
      });
    });
    return { ok: true };
  });

export const listExpensesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { storeId?: number | null; limit?: number; offset?: number }) => ({ ...d, page: parsePaging(d) }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");
    // Mesmo store_id que "Saidas" no fluxo de caixa (cashflowFn) ja usa --
    // sem isto, trocar de loja no seletor do topo mudava o card "Saidas" mas
    // a lista de despesas embaixo continuava mostrando as DUAS lojas juntas,
    // sem coluna nenhuma indicando de qual loja era cada uma.
    // Mesmo teto silencioso do item 63/77: `limit 100` sem contagem nem
    // paginacao -- despesa recorrente (aluguel, energia) sozinha ja passa de
    // 100 lancamentos em menos de um ano.
    const rows = await sql.query<Row>(
      `select count(*) over() as row_count, e.*
         from expenses e
        where e.company_id = $1 and e.deleted_at is null
          and ($2::int is null or e.store_id = $2)
        order by e.spent_at desc
        limit $3 offset $4`,
      [tenant.companyId, data.storeId ?? null, data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.row_count) : 0;
    return { items: dump(rows.map((r) => { const { row_count: _rc, ...rest } = r; return rest; })), total };
  });

export const saveExpenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      description: string;
      category?: string;
      amount: number;
      spentAt: string;
      accountKind?: string;
      method: string;
      /** Loja cujo caixa paga o dinheiro (a tela atual). */
      storeId?: number | null;
    }) => ({
      description: requireLine(d.description, "Campo descrição", 200),
      category: optionalLine(d.category, 60),
      amount: requireMoney(d.amount, "Valor"),
      spentAt: requireIsoDate(d.spentAt, "Data da despesa"),
      accountKind: optionalLine(d.accountKind, 40),
      method: d.method,
      storeId: d.storeId,
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    await assertStoreOptional(sql, tenant, data.storeId);
    if (!isReceiptMethod(data.method)) throw new Error("Informe como foi pago.");
    await sql.transaction(async (sql) => {
      /*
        Mesma classe de bug de settlePayableFn/settleSellerBatch: uma despesa
        manual (motoboy, material de limpeza) paga em DINHEIRO da gaveta
        nunca gerava `cash_movements` -- o `expectedCash` do fechamento nao
        descontava, e a loja fechava o dia com SOBRA sem explicacao. Tipo
        `sangria_liquidacao`, nao `sangria` pura, pelo mesmo motivo: esta
        despesa ja esta em `expenses`, que o `cashflowFn` ja soma em
        "Saidas" -- uma `sangria` normal duplicaria o valor la.
      */
      let cashMovementId: number | null = null;
      if (data.method === "dinheiro") {
        if (!data.storeId) throw new Error("Selecione a loja para lançar a despesa em dinheiro.");
        await assertStore(sql, tenant, data.storeId);
        const [reg] = await sql<{ id: number }>`
          select id from cash_registers
           where company_id = ${tenant.companyId} and store_id = ${data.storeId} and status = 'open'
           limit 1
        `;
        if (!reg) throw new Error("Abra o caixa desta loja para lançar a despesa em dinheiro.");
        const [mov] = await sql<{ id: number }>`
          insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
          values (${tenant.companyId}, ${data.storeId}, ${reg.id}, ${tenant.userId}, 'sangria_liquidacao', 'dinheiro',
                  ${data.amount}, ${`Despesa: ${data.description}`})
          returning id
        `;
        cashMovementId = mov!.id;
      }
      const [exp] = await sql<{ id: number }>`
        insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id, method, cash_movement_id)
        values (${tenant.companyId}, ${data.storeId ?? null}, ${data.description}, ${data.category}, ${data.amount}, ${data.spentAt}, ${data.accountKind}, ${tenant.userId}, ${data.method}, ${cashMovementId})
        returning id
      `;
      await audit(sql, tenant, "create", "expense", exp!.id, null, {
        description: data.description,
        amount: data.amount,
        category: data.category,
        method: data.method,
      });
    });
    return { ok: true };
  });

/*
  Cancelamento de lançamentos do financeiro.

  Até aqui um lançamento errado (valor digitado com zero a mais, despesa em
  duplicidade, conta a pagar de fornecedor trocado) não tinha saída: ficava
  no fluxo de caixa para sempre. Cancelar NÃO apaga: a conta vira
  'cancelado' (some dos totais em aberto, que filtram por status) e a despesa
  recebe `deleted_at` (some de "Saídas"); a linha continua no banco e o
  cancelamento fica na Auditoria com quem fez e por quê.

  Só cancela o que ainda não teve dinheiro andando: conta com pagamento ou
  recebimento registrado teria de estornar a baixa, e essa reversão (caixa,
  cartão, fluxo) é outra operação — fica recusada aqui, com a mensagem dizendo
  por quê.
*/
function parseCancelReason(raw: unknown): string {
  return requireLine(raw, "Motivo", 200);
}

export const cancelPayableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; reason: string }) => ({ id: d.id, reason: parseCancelReason(d.reason) }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    return sql.transaction(async (sql) => {
      const [cur] = await sql<Row>`
        select description, amount, paid_amount, due_date, status, purchase_id
          from accounts_payable
         where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
         for update
      `;
      if (!cur) throw new Error("Conta a pagar não encontrada.");
      if (cur.status === "cancelado") throw new Error("Esta conta já foi cancelada.");
      if (cur.status === "pago" || num(cur.paid_amount) > 0.009) {
        throw new Error("Conta com pagamento registrado não pode ser cancelada.");
      }
      if (cur.purchase_id != null) {
        throw new Error("Conta gerada pelo recebimento de uma compra não pode ser cancelada aqui.");
      }
      await sql`
        update accounts_payable set status = 'cancelado'
         where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await audit(sql, tenant, "cancel", "accounts_payable", data.id, null, {
        description: String(cur.description),
        amount: num(cur.amount),
        dueDate: String(cur.due_date).slice(0, 10),
        reason: data.reason,
      });
      return { ok: true };
    });
  });

export const cancelReceivableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; reason: string }) => ({ id: d.id, reason: parseCancelReason(d.reason) }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    return sql.transaction(async (sql) => {
      const [cur] = await sql<Row>`
        select description, amount, received_amount, due_date, status, origin
          from accounts_receivable
         where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
         for update
      `;
      if (!cur) throw new Error("Conta a receber não encontrada.");
      if (cur.status === "cancelado") throw new Error("Esta conta já foi cancelada.");
      // Parcela de crediário/cartão nasce da venda; quem a desfaz é o cancelamento
      // ou a devolução da venda, que também acerta estoque, caixa e comissão.
      if (cur.origin !== "manual") {
        throw new Error("Título gerado por venda não pode ser cancelado aqui.");
      }
      if (cur.status === "pago" || num(cur.received_amount) > 0.009) {
        throw new Error("Conta com recebimento registrado não pode ser cancelada.");
      }
      await sql`
        update accounts_receivable set status = 'cancelado'
         where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await audit(sql, tenant, "cancel", "accounts_receivable", data.id, null, {
        description: String(cur.description),
        amount: num(cur.amount),
        dueDate: String(cur.due_date).slice(0, 10),
        reason: data.reason,
      });
      return { ok: true };
    });
  });

export const cancelExpenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; reason: string }) => ({ id: d.id, reason: parseCancelReason(d.reason) }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    return sql.transaction(async (sql) => {
      const [cur] = await sql<Row>`
        select description, category, amount, method, cash_movement_id
          from expenses
         where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
         for update
      `;
      if (!cur) throw new Error("Despesa não encontrada ou já cancelada.");
      const amount = num(cur.amount);
      let devolvidoAoCaixa = 0;

      if (cur.cash_movement_id != null) {
        // Despesa paga em dinheiro: o valor saiu da gaveta e o esperado do
        // fechamento já o descontou. Cancelar sem devolver deixaria o caixa
        // com SOBRA igual ao valor. `for update` no caixa serializa com o
        // fechamento: sem isso o caixa podia fechar entre a checagem e o estorno.
        const [mov] = await sql<Row>`
          select m.store_id, m.register_id, r.status as register_status
            from cash_movements m
            join cash_registers r on r.id = m.register_id and r.company_id = ${tenant.companyId}
           where m.id = ${num(cur.cash_movement_id)} and m.company_id = ${tenant.companyId}
           for update of r
        `;
        if (!mov) throw new Error("Não foi possível localizar o pagamento desta despesa no caixa.");
        if (mov.register_status !== "open") {
          throw new Error(
            "Esta despesa foi paga em dinheiro num caixa que já fechou, então o cancelamento não consegue devolver o dinheiro à gaveta. Se o dinheiro voltou, lance um suprimento no caixa aberto explicando o motivo.",
          );
        }
        await sql`
          insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
          values (${tenant.companyId}, ${num(mov.store_id)}, ${num(mov.register_id)}, ${tenant.userId},
                  'estorno_liquidacao', 'dinheiro', ${amount}, ${`Estorno: ${String(cur.description)}`})
        `;
        devolvidoAoCaixa = amount;
      } else if (cur.method == null) {
        // Despesa anterior ao vínculo com o caixa: não dá para saber se foi em
        // dinheiro. Se existe saída de caixa com a mesma descrição e valor,
        // cancelar deixaria essa saída órfã — melhor recusar do que adivinhar.
        const [orfa] = await sql<{ id: number }>`
          select id from cash_movements
           where company_id = ${tenant.companyId} and type = 'sangria_liquidacao'
             and description = ${`Despesa: ${String(cur.description)}`} and amount = ${amount}
           limit 1
        `;
        if (orfa) {
          throw new Error(
            "Esta despesa é anterior ao vínculo com o caixa e foi paga em dinheiro; o sistema não consegue devolver esse dinheiro à gaveta automaticamente.",
          );
        }
      }

      await sql`
        update expenses set deleted_at = now()
         where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await audit(sql, tenant, "cancel", "expense", data.id, null, {
        description: String(cur.description),
        amount,
        category: cur.category == null ? null : String(cur.category),
        method: cur.method == null ? null : String(cur.method),
        cashReversal: devolvidoAoCaixa > 0 ? devolvidoAoCaixa : null,
        reason: data.reason,
      });
      return { ok: true, cashReversal: devolvidoAoCaixa };
    });
  });

export const listTargetsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "targets.read");
    /*
      O realizado de cada meta vem junto, por `left join lateral`, em vez de
      uma consulta por meta.

      Aqui o N+1 era pior que no PDV: esta tela lista TODAS as metas da
      empresa, sem filtro de periodo, e meta acumula mes a mes -- com cinco
      vendedores e um ano de loja sao ~60 idas ao banco por abertura de tela,
      crescendo pra sempre.

      O bloco lateral enxerga a linha `t`, entao cada meta continua sendo
      avaliada com o SEU periodo, loja, vendedor e categoria. `left join`
      mantem a meta sem venda no periodo aparecendo com realizado zero.
    */
    const rows = await sql<Row>`
      select t.*, sl.name as seller_name, st.name as store_name, c.name as category_name,
             coalesce(r.v, 0) as realized
      from targets t
      left join sellers sl on sl.id = t.seller_id
      left join stores st on st.id = t.store_id
      left join categories c on c.id = t.category_id
      left join lateral (
        -- devolvida_parcial entra, liquido do que voltou (return_items) --
        -- mesma correcao de commission.ts/insight.ts: sales.total nunca
        -- reduz numa devolucao parcial, entao sem isto a venda inteira
        -- sumia da meta por causa de uma peca devolvida.
        select coalesce(sum(s.total - coalesce(ret.returned_revenue,0)), 0) as v
          from sales s
          left join lateral (
            select coalesce(sum(ri.amount), 0) as returned_revenue
              from return_items ri
              join sale_items si on si.id = ri.sale_item_id
             where si.sale_id = s.id
          ) ret on true
         where s.company_id = t.company_id
           and s.status in ('finalizada', 'devolvida_parcial') and s.deleted_at is null
           and s.sold_at >= t.period_start
           and s.sold_at < (t.period_end + interval '1 day')
           and (t.store_id is null or s.store_id = t.store_id)
           and (t.seller_id is null or s.seller_id = t.seller_id)
           and (t.category_id is null or exists (
             select 1 from sale_items si join products p on p.id = si.product_id
              where si.sale_id = s.id and p.category_id = t.category_id
           ))
      ) r on true
      where t.company_id = ${tenant.companyId} and t.deleted_at is null
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
      const amount = num(t.amount);
      const done = num(t.realized);
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
    await assertOwned(sql, tenant.companyId, "sellers", data.sellerId);
    await assertOwned(sql, tenant.companyId, "categories", data.categoryId);
    await assertStoreOptional(sql, tenant, data.storeId);
    // Nome em branco, valor alem do numeric(14,2) e data inexistente (31/02)
    // chegavam ao banco e voltavam como erro cru do Postgres.
    const name = requireLine(data.name, "Nome da meta", 120);
    const amount = requireMoney(data.amount, "Valor da meta");
    const periodStart = requireIsoDate(data.periodStart, "Início do período");
    const periodEnd = requireIsoDate(data.periodEnd, "Fim do período");
    if (periodEnd < periodStart) throw new Error("O fim do período deve ser depois do início.");
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
    const after = { name, amount, periodStart, periodEnd, storeId, sellerId, categoryId, bonusKind, bonusValue };
    return sql.transaction(async (sql) => {
      if (data.id) {
        const [cur] = await sql<Row>`
          select name, amount, period_start, period_end, store_id, seller_id, category_id, bonus_kind, bonus_value
            from targets
           where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
           for update
        `;
        if (!cur) throw new Error("Meta não encontrada.");
        await sql`
          update targets set
            name = ${name},
            amount = ${amount},
            period_start = ${periodStart},
            period_end = ${periodEnd},
            store_id = ${storeId},
            seller_id = ${sellerId},
            category_id = ${categoryId},
            bonus_kind = ${bonusKind},
            bonus_value = ${bonusValue}
          where id = ${data.id} and company_id = ${tenant.companyId}
        `;
        await auditUpdate(
          sql,
          tenant,
          "target",
          data.id,
          {
            name: String(cur.name),
            amount: num(cur.amount),
            periodStart: String(cur.period_start).slice(0, 10),
            periodEnd: String(cur.period_end).slice(0, 10),
            storeId: cur.store_id == null ? null : num(cur.store_id),
            sellerId: cur.seller_id == null ? null : num(cur.seller_id),
            categoryId: cur.category_id == null ? null : num(cur.category_id),
            bonusKind: String(cur.bonus_kind ?? "none"),
            bonusValue: num(cur.bonus_value),
          },
          after,
        );
        return { id: data.id };
      }
      const [row] = await sql<{ id: number }>`
        insert into targets (
          company_id, store_id, seller_id, category_id, name, period_start, period_end, amount,
          bonus_kind, bonus_value
        )
        values (
          ${tenant.companyId}, ${storeId}, ${sellerId}, ${categoryId},
          ${name}, ${periodStart}, ${periodEnd}, ${amount},
          ${bonusKind}, ${bonusValue}
        )
        returning id
      `;
      await audit(sql, tenant, "create", "target", row!.id, null, after);
      return { id: row!.id };
    });
  });

export const deleteTargetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "targets.write");
    // Soft delete, igual customers/products/suppliers: uma meta criada com o
    // periodo/loja/vendedor errado nao tinha como sair da tela -- so dava pra
    // editar por cima, distorcendo o historico em vez de corrigi-lo. Sem
    // filho (nada referencia targets.id), entao nao ha risco de orfao --
    // diferente de commission_rules, que precisa checar uso antes de apagar.
    return sql.transaction(async (sql) => {
      const [cur] = await sql<Row>`
        select name, amount, period_start, period_end, store_id, seller_id, category_id, bonus_kind, bonus_value
          from targets
         where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
         for update
      `;
      if (!cur) throw new Error("Meta não encontrada.");
      await sql`
        update targets set deleted_at = now()
         where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await audit(
        sql,
        tenant,
        "delete",
        "target",
        data.id,
        {
          name: String(cur.name),
          amount: num(cur.amount),
          periodStart: String(cur.period_start).slice(0, 10),
          periodEnd: String(cur.period_end).slice(0, 10),
          storeId: cur.store_id == null ? null : num(cur.store_id),
          sellerId: cur.seller_id == null ? null : num(cur.seller_id),
          categoryId: cur.category_id == null ? null : num(cur.category_id),
          bonusKind: String(cur.bonus_kind ?? "none"),
          bonusValue: num(cur.bonus_value),
        },
        null,
      );
      return { ok: true };
    });
  });

export const listCommissionsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { sellerId?: number; status?: string; limit?: number; offset?: number }) => ({
      ...d,
      page: parsePaging(d),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    /*
      Mesmo furo de sellers.read x sellers.write ja fechado em listSellersFn
      e retentionGuideFn. Aqui a lista inclui net_amount e o detalhamento de
      INSS/IRRF/ISS por comissao (a aba "Pagamentos" abre isso no clique do
      Liquido), e o filtro de vendedor da tela aceita "Todos" ou qualquer
      colega -- "vendedor" (unico papel com sellers.read sem sellers.write)
      conseguia ver o liquido e o imposto retido de qualquer outro vendedor,
      venda a venda, historico inteiro.
    */
    assertCan(tenant.role, "sellers.write");
    // Mesmo teto silencioso do item 63/77: `limit 200` sem contagem nem
    // paginacao -- cada venda com vendedor gera uma linha de comissao, entao
    // o historico (filtro "Todas"/"Pagas") passa de 200 rapido. O pagamento
    // em lote (payPendingCommissionsFn/loadPendingCommissions) e uma consulta
    // SEPARADA, sem limite -- isto aqui e so a lista que a tela mostra, nao
    // afeta quanto se paga.
    const rows = await sql.query<Row>(
      `select count(*) over() as row_count,
              c.id, c.seller_id, c.sale_id, c.amount, c.percent, c.status, c.created_at, c.paid_at, c.note,
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
        limit $4 offset $5`,
      [tenant.companyId, data.sellerId ?? null, data.status ?? null, data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.row_count) : 0;
    const items = rows.map((r) => ({
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
    return { items, total };
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
      order by c.seller_id, c.id
      for update of c`,
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
  /*
    O recibo que sai daqui pede assinatura ("Recebi o líquido acima") --
    isto paga o vendedor em dinheiro, na hora, do caixa aberto da loja. Mas
    so gravava `expenses` (account_kind 'caixa', nunca lido em lugar
    nenhum), nunca `cash_movements` -- o `expectedCash` do fechamento (ver
    loadOpenRegister) so soma `cash_movements`, entao o dinheiro que saiu
    de verdade da gaveta nunca entrava na conta. Reproduzido ao vivo:
    caixa com fundo R$500 + venda de R$100 (esperado R$600), comissão de
    R$5 paga em dinheiro, `cash_movements` do registro continuava com UMA
    linha so (a venda) -- o fechamento ia cobrar R$600 de uma gaveta com
    R$595, uma falta fantasma todo dia em que se paga comissão em
    especie. Mesma logica de `cashMoveFn` (sangria manual): se houver
    caixa aberto na loja, lança sangria pelo mesmo valor de cada despesa
    gerada aqui -- liquido pro vendedor, imposto retido separado (o
    imposto tambem sai fisicamente da gaveta, so muda de bolso dentro da
    loja). Tipo `sangria_liquidacao`, nao `sangria` pura: conta pro
    `expectedCash` do fechamento (que soma os dois tipos, ver
    loadOpenRegister) mas fica de fora do somatorio de `cashflowFn`, que
    ja conta este mesmo valor via `expenses` -- `sangria` lá ia duplicar.
    Sem caixa aberto na loja (comissao paga fora do expediente,
    ou loja nao informada), nao ha o que ajustar -- mesmo padrao do
    `if (reg)` em `checkoutFn`.
  */
  const [openReg] = storeId
    ? await sql<{ id: number }>`
        select id from cash_registers
         where company_id = ${tenant.companyId} and store_id = ${storeId} and status = 'open'
         order by opened_at desc limit 1
      `
    : [];
  await sql`
    insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id)
    values (
      ${tenant.companyId}, ${storeId ?? null},
      ${"Comissão líquida " + who + saleBit},
      'Folha', ${tax.net}, ${ymdLocal()},
      'caixa', ${tenant.userId}
    )
  `;
  if (openReg) {
    await sql`
      insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
      values (
        ${tenant.companyId}, ${storeId}, ${openReg.id}, ${tenant.userId}, 'sangria_liquidacao', 'dinheiro', ${tax.net},
        ${"Comissão líquida " + who + saleBit}
      )
    `;
  }
  if (tax.totalTax > 0.009) {
    await sql`
      insert into expenses (company_id, store_id, description, category, amount, spent_at, account_kind, user_id)
      values (
        ${tenant.companyId}, ${storeId ?? null},
        ${"Retenção INSS/IRRF/ISS · " + who + saleBit},
        'Impostos', ${tax.totalTax}, ${ymdLocal()},
        'caixa', ${tenant.userId}
      )
    `;
    if (openReg) {
      await sql`
        insert into cash_movements (company_id, store_id, register_id, user_id, type, method, amount, description)
        values (
          ${tenant.companyId}, ${storeId}, ${openReg.id}, ${tenant.userId}, 'sangria_liquidacao', 'dinheiro', ${tax.totalTax},
          ${"Retenção INSS/IRRF/ISS · " + who + saleBit}
        )
      `;
    }
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
    await assertStoreOptional(sql, tenant, data.storeId);
    /*
      Pagamento inteiro numa transacao, com as comissoes travadas (`for
      update` no loadPendingCommissions). Solto, dois cliques em Pagar
      carregavam as mesmas pendentes: o `status = 'pendente'` do update
      impedia virar duas vezes, mas as DESPESAS e o recibo saiam em dobro --
      folha contada duas vezes e um segundo recibo pra pagar de novo. E uma
      falha entre o update e o insert deixava comissao paga sem despesa.
    */
    return sql.transaction(async (sql) => {
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
  });

export const payPendingCommissionsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { sellerId?: number; storeId?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");
    await assertStoreOptional(sql, tenant, data.storeId);
    // Mesma transacao+lock do payCommissionFn; aqui tambem evita pagar
    // metade dos vendedores e parar no meio.
    return sql.transaction(async (sql) => {
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
  });
