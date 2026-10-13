import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan, can } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { assertFreeDocument, assertOwned, audit, auditUpdate, requireTenant } from "./context";
import { dump, type Row } from "@/lib/json";
import { ftsPrefix, prefixLike } from "@/lib/search";
import { parseBrDocument, parseCnpj, sellerDocKind, onlyDigits } from "@/lib/document";
import { clampIss } from "@/lib/tax";
import {
  optionalLine,
  parseUf,
  requireLine,
  requireMultiline,
  requireRange,
  sanitizeCode,
  sanitizeMultiline,
} from "@/lib/sanitize";
import { CRM_STAGES, isCrmStage, type CrmStage } from "@/lib/constants";
import { parsePaging } from "@/lib/paging";

/**
 * Liquido de devolucao, por venda (usa `sales.id` sem alias -- so serve
 * pra sites que chamam a tabela pelo proprio nome).
 *
 * `sales.total` NUNCA e reduzido numa devolucao parcial -- sem este join,
 * a compra total/LTV do cliente contava a peca devolvida como se ainda
 * tivesse sido vendida (quando a venda inteira nao sumia primeiro, por
 * causa do filtro `status = 'finalizada'`). Mesmo padrao ja validado em
 * insight.ts/reports.ts/commission.ts. Os sites que usam tagged template
 * (`` sql`...` ``) escrevem o mesmo join por extenso: `${...}` num tagged
 * template vira PARAMETRO, nao texto SQL cru, entao esta constante so serve
 * pros sites em `.query()`.
 */
const RETURN_BY_SALE = `
  left join lateral (
    select coalesce(sum(ri.amount), 0) as returned_revenue
      from return_items ri
      join sale_items si on si.id = ri.sale_item_id
     where si.sale_id = sales.id
  ) ret on true`;

/** Etapa do funil vinda de fora: vazio = não veio; fora do funil = recusa (o cliente sumiria do quadro). */
function parseCrmStage(v: string | null | undefined): CrmStage | undefined {
  const t = optionalLine(v, 24);
  if (!t) return undefined;
  if (!isCrmStage(t)) throw new Error("Estágio inválido.");
  return t;
}

/**
 * Data de nascimento: AAAA-MM-DD que existe no calendário, sem data futura
 * e com ano plausível para uma pessoa viva (1900 em diante). Não reaproveita
 * `requireIsoDate` -- aquela função exige ano 2000-2100 (pensada pra data de
 * documento: vencimento, período), e recusaria o nascimento de qualquer
 * cliente nascido no século passado. Sem checagem nenhuma, uma string
 * qualquer ia direto pro cast de `date` do Postgres e voltava como erro cru.
 */
function parseBirthDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error("Data de nascimento: informe uma data válida.");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  const valid = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  if (!valid || y < 1900) throw new Error("Data de nascimento: informe uma data válida.");
  if (t.getTime() > Date.now()) throw new Error("Data de nascimento não pode ser no futuro.");
  return raw;
}

/**
 * Agregados do cliente: compras liquidas de devolucao, saldo em aberto e
 * follow-ups pendentes. Compartilhado pela lista e pelo quadro do CRM -- as
 * duas telas nunca podem discordar do "total comprado" de um cliente.
 */
const CUSTOMER_AGGREGATES = `
  left join (
    select customer_id, sum(sales.total - coalesce(ret.returned_revenue,0)) as total_bought, max(sold_at) as last_purchase
      from sales
      ${RETURN_BY_SALE}
     where company_id = $1 and status in ('finalizada','devolvida_parcial') and deleted_at is null
     group by customer_id
  ) sv on sv.customer_id = c.id
  left join (
    select customer_id, sum(amount - received_amount) as open_balance
      from accounts_receivable
     where company_id = $1 and deleted_at is null
       and status in ('pendente','parcial','vencido')
     group by customer_id
  ) ar on ar.customer_id = c.id
  left join (
    select customer_id, count(*)::int as open_tasks, min(due_at) as next_due
      from crm_tasks
     where company_id = $1 and done_at is null
     group by customer_id
  ) tk on tk.customer_id = c.id`;

