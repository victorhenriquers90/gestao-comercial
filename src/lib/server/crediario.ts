import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { AGING_BUCKETS, bucketFor, collectionOrder, summarizeDebt, type AgingBucket } from "@/lib/crediario-aging";
import { dump, type Row } from "@/lib/json";
import { assertCan } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { requireTenant } from "./context";

/**
 * Cobranca: quem deve, ha quanto tempo, e como falar com a pessoa.
 *
 * As parcelas ja nasciam certas e ficavam esperando alguem abrir o
 * Financeiro e reparar no vencimento. Isto e a lista de trabalho: ordenada
 * pela divida mais VELHA, porque divida velha e a que menos volta, e com o
 * telefone ao lado -- cobranca em loja pequena e telefonema, nao relatorio.
 *
 * Inclui titulo MANUAL do cliente junto com o crediario. A pergunta que a
 * tela responde e "quem me deve", e pro lojista tanto faz se a divida
 * nasceu de uma venda parcelada ou de um lancamento a mao. Cartao fica de
 * fora: la quem deve e a adquirente, nao uma pessoa pra quem se liga.
 */
export const listCrediarioFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { storeId?: number; apenasVencidos?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "finance.read");

    const rows = await sql.query<Row>(
      `select ar.id, ar.customer_id, ar.due_date, ar.description, ar.origin,
              ar.sale_id, ar.amount, ar.received_amount,
              (ar.amount - ar.received_amount) as aberto,
              c.name, c.phone, c.whatsapp, c.document, c.credit_limit
         from accounts_receivable ar
         join customers c on c.id = ar.customer_id
        where ar.company_id = $1 and ar.deleted_at is null
          and ar.status in ('pendente', 'parcial', 'vencido')
          and (ar.amount - ar.received_amount) > 0
          and ar.origin <> 'cartao'
          and ($2::int is null or ar.store_id = $2)
        order by ar.due_date asc`,
      [tenant.companyId, data.storeId ?? null],
    );

    const hoje = new Date().toISOString().slice(0, 10);
    type Parcela = {
      id: number;
      dueDate: string;
      open: number;
      descricao: string;
      origem: string;
      saleId: number | null;
      faixa: AgingBucket;
    };

    const porCliente = new Map<number, { nome: string; telefone: string | null; documento: string | null; limite: number; parcelas: Parcela[] }>();
    for (const r of rows) {
      const cid = num(r.customer_id);
      const g = porCliente.get(cid) ?? {
        nome: String(r.name ?? ""),
        // WhatsApp primeiro: e por onde se cobra hoje em dia.
        telefone: (r.whatsapp == null || r.whatsapp === "" ? r.phone : r.whatsapp) as string | null,
        documento: r.document == null ? null : String(r.document),
        limite: num(r.credit_limit),
        parcelas: [] as Parcela[],
      };
      const dueDate = String(r.due_date).slice(0, 10);
      g.parcelas.push({
        id: num(r.id),
        dueDate,
        open: num(r.aberto),
        descricao: String(r.description ?? ""),
        origem: String(r.origin ?? "manual"),
        saleId: r.sale_id == null ? null : num(r.sale_id),
        faixa: bucketFor(dueDate, hoje),
      });
      porCliente.set(cid, g);
    }

    let clientes = [...porCliente.entries()].map(([id, g]) => ({
      customerId: id,
      ...g,
      resumo: summarizeDebt(
        g.parcelas.map((p) => ({ id: p.id, dueDate: p.dueDate, open: p.open })),
        hoje,
      ),
    }));

    if (data.apenasVencidos) clientes = clientes.filter((c) => c.resumo.vencido > 0);
    clientes.sort((a, b) => collectionOrder(a.resumo, b.resumo));

    // Totais da carteira, por faixa -- e o que responde "quanto ja virou
    // problema" em vez de so "quanto tenho a receber".
    const porFaixa = Object.fromEntries(AGING_BUCKETS.map((f) => [f, 0])) as Record<AgingBucket, number>;
    let total = 0;
    let vencido = 0;
    for (const c of clientes) {
      total = round2(total + c.resumo.total);
      vencido = round2(vencido + c.resumo.vencido);
      for (const f of AGING_BUCKETS) porFaixa[f] = round2(porFaixa[f] + c.resumo.porFaixa[f]);
    }

    return dump({
      hoje,
      clientes,
      totais: { total, vencido, aVencer: round2(total - vencido), porFaixa, clientes: clientes.length },
    });
  });

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
