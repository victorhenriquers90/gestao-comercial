import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { batchStatus } from "@/lib/card-settlement";
import { dump, type Row } from "@/lib/json";
import { assertCan } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { audit, requireTenant } from "./context";
import { ymdLocal } from "@/lib/local-date";

/**
 * Conciliacao de cartao: dar baixa no que a adquirente depositou.
 *
 * Agrupa por DATA DE LIQUIDACAO porque e assim que o dinheiro chega: um
 * deposito por dia, juntando dezenas de vendas. Conferir venda a venda
 * contra um deposito unico e trabalho que ninguem faz -- e trabalho que
 * ninguem faz e controle que nao existe.
 */
export const listCardSettlementsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");

    const rows = await sql.query<Row>(
      `select ar.due_date,
              count(*)::int as parcelas,
              coalesce(sum(ar.amount - ar.received_amount), 0) as liquido,
              coalesce(sum(p.amount), 0) as bruto,
              coalesce(sum(p.fee_amount), 0) as taxa,
              string_agg(distinct p.brand, ', ' order by p.brand) as bandeiras
         from accounts_receivable ar
         left join payments p on p.id = ar.payment_id
        where ar.company_id = $1 and ar.deleted_at is null
          and ar.origin = 'cartao'
          and ar.status in ('pendente', 'parcial')
          and (ar.amount - ar.received_amount) > 0
          and ($2::int is null or ar.store_id = $2)
        group by ar.due_date
        order by ar.due_date asc`,
      [tenant.companyId, data.storeId ?? null],
    );

    const hoje = ymdLocal();
    const lotes = rows.map((r) => {
      const dueDate = String(r.due_date).slice(0, 10);
      return {
        dueDate,
        status: batchStatus(dueDate, hoje),
        parcelas: num(r.parcelas),
        liquido: num(r.liquido),
        // O bruto so existe pro lote cuja parcela aponta pro pagamento. Numa
        // parcela de credito parcelado o bruto e da VENDA inteira, entao
        // serve de referencia, nao de conferencia exata.
        bruto: num(r.bruto),
        taxa: num(r.taxa),
        bandeiras: r.bandeiras == null ? "" : String(r.bandeiras),
      };
    });

    const aReceber = lotes.reduce((a, l) => a + l.liquido, 0);
    const atrasado = lotes.filter((l) => l.status === "atrasado").reduce((a, l) => a + l.liquido, 0);

    return dump({
      hoje,
      lotes,
      totais: {
        aReceber: round2(aReceber),
        atrasado: round2(atrasado),
        hoje: round2(lotes.filter((l) => l.status === "hoje").reduce((a, l) => a + l.liquido, 0)),
        lotes: lotes.length,
      },
    });
  });

/**
 * Baixa o lote inteiro de uma data.
 *
 * Nao recebe o valor depositado: a baixa e SEMPRE pelo que cada parcela
 * espera. Se o deposito veio diferente, a tela mostra a diferenca e quem
 * concilia decide o que fazer -- ratear uma divergencia entre dezenas de
 * parcelas seria inventar uma alocacao que ninguem conferiu, e esconderia
 * exatamente o que a conciliacao existe pra revelar.
 */
export const settleCardBatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { dueDate: string; storeId?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.write");

    const dia = String(data.dueDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error("Data de liquidação inválida.");

    return sql.transaction(async (tx) => {
      /*
        `for update` nas linhas do lote: sem a trava, dois cliques em
        "Confirmar" baixariam o mesmo lote duas vezes. Como a baixa soma no
        received_amount, o titulo terminaria com o dobro recebido -- e a
        conciliacao, que existe pra fazer o saldo bater, seria quem o
        quebraria.
      */
      const alvo = await tx<{ id: number; falta: string | number }>`
        select ar.id, (ar.amount - ar.received_amount) as falta
          from accounts_receivable ar
         where ar.company_id = ${tenant.companyId} and ar.deleted_at is null
           and ar.origin = 'cartao' and ar.due_date = ${dia}::date
           and ar.status in ('pendente', 'parcial')
           and (ar.amount - ar.received_amount) > 0
           and (${data.storeId ?? null}::int is null or ar.store_id = ${data.storeId ?? null})
         for update
      `;
      if (!alvo.length) throw new Error("Nenhuma parcela em aberto nesta data.");

      let total = 0;
      for (const p of alvo) {
        const falta = num(p.falta);
        total = round2(total + falta);
        await tx`
          update accounts_receivable
             set received_amount = amount,
                 status = 'pago',
                 received_at = now()
           where id = ${p.id} and company_id = ${tenant.companyId}
        `;
      }

      await audit(tx, tenant, "settle-batch", "card_settlement", null, null, {
        dueDate: dia,
        parcelas: alvo.length,
        total,
      });
      return { parcelas: alvo.length, total };
    });
  });

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