export const listCustomersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      q?: string;
      /** Etapa do funil (CRM_STAGES). */
      stage?: string;
      kind?: "pf" | "pj";
      debit?: boolean;
      /** Padrão 100, máximo 200. */
      limit?: number;
      offset?: number;
    }) => {
      // `stage` ja estava no contrato mas nunca foi lido: o filtro era ignorado
      // em silencio. Agora filtra de verdade, e um valor fora do funil e
      // recusado em vez de devolver "nenhum cliente".
      if (d.stage && !isCrmStage(d.stage)) throw new Error("Estágio inválido.");
      return { ...d, page: parsePaging(d) };
    },
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.read");
    const params: unknown[] = [tenant.companyId];
    const raw = data.q?.trim() || "";
    let extra = "";
    if (raw) {
      const digits = onlyDigits(raw);
      params.push(raw, prefixLike(raw), ftsPrefix(raw));
      extra += ` and (
        c.document = $${params.length - 2} or c.phone = $${params.length - 2}
        or lower(c.name) like $${params.length - 1} or lower(coalesce(c.phone,'')) like $${params.length - 1}
        or to_tsvector('simple', coalesce(c.name,'')) @@ to_tsquery('simple', $${params.length})
        or c.name ilike ('%' || $${params.length - 2} || '%')`;
      if (digits.length >= 6) {
        params.push(digits);
        extra += ` or c.document = $${params.length}`;
      }
      // Telefone so batia exato ou por prefixo: quem so tem os ULTIMOS
      // digitos (caller ID, uma anotacao) nunca achava o cliente. Com 4+
      // digitos, compara so os digitos do telefone salvo (ele pode ter sido
      // digitado com ou sem formatacao) contra qualquer posicao.
      if (digits.length >= 4) {
        params.push(digits);
        extra += ` or regexp_replace(coalesce(c.phone,''), '\\D', '', 'g') like ('%' || $${params.length} || '%')`;
      }
      extra += `)`;
    }
    if (data.kind === "pf" || data.kind === "pj") {
      params.push(data.kind);
      extra += ` and c.kind = $${params.length}`;
    }
    if (data.stage) {
      params.push(data.stage);
      extra += ` and c.crm_stage = $${params.length}`;
    }
    if (data.debit) {
      extra += ` and coalesce(ar.open_balance, 0) > 0`;
    }
    params.push(data.page.limit, data.page.offset);
    const limitAt = params.length - 1;
    const offsetAt = params.length;
    const rows = await sql.query<Row>(
      `select count(*) over() as total,
              c.*,
              coalesce(sv.total_bought, 0) as total_bought,
              sv.last_purchase,
              coalesce(ar.open_balance, 0) as open_balance,
              coalesce(tk.open_tasks, 0) as open_tasks,
              tk.next_due
         from customers c
         ${CUSTOMER_AGGREGATES}
        where c.company_id = $1 and c.deleted_at is null
          ${extra}
        order by c.name, c.id
        limit $${limitAt} offset $${offsetAt}`,
      params,
    );
    // O corte em 200 era silencioso: o 201o cliente (em ordem alfabetica) nao
    // aparecia na lista, no CRM, no PDV nem no seletor do Financeiro. `total`
    // deixa a tela dizer "de quantos" e paginar; o desempate por id mantem a
    // ordem estavel entre paginas quando dois clientes tem o mesmo nome.
    const total = rows.length ? num(rows[0]!.total) : 0;
    const items = rows.map((r) => ({
      id: num(r.id),
      kind: String(r.kind ?? "pf"),
      name: String(r.name ?? ""),
      document: r.document == null ? null : String(r.document),
      phone: r.phone == null ? null : String(r.phone),
      email: r.email == null ? null : String(r.email),
      city: r.city == null ? null : String(r.city),
      crm_stage: String(r.crm_stage ?? "novo"),
      total_bought: num(r.total_bought),
      last_purchase: r.last_purchase == null ? null : String(r.last_purchase),
      open_balance: num(r.open_balance),
      credit_limit: num(r.credit_limit),
      open_tasks: num(r.open_tasks),
      next_due: r.next_due == null ? null : String(r.next_due),
    }));
    return { items, total };
  });

/** Cartões por coluna do funil. O resto de cada coluna aparece em Clientes (filtro por etapa). */
export const CRM_BOARD_CARDS = 30;

type CrmBoardCard = {
  id: number;
  name: string;
  phone: string | null;
  city: string | null;
  crm_stage: CrmStage;
  total_bought: number;
  open_balance: number;
  open_tasks: number;
  next_due: string | null;
};

/**
 * Quadro do CRM: contagem e valor de CADA etapa sobre todos os clientes, mais
 * os primeiros cartões de cada coluna. O quadro usava `listCustomersFn` (teto
 * de 200 por ordem alfabética): com mais clientes, as colunas, o "No funil" e
 * o "Valor no funil" saíam de uma fatia do cadastro, sem aviso. Os totais de
 * tarefas também: a agenda traz no máximo 80, então "Tarefas abertas" nunca
 * passava de 80.
 */
export const crmBoardFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.read");
    assertCan(tenant.role, "crm.write");
    const rows = await sql.query<Row>(
      `with ranked as (
         select c.id, c.name, c.phone, c.city, c.crm_stage,
                coalesce(sv.total_bought, 0) as total_bought,
                coalesce(ar.open_balance, 0) as open_balance,
                coalesce(tk.open_tasks, 0) as open_tasks,
                tk.next_due,
                count(*) over (partition by c.crm_stage) as stage_count,
                sum(coalesce(sv.total_bought, 0)) over (partition by c.crm_stage) as stage_total,
                row_number() over (partition by c.crm_stage order by c.name, c.id) as rn
           from customers c
           ${CUSTOMER_AGGREGATES}
          where c.company_id = $1 and c.deleted_at is null
       )
       select * from ranked where rn <= $2 order by crm_stage, rn`,
      [tenant.companyId, CRM_BOARD_CARDS],
    );
    // c.deleted_at is null: sem isto, tarefa de cliente excluido continuava
    // inflando "Tarefas abertas"/"Atrasadas" pra sempre -- excluir o
    // cliente nunca fecha a tarefa dele.
    const [tk] = await sql.query<Row>(
      `select count(*)::int as open_tasks,
              (count(*) filter (where t.due_at < now()))::int as overdue_tasks
         from crm_tasks t
         join customers c on c.id = t.customer_id
        where t.company_id = $1 and t.done_at is null and c.deleted_at is null`,
      [tenant.companyId],
    );
    const stages = Object.fromEntries(
      CRM_STAGES.map((st) => [st, { count: 0, totalBought: 0, cards: [] as CrmBoardCard[] }]),
    ) as Record<CrmStage, { count: number; totalBought: number; cards: CrmBoardCard[] }>;
    for (const r of rows) {
      const st = String(r.crm_stage);
      if (!isCrmStage(st)) continue;
      const col = stages[st];
      col.count = num(r.stage_count);
      col.totalBought = num(r.stage_total);
      col.cards.push({
        id: num(r.id),
        name: String(r.name ?? ""),
        phone: r.phone == null ? null : String(r.phone),
        city: r.city == null ? null : String(r.city),
        crm_stage: st,
        total_bought: num(r.total_bought),
        open_balance: num(r.open_balance),
        open_tasks: num(r.open_tasks),
        next_due: r.next_due == null ? null : String(r.next_due),
      });
    }
    return {
      stages,
      openTasks: num(tk?.open_tasks),
      overdueTasks: num(tk?.overdue_tasks),
    };
  });

export const getCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.read");
    const [customer] = await sql<Row>`select * from customers where id = ${data.id} and company_id = ${tenant.companyId}`;
    if (!customer) throw new Error("Cliente não encontrado.");
    const sales = await sql<Row>`
      select id, number, total, sold_at, status from sales
      where customer_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by sold_at desc limit 50
    `;
    const products = await sql<Row>`
      select si.description,
             sum(si.quantity - coalesce(ret.returned_qty,0)) as qty,
             sum(si.total - coalesce(ret.returned_amount,0)) as total
      from sale_items si
      join sales s on s.id = si.sale_id
      left join lateral (
        select coalesce(sum(ri.quantity), 0) as returned_qty,
               coalesce(sum(ri.amount), 0) as returned_amount
          from return_items ri where ri.sale_item_id = si.id
      ) ret on true
      -- Mesmo filtro do CUSTOMER_AGGREGATES (company_id + deleted_at):
      -- sales.deleted_at nunca e gravado hoje, mas o dia que alguem ligar
      -- "excluir venda", esta consulta e a de "stats" abaixo tinham que
      -- parar de contar venda excluida igual as outras telas ja fazem.
      where s.customer_id = ${data.id} and s.company_id = ${tenant.companyId}
        and s.status in ('finalizada','devolvida_parcial') and s.deleted_at is null
      group by si.description
      order by total desc
      limit 20
    `;
    const receivables = await sql<Row>`
      select * from accounts_receivable
      where customer_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by due_date
    `;
    const notes = await sql<Row>`
      select * from customer_notes where customer_id = ${data.id} order by created_at desc limit 30
    `;
    const tasks = await sql<Row>`
      select * from crm_tasks where customer_id = ${data.id} order by created_at desc
    `;
    const stats = await sql<{ total: string | number; n: number; avg: string | number }>`
      select coalesce(sum(sales.total - coalesce(ret.returned_revenue,0)),0) as total,
             count(*)::int as n,
             coalesce(avg(sales.total - coalesce(ret.returned_revenue,0)),0) as avg
      from sales
      left join lateral (
        select coalesce(sum(ri.amount), 0) as returned_revenue
          from return_items ri
          join sale_items si on si.id = ri.sale_item_id
         where si.sale_id = sales.id
      ) ret on true
      where customer_id = ${data.id} and company_id = ${tenant.companyId}
        and status in ('finalizada','devolvida_parcial') and deleted_at is null
    `;
    return dump({
      customer: {
        id: num(customer.id),
        kind: String(customer.kind ?? "pf"),
        name: String(customer.name ?? ""),
        tradeName: customer.trade_name == null ? null : String(customer.trade_name),
        document: customer.document == null ? null : String(customer.document),
        email: customer.email == null ? null : String(customer.email),
        phone: customer.phone == null ? null : String(customer.phone),
        city: customer.city == null ? null : String(customer.city),
        state: customer.state == null ? null : String(customer.state),
        address: customer.address == null ? null : String(customer.address),
        creditLimit: num(customer.credit_limit),
        notes: customer.notes == null ? null : String(customer.notes),
        crmStage: String(customer.crm_stage ?? "novo"),
        sellerId: customer.seller_id == null ? null : num(customer.seller_id),
      },
      sales: sales.map((s) => ({
        id: num(s.id),
        number: num(s.number),
        total: num(s.total),
        soldAt: String(s.sold_at ?? ""),
        status: String(s.status ?? ""),
      })),
      products: products.map((p) => ({
        description: String(p.description ?? ""),
        qty: num(p.qty),
        total: num(p.total),
      })),
      receivables: receivables.map((r) => ({
        id: num(r.id),
        description: String(r.description ?? ""),
        dueDate: String(r.due_date ?? ""),
        amount: num(r.amount),
        received: num(r.received_amount),
        status: String(r.status ?? ""),
      })),
      notes: notes.map((n) => ({
        id: num(n.id),
        body: String(n.body ?? ""),
        createdAt: String(n.created_at ?? ""),
      })),
      tasks: tasks.map((t) => ({
        id: num(t.id),
        title: String(t.title ?? ""),
        dueAt: t.due_at == null ? null : String(t.due_at),
        doneAt: t.done_at == null ? null : String(t.done_at),
      })),
      stats: {
        total: num(stats[0]?.total),
        count: num(stats[0]?.n),
        avg: num(stats[0]?.avg),
      },
    });
  });

export const saveCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      kind: string;
      name: string;
      tradeName?: string;
      document?: string;
      ie?: string;
      rg?: string;
      birthDate?: string | null;
      email?: string;
      phone?: string;
      whatsapp?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      creditLimit?: number;
      notes?: string;
      crmStage?: string;
      sellerId?: number | null;
    }) => ({
      ...d,
      kind: requireLine(d.kind, "Tipo", 20),
      name: requireLine(d.name, "Nome"),
      // Todo campo opcional segue a mesma regra: undefined = "nao veio,
      // mantem o gravado"; null/"" = apagado de proposito. Antes só
      // ie/rg/zip/creditLimit/sellerId tinham isso -- tradeName/document/
      // email/phone/whatsapp/address/city/state/notes colapsavam "nao veio"
      // e "veio vazio" no mesmo undefined, e o UPDATE regravava `?? null`:
      // quem chamasse saveCustomerFn direto (fora do formulário, que sempre
      // manda o registro inteiro) sem telefone/e-mail apagava os dois.
      tradeName: d.tradeName === undefined ? undefined : optionalLine(d.tradeName),
      document:
        d.document === undefined ? undefined : parseBrDocument(d.document, d.kind === "pj" ? "cnpj" : "cpf"),
      birthDate: d.birthDate === undefined ? undefined : d.birthDate === null ? null : parseBirthDate(d.birthDate),
      ie: d.ie === undefined ? undefined : sanitizeCode(d.ie, 32),
      rg: d.rg === undefined ? undefined : sanitizeCode(d.rg, 32),
      email: d.email === undefined ? undefined : optionalLine(d.email, 120),
      phone: d.phone === undefined ? undefined : sanitizeCode(d.phone, 32),
      whatsapp: d.whatsapp === undefined ? undefined : sanitizeCode(d.whatsapp, 32),
      address: d.address === undefined ? undefined : optionalLine(d.address, 200),
      city: d.city === undefined ? undefined : optionalLine(d.city, 80),
      state: d.state === undefined ? undefined : (parseUf(d.state) ?? null),
      zip: d.zip === undefined ? undefined : sanitizeCode(d.zip, 16),
      creditLimit:
        d.creditLimit === undefined ? undefined : requireRange(d.creditLimit, "Limite de crédito", 0, 999_999_999),
      notes: d.notes === undefined ? undefined : sanitizeMultiline(d.notes),
      crmStage: parseCrmStage(d.crmStage),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "customers.write");
    await assertOwned(sql, tenant.companyId, "sellers", data.sellerId);
    await assertFreeDocument(sql, "customers", tenant.companyId, data.document, data.id, "um cliente");
    if (data.id) {
      const [cur] = await sql<Row>`
        select * from customers
        where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      `;
      if (!cur) throw new Error("Cliente não encontrado.");
      const tradeName = data.tradeName === undefined ? (cur.trade_name ?? null) : data.tradeName;
      const document = data.document === undefined ? (cur.document ?? null) : data.document;
      const ie = data.ie === undefined ? (cur.ie ?? null) : data.ie;
      const rg = data.rg === undefined ? (cur.rg ?? null) : data.rg;
      const email = data.email === undefined ? (cur.email ?? null) : data.email;
      const phone = data.phone === undefined ? (cur.phone ?? null) : data.phone;
      const whatsapp = data.whatsapp === undefined ? (cur.whatsapp ?? null) : data.whatsapp;
      const address = data.address === undefined ? (cur.address ?? null) : data.address;
      const city = data.city === undefined ? (cur.city ?? null) : data.city;
      const state = data.state === undefined ? (cur.state ?? null) : data.state;
      const zip = data.zip === undefined ? (cur.zip ?? null) : data.zip;
      const notes = data.notes === undefined ? (cur.notes ?? null) : data.notes;
      const creditLimit = data.creditLimit ?? num(cur.credit_limit);
      const sellerId = data.sellerId === undefined ? (cur.seller_id ?? null) : data.sellerId;
      const before = {
        name: cur.name,
        tradeName: cur.trade_name ?? null,
        document: cur.document ?? null,
        email: cur.email ?? null,
        phone: cur.phone ?? null,
        address: cur.address ?? null,
        city: cur.city ?? null,
        state: cur.state ?? null,
        creditLimit: num(cur.credit_limit),
      };
      const after = {
        name: data.name,
        tradeName,
        document,
        email,
        phone,
        address,
        city,
        state,
        creditLimit,
      };
      /*
        crm_stage = coalesce(novo, o que ja tinha), nunca um valor fixo.
        `crmStage` e opcional no validador (so o painel do CRM manda, com o
        estagio atual do proprio cliente) -- quem edita telefone/endereco
        pela tela de Clientes nao manda nada. Um default fixo aqui
        ("venda") teleportava QUALQUER edicao de cadastro pro estagio
        "Venda" do funil, apagando o progresso real (novo, interessado,
        negociacao...) sem ninguem pedir isso. Hoje as duas telas que
        chamam esta funcao ja mandam o estagio certo ou nao precisam dele,
        mas o proprio contrato da funcao (`crmStage?: string`) permite
        omitir -- e a proxima tela que editar cliente sem mexer no CRM ia
        cair nesta mesma armadilha.
      */
      await sql`
        update customers set kind = ${data.kind}, name = ${data.name}, trade_name = ${tradeName},
          document = ${document}, ie = ${ie}, rg = ${rg},
          birth_date = coalesce(${data.birthDate ?? null}, birth_date), email = ${email}, phone = ${phone},
          whatsapp = ${whatsapp}, address = ${address}, city = ${city},
          state = ${state}, zip = ${zip}, credit_limit = ${creditLimit},
          notes = ${notes}, crm_stage = coalesce(${data.crmStage ?? null}, crm_stage),
          seller_id = ${sellerId}, updated_at = now()
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await auditUpdate(sql, tenant, "customer", data.id, before, after);
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into customers (
        company_id, kind, name, trade_name, document, ie, rg, birth_date, email, phone, whatsapp,
        address, city, state, zip, credit_limit, notes, crm_stage, seller_id
      ) values (
        ${tenant.companyId}, ${data.kind}, ${data.name}, ${data.tradeName ?? null}, ${data.document ?? null},
        ${data.ie ?? null}, ${data.rg ?? null}, ${data.birthDate ?? null}, ${data.email ?? null}, ${data.phone ?? null},
        ${data.whatsapp ?? null}, ${data.address ?? null}, ${data.city ?? null}, ${data.state ?? null}, ${data.zip ?? null},
        ${data.creditLimit ?? 0}, ${data.notes ?? null}, ${data.crmStage ?? "novo"}, ${data.sellerId ?? null}
      ) returning id
    `;
    await audit(sql, tenant, "create", "customer", row!.id, null, {
      name: data.name,
      creditLimit: data.creditLimit ?? 0,
    });
    return { id: row!.id };
  });

export const addCustomerNoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; body: string }) => ({
    ...d,
    body: requireMultiline(d.body, "Nota"),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    // O customerId vinha cru do cliente direto para o insert -- era o unico
    // lugar, entre as 94 server functions, onde um id externo entrava numa
    // escrita sem conferir o dono. A nota nascia carimbada com a empresa de
    // quem escreveu, mas apontando para um cliente que podia ser de outra
    // (e o sucesso/erro do insert ainda revelava se aquele id existe).
    const [cliente] = await sql<{ id: number }>`
      select id from customers
      where id = ${data.customerId} and company_id = ${tenant.companyId} and deleted_at is null
    `;
    if (!cliente) throw new Error("Cliente não encontrado.");
    await sql`
      insert into customer_notes (company_id, customer_id, user_id, body)
      values (${tenant.companyId}, ${cliente.id}, ${tenant.userId}, ${data.body})
    `;
    return { ok: true };
  });

export const saveCrmTaskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; title: string; dueAt?: string | null }) => ({
    ...d,
    title: requireLine(d.title, "Tarefa", 180),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    await assertOwned(sql, tenant.companyId, "customers", data.customerId);
    await sql`
      insert into crm_tasks (company_id, customer_id, user_id, title, due_at)
      values (${tenant.companyId}, ${data.customerId}, ${tenant.userId}, ${data.title}, ${data.dueAt ?? null})
    `;
    return { ok: true };
  });

export const toggleCrmTaskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; done: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    // Escrita de CRM sem checagem de papel. O escopo por company_id ja estava
    // certo (nao vazava entre lojas), mas qualquer papel autenticado podia
    // concluir/reabrir tarefa de CRM -- inclusive os que nem enxergam a tela.
    assertCan(tenant.role, "crm.write");
    await sql`
      update crm_tasks set done_at = ${data.done ? new Date().toISOString() : null}
      where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    return { ok: true };
  });

export const listCrmTasksFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { openOnly?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    const rows = await sql.query<Row>(
      `select t.id, t.title, t.due_at, t.done_at, t.customer_id, c.name as customer_name
         from crm_tasks t
         join customers c on c.id = t.customer_id
        where t.company_id = $1 and c.deleted_at is null
          and ($2::int = 0 or t.done_at is null)
        order by t.done_at nulls first, t.due_at nulls last, t.id desc
        limit 80`,
      [tenant.companyId, data.openOnly === false ? 0 : 1],
    );
    return rows.map((r) => ({
      id: num(r.id),
      title: String(r.title ?? ""),
      dueAt: r.due_at == null ? null : String(r.due_at),
      doneAt: r.done_at == null ? null : String(r.done_at),
      customerId: num(r.customer_id),
      customerName: String(r.customer_name ?? ""),
    }));
  });

export const moveCrmFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; stage: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "crm.write");
    // Quem chama o servidor direto (fora do drag-and-drop do quadro) podia
    // mandar qualquer string: o cliente sumia de toda coluna do funil, sem
    // erro nenhum avisando.
    if (!isCrmStage(data.stage)) throw new Error("Estágio inválido.");
    await sql`
      update customers set crm_stage = ${data.stage}, updated_at = now()
      where id = ${data.customerId} and company_id = ${tenant.companyId}
    `;
    return { ok: true };
  });

export const listSuppliersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; limit?: number; offset?: number }) => ({ ...d, page: parsePaging(d) }))
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "suppliers.read");
    const raw = data.q?.trim() || "";
    // Igual ao listCustomersFn antes do item 64: devolvia o cadastro inteiro
    // sem limite, usado pra alimentar <select> de fornecedor em Produtos,
    // Compras e Financeiro -- cresce o cadastro e o <select> (e esta consulta)
    // crescem sem aviso nenhum.
    const rows = await sql.query<Row>(
      `select count(*) over() as total,
              s.*,
              -- "Comprado" so conta pedido RECEBIDO: orcamento (cotacao, nunca
              -- virou compra) e cancelado nao tiraram dinheiro do bolso --
              -- contar os dois inflava "Comprado" de fornecedor com cotacao
              -- aberta ou pedido cancelado, sem nunca ter comprado nada dele.
              coalesce((select sum(p.total) from purchases p where p.supplier_id = s.id and p.status = 'recebido'),0) as total_bought,
              -- "Pedidos" ja e mais largo (inclui pedido em andamento, nao so
              -- recebido), mas orcamento e cancelado continuam de fora: nenhum
              -- dos dois e um pedido de verdade feito a este fornecedor.
              (select count(*) from purchases p where p.supplier_id = s.id and p.status not in ('orcamento','cancelado'))::int as orders,
              coalesce((select sum(ap.amount - ap.paid_amount) from accounts_payable ap
                         where ap.supplier_id = s.id and ap.status in ('pendente','parcial','vencido')),0) as open_balance
         from suppliers s
        where s.company_id = $1 and s.deleted_at is null
          and (
            $2::text is null
            or s.document = $2
            or lower(s.legal_name) like $3 or lower(coalesce(s.trade_name,'')) like $3
            or to_tsvector('simple', coalesce(s.legal_name,'') || ' ' || coalesce(s.trade_name,'')) @@ to_tsquery('simple', $4)
            or s.legal_name ilike ('%' || $2 || '%') or s.trade_name ilike ('%' || $2 || '%')
          )
        order by s.legal_name, s.id
        limit $5 offset $6`,
      [tenant.companyId, raw || null, raw ? prefixLike(raw) : null, raw ? ftsPrefix(raw) : "__none__:*", data.page.limit, data.page.offset],
    );
    const total = rows.length ? num(rows[0]!.total) : 0;
    const items = rows.map((r) => ({
      id: num(r.id),
      legalName: String(r.legal_name ?? ""),
      tradeName: r.trade_name == null ? null : String(r.trade_name),
      document: r.document == null ? null : String(r.document),
      email: r.email == null ? null : String(r.email),
      phone: r.phone == null ? null : String(r.phone),
      whatsapp: r.whatsapp == null ? null : String(r.whatsapp),
      address: r.address == null ? null : String(r.address),
      city: r.city == null ? null : String(r.city),
      state: r.state == null ? null : String(r.state),
      representative: r.representative == null ? null : String(r.representative),
      notes: r.notes == null ? null : String(r.notes),
      totalBought: num(r.total_bought),
      orders: num(r.orders),
      openBalance: num(r.open_balance),
    }));
    return { items, total };
  });

export const getSupplierFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "suppliers.read");
    const [supplier] = await sql<Row>`select * from suppliers where id = ${data.id} and company_id = ${tenant.companyId}`;
    if (!supplier) throw new Error("Fornecedor não encontrado.");
    const purchases = await sql<Row>`
      select id, number, status, total, created_at, expected_at, received_at
      from purchases
      where supplier_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by created_at desc limit 40
    `;
    const payables = await sql<Row>`
      select id, description, due_date, amount, paid_amount, status
      from accounts_payable
      where supplier_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      order by due_date
    `;
    const products = await sql<Row>`
      -- so pedido RECEBIDO: item de orcamento/pedido cancelado nunca foi
      -- comprado de verdade, mesmo raciocinio do stats.total abaixo.
      select p.name, count(*)::int as times, coalesce(sum(pi.total),0) as total
      from purchase_items pi
      join purchases pu on pu.id = pi.purchase_id
      join products p on p.id = pi.product_id
      where pu.supplier_id = ${data.id} and pu.company_id = ${tenant.companyId} and pu.status = 'recebido'
      group by p.name
      order by times desc limit 15
    `;
    // Mesma regra do listSuppliersFn: "total" (dinheiro de verdade) so conta
    // recebido; "n" (pedidos) tambem aceita em andamento, so exclui orcamento
    // e cancelado -- nenhum dos dois chegou a ser um pedido de verdade.
    const stats = await sql<{ total: string | number; n: number }>`
      select coalesce(sum(total) filter (where status = 'recebido'), 0) as total,
             count(*) filter (where status not in ('orcamento','cancelado'))::int as n
      from purchases
      where supplier_id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
    `;
    return dump({
      supplier: {
        id: num(supplier.id),
        legalName: String(supplier.legal_name ?? ""),
        tradeName: supplier.trade_name == null ? null : String(supplier.trade_name),
        document: supplier.document == null ? null : String(supplier.document),
        email: supplier.email == null ? null : String(supplier.email),
        phone: supplier.phone == null ? null : String(supplier.phone),
        whatsapp: supplier.whatsapp == null ? null : String(supplier.whatsapp),
        address: supplier.address == null ? null : String(supplier.address),
        city: supplier.city == null ? null : String(supplier.city),
        state: supplier.state == null ? null : String(supplier.state),
        zip: supplier.zip == null ? null : String(supplier.zip),
        representative: supplier.representative == null ? null : String(supplier.representative),
        notes: supplier.notes == null ? null : String(supplier.notes),
      },
      purchases: purchases.map((p) => ({
        id: num(p.id),
        number: num(p.number),
        status: String(p.status ?? ""),
        total: num(p.total),
        createdAt: String(p.created_at ?? ""),
        expectedAt: p.expected_at == null ? null : String(p.expected_at),
        receivedAt: p.received_at == null ? null : String(p.received_at),
      })),
      payables: payables.map((r) => ({
        id: num(r.id),
        description: String(r.description ?? ""),
        dueDate: String(r.due_date ?? ""),
        amount: num(r.amount),
        paid: num(r.paid_amount),
        status: String(r.status ?? ""),
      })),
      products: products.map((p) => ({
        name: String(p.name ?? ""),
        times: num(p.times),
        total: num(p.total),
      })),
      stats: {
        total: num(stats[0]?.total),
        count: num(stats[0]?.n),
      },
    });
  });

export const saveSupplierFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      legalName: string;
      tradeName?: string;
      document?: string;
      email?: string;
      phone?: string;
      whatsapp?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      representative?: string;
      notes?: string;
    }) => ({
      ...d,
      legalName: requireLine(d.legalName, "Razão social"),
      // Mesma regra do saveCustomerFn (item 68): undefined (chave ausente do
      // payload) = mantem o gravado; null/"" (chave presente, vazia) = apaga
      // de proposito. Antes todo campo opcional regravava `data.X ?? null`
      // sem distincao -- quem chamasse saveSupplierFn sem telefone/e-mail
      // apagava os dois, so invisivel porque a unica tela que chama hoje
      // manda o registro inteiro.
      tradeName: d.tradeName === undefined ? undefined : optionalLine(d.tradeName),
      document: d.document === undefined ? undefined : parseCnpj(d.document),
      email: d.email === undefined ? undefined : optionalLine(d.email, 120),
      phone: d.phone === undefined ? undefined : sanitizeCode(d.phone, 32),
      whatsapp: d.whatsapp === undefined ? undefined : sanitizeCode(d.whatsapp, 32),
      address: d.address === undefined ? undefined : optionalLine(d.address, 200),
      city: d.city === undefined ? undefined : optionalLine(d.city, 80),
      state: d.state === undefined ? undefined : (parseUf(d.state) ?? null),
      zip: d.zip === undefined ? undefined : sanitizeCode(d.zip, 16),
      representative: d.representative === undefined ? undefined : optionalLine(d.representative),
      notes: d.notes === undefined ? undefined : sanitizeMultiline(d.notes),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "suppliers.write");
    await assertFreeDocument(sql, "suppliers", tenant.companyId, data.document, data.id, "um fornecedor");
    if (data.id) {
      const [cur] = await sql<Row>`
        select * from suppliers
        where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      `;
      if (!cur) throw new Error("Fornecedor não encontrado.");
      const tradeName = data.tradeName === undefined ? (cur.trade_name ?? null) : data.tradeName;
      const document = data.document === undefined ? (cur.document ?? null) : data.document;
      const email = data.email === undefined ? (cur.email ?? null) : data.email;
      const phone = data.phone === undefined ? (cur.phone ?? null) : data.phone;
      const whatsapp = data.whatsapp === undefined ? (cur.whatsapp ?? null) : data.whatsapp;
      const address = data.address === undefined ? (cur.address ?? null) : data.address;
      const city = data.city === undefined ? (cur.city ?? null) : data.city;
      const state = data.state === undefined ? (cur.state ?? null) : data.state;
      const zip = data.zip === undefined ? (cur.zip ?? null) : data.zip;
      const representative = data.representative === undefined ? (cur.representative ?? null) : data.representative;
      const notes = data.notes === undefined ? (cur.notes ?? null) : data.notes;
      await sql`
        update suppliers set legal_name = ${data.legalName}, trade_name = ${tradeName},
          document = ${document}, email = ${email}, phone = ${phone},
          whatsapp = ${whatsapp}, address = ${address}, city = ${city},
          state = ${state}, zip = ${zip}, representative = ${representative},
          notes = ${notes}, updated_at = now()
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await auditUpdate(
        sql,
        tenant,
        "supplier",
        data.id,
        {
          name: cur.legal_name,
          tradeName: cur.trade_name ?? null,
          document: cur.document ?? null,
          email: cur.email ?? null,
          phone: cur.phone ?? null,
          representative: cur.representative ?? null,
          address: cur.address ?? null,
          city: cur.city ?? null,
          state: cur.state ?? null,
        },
        { name: data.legalName, tradeName, document, email, phone, representative, address, city, state },
      );
      return { id: data.id };
    }
    const snapshot = {
      name: data.legalName,
      tradeName: data.tradeName ?? null,
      document: data.document ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      representative: data.representative ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
    };
    const [row] = await sql<{ id: number }>`
      insert into suppliers (
        company_id, legal_name, trade_name, document, email, phone, whatsapp, address, city, state, zip, representative, notes
      ) values (
        ${tenant.companyId}, ${data.legalName}, ${data.tradeName ?? null}, ${data.document ?? null}, ${data.email ?? null},
        ${data.phone ?? null}, ${data.whatsapp ?? null}, ${data.address ?? null}, ${data.city ?? null}, ${data.state ?? null},
        ${data.zip ?? null}, ${data.representative ?? null}, ${data.notes ?? null}
      ) returning id
    `;
    await audit(sql, tenant, "create", "supplier", row!.id, null, snapshot);
    return { id: row!.id };
  });

export const listSellersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.read");
    const rows = await sql<Row>`
      select sl.*,
        coalesce((select sum(s.total - coalesce(
                    (select sum(ri.amount) from return_items ri
                       join sale_items si on si.id = ri.sale_item_id
                      where si.sale_id = s.id), 0))
                  from sales s
                  where s.seller_id = sl.id and s.status in ('finalizada','devolvida_parcial')
                    and s.sold_at >= date_trunc('month', now())),0) as month_revenue,
        coalesce((select sum(c.amount) from commissions c
                  where c.seller_id = sl.id
                    and c.created_at >= date_trunc('month', now())
                    and c.status <> 'cancelado'),0) as month_commission,
        coalesce((select sum(c.amount) from commissions c
                  where c.seller_id = sl.id and c.status = 'pendente'),0) as pending_commission,
        coalesce((select sum(coalesce(c.net_amount, c.amount)) from commissions c
                  where c.seller_id = sl.id and c.status = 'pendente'),0) as pending_net
      from sellers sl
      where sl.company_id = ${tenant.companyId} and sl.deleted_at is null
      order by sl.name
    `;
    /*
      "vendedor" (e "caixa") tem sellers.read so pra ver o ranking de
      faturamento/comissao dos colegas -- mesmo dado que o Dashboard ja
      mostra pra qualquer um com dashboard.read. Mas so quem tambem tem
      sellers.write (admin/gerente) edita cadastro de vendedor, e so esse
      cadastro tem CPF e salario. Sem este corte, QUALQUER vendedor
      convidado via inviteMemberFn via essa tela via CPF e salario mensal
      de todos os colegas -- o mesmo vazamento que listActiveSellerNamesFn
      (usado no seletor do PDV) existe pra evitar do lado do "pdv", só que
      aqui do lado do "vendedor".
    */
    const podeVerFolha = can(tenant.role, "sellers.write");
    return rows.map((r) => ({
      id: num(r.id),
      name: String(r.name ?? ""),
      email: r.email == null ? null : String(r.email),
      phone: r.phone == null ? null : String(r.phone),
      commission_pct: num(r.commission_pct),
      store_id: r.store_id == null ? null : num(r.store_id),
      is_active: Boolean(r.is_active),
      month_revenue: num(r.month_revenue),
      month_commission: num(r.month_commission),
      pending_commission: num(r.pending_commission),
      pending_net: num(r.pending_net),
      tax_regime: podeVerFolha ? String(r.tax_regime ?? "none") : "none",
      monthly_salary: podeVerFolha ? num(r.monthly_salary) : 0,
      dependents: podeVerFolha ? num(r.dependents) : 0,
      iss_rate: podeVerFolha ? (r.iss_rate == null ? null : num(r.iss_rate)) : null,
      document: podeVerFolha ? (r.document == null ? null : String(r.document)) : null,
    }));
  });

/**
 * Só id+nome, pro seletor de vendedor no PDV. `listSellersFn` também traz
 * salário, comissão e documento — não dá pra usá-lo ali sem vazar dado de
 * folha pra quem só teria acesso ao PDV. Sem perm própria: mesmo nível de
 * exposição do nome do vendedor já impresso no cupom.
 */
export const listActiveSellerNamesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { tenant, sql } = await requireTenant(context.userId);
    return sql<{ id: number; name: string }>`
      select id, name from sellers
      where company_id = ${tenant.companyId} and deleted_at is null and is_active = true
      order by name
    `;
  });

export const saveSellerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      email?: string;
      phone?: string;
      document?: string;
      commissionPct: number;
      storeId?: number | null;
      isActive?: boolean;
      taxRegime?: string;
      monthlySalary?: number;
      dependents?: number;
      issRate?: number | null;
    }) => ({
      ...d,
      name: requireLine(d.name, "Nome"),
      email: optionalLine(d.email, 120) ?? undefined,
      phone: sanitizeCode(d.phone, 32) ?? undefined,
      document: parseBrDocument(d.document, sellerDocKind(d.taxRegime)) ?? undefined,
      // Sem isto dava para gravar comissao de 150% ou negativa: o calculo da
      // venda usa o numero cru.
      commissionPct: requireRange(d.commissionPct, "Comissão (%)", 0, 100),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sellers.write");
    await assertOwned(sql, tenant.companyId, "stores", data.storeId);
    await assertFreeDocument(sql, "sellers", tenant.companyId, data.document, data.id, "um vendedor");
    const taxRegime = data.taxRegime && ["none", "clt", "autonomo", "mei", "pj"].includes(data.taxRegime)
      ? data.taxRegime
      : "none";
    // Math.max(0, Number(x) || 0) deixava passar Infinity (Number("1e999")
    // e truthy) e qualquer numero gigante digitado por engano -- o valor vai
    // direto pra base do calculo de INSS/IRRF da comissao, entao um erro de
    // digitacao aqui distorce o liquido de TODA comissao do vendedor, calado.
    const monthlySalary = data.monthlySalary == null ? 0 : requireRange(data.monthlySalary, "Salário mensal", 0, 999_999_999);
    const dependents = Math.max(0, Math.floor(Number(data.dependents) || 0));
    const issRate = data.issRate == null || data.issRate === undefined ? null : clampIss(data.issRate);
    const document = data.document ?? null;
    const storeName = async (id: unknown) => {
      if (id == null) return null;
      const [st] = await sql<{ name: string }>`select name from stores where id = ${id as number}`;
      return st?.name ?? null;
    };
    if (data.id) {
      const [cur] = await sql<Row>`
        select * from sellers
        where id = ${data.id} and company_id = ${tenant.companyId} and deleted_at is null
      `;
      if (!cur) throw new Error("Vendedor não encontrado.");
      // isActive omitido nao pode reativar quem foi desligado.
      const isActive = data.isActive ?? Boolean(cur.is_active);
      await sql`
        update sellers set name = ${data.name}, email = ${data.email ?? null}, phone = ${data.phone ?? null},
          document = ${document},
          commission_pct = ${data.commissionPct}, store_id = ${data.storeId ?? null}, is_active = ${isActive},
          tax_regime = ${taxRegime}, monthly_salary = ${monthlySalary}, dependents = ${dependents}, iss_rate = ${issRate}
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      await auditUpdate(
        sql,
        tenant,
        "seller",
        data.id,
        {
          name: cur.name,
          email: cur.email ?? null,
          phone: cur.phone ?? null,
          document: cur.document ?? null,
          commissionPct: num(cur.commission_pct),
          store: await storeName(cur.store_id),
          taxRegime: cur.tax_regime ?? "none",
          monthlySalary: num(cur.monthly_salary),
          dependents: num(cur.dependents),
          issRate: cur.iss_rate == null ? null : num(cur.iss_rate),
          isActive: Boolean(cur.is_active),
        },
        {
          name: data.name,
          email: data.email ?? null,
          phone: data.phone ?? null,
          document,
          commissionPct: data.commissionPct,
          store: await storeName(data.storeId),
          taxRegime,
          monthlySalary,
          dependents,
          issRate,
          isActive,
        },
      );
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into sellers (
        company_id, name, email, phone, document, commission_pct, store_id,
        tax_regime, monthly_salary, dependents, iss_rate
      )
      values (
        ${tenant.companyId}, ${data.name}, ${data.email ?? null}, ${data.phone ?? null}, ${document}, ${data.commissionPct},
        ${data.storeId ?? null}, ${taxRegime}, ${monthlySalary}, ${dependents}, ${issRate}
      )
      returning id
    `;
    await audit(sql, tenant, "create", "seller", row!.id, null, {
      name: data.name,
      commissionPct: data.commissionPct,
      store: await storeName(data.storeId),
    });
    return { id: row!.id };
  });
