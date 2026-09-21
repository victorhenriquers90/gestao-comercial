import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { CASH_DIFFERENCE_TOLERANCE } from "@/lib/cash-count";
import { APP_NAME } from "@/lib/constants";
import { formatBRL } from "@/lib/format";
import { assertCan, can, isRole, type Role, DEFAULT_DISCOUNT_LIMIT } from "@/lib/permissions";
import { num } from "@/lib/utils";
import { audit, requireTenant } from "./context";
import { dump, type Row } from "@/lib/json";
import { ftsPrefix, prefixLike } from "@/lib/search";
import { parseCnpj } from "@/lib/document";
import { clampIss, ISS_DEFAULT } from "@/lib/tax";
import { isTaxRegime } from "@/lib/nfce";
import {
  optionalLine,
  requireLine,
  sanitizeCode,
  sanitizeHttpUrl,
  sanitizeMultiline,
} from "@/lib/sanitize";

export const getTenantFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { tenant } = await requireTenant(context.userId);
    return tenant;
  });

export const globalSearchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const q = data.q.trim();
    if (q.length < 2) return [] as { type: string; id: number; title: string; subtitle: string; href: string }[];
    const like = prefixLike(q);
    const fts = ftsPrefix(q);
    const contains = `%${q}%`;
    // A busca global devolvia as cinco secoes para QUALQUER papel autenticado:
    // era o unico caminho de leitura sem assertCan, e furava o que as telas
    // barram. Um "Operador de PDV" (so pdv.sell, pdv.discount, customers.read,
    // cash.read, cash.write) recebia por aqui nome/SKU de produto, razao social
    // de fornecedor e numero/total de venda e de compra -- justamente o que o
    // papel nao pode ler, "nem no menu nem no servidor". Cada secao agora so e
    // consultada se o papel tiver a permissao correspondente; clientes segue
    // aparecendo para o PDV porque customers.read faz parte do papel.
    const podeProdutos = can(tenant.role, "products.read");
    const podeClientes = can(tenant.role, "customers.read");
    const podeFornecedores = can(tenant.role, "suppliers.read");
    const podeVendas = can(tenant.role, "sales.read");
    const podeCompras = can(tenant.role, "purchases.read");
    const products = !podeProdutos ? [] : await sql<{ id: number; name: string; sku: string | null; barcode: string | null }>`
      select id, name, sku, barcode from products
      where company_id = ${tenant.companyId} and deleted_at is null
        and (
          sku = ${q} or barcode = ${q} or internal_code = ${q}
          or lower(name) like ${like} or lower(coalesce(sku,'')) like ${like}
          or to_tsvector('simple', coalesce(name,'')) @@ to_tsquery('simple', ${fts})
          or name ilike ${contains}
        )
      order by name limit 6
    `;
    const customers = !podeClientes ? [] : await sql<{ id: number; name: string; document: string | null }>`
      select id, name, document from customers
      where company_id = ${tenant.companyId} and deleted_at is null
        and (
          document = ${q} or phone = ${q}
          or lower(name) like ${like} or lower(coalesce(phone,'')) like ${like}
          or to_tsvector('simple', coalesce(name,'')) @@ to_tsquery('simple', ${fts})
          or name ilike ${contains}
        )
      limit 5
    `;
    const suppliers = !podeFornecedores ? [] : await sql<{ id: number; legal_name: string; trade_name: string | null }>`
      select id, legal_name, trade_name from suppliers
      where company_id = ${tenant.companyId} and deleted_at is null
        and (
          document = ${q}
          or lower(legal_name) like ${like} or lower(coalesce(trade_name,'')) like ${like}
          or to_tsvector('simple', coalesce(legal_name,'') || ' ' || coalesce(trade_name,'')) @@ to_tsquery('simple', ${fts})
          or legal_name ilike ${contains} or trade_name ilike ${contains}
        )
      limit 4
    `;
    const sales = !podeVendas ? [] : await sql<{ id: number; number: number; total: string | number }>`
      select id, number, total from sales
      where company_id = ${tenant.companyId} and deleted_at is null
        and (cast(number as text) = ${q} or cast(id as text) = ${q})
      limit 4
    `;
    const purchases = !podeCompras ? [] : await sql<{ id: number; number: number; total: string | number }>`
      select id, number, total from purchases
      where company_id = ${tenant.companyId} and deleted_at is null
        and (cast(number as text) = ${q} or cast(id as text) = ${q})
      limit 3
    `;
    return [
      ...products.map((p) => ({
        type: "produto",
        id: p.id,
        title: p.name,
        subtitle: p.sku || p.barcode || "Produto",
        href: `/app/produtos?id=${p.id}`,
      })),
      ...customers.map((c) => ({
        type: "cliente",
        id: c.id,
        title: c.name,
        subtitle: c.document || "Cliente",
        href: `/app/clientes?id=${c.id}`,
      })),
      ...suppliers.map((s) => ({
        type: "fornecedor",
        id: s.id,
        title: s.trade_name || s.legal_name,
        subtitle: "Fornecedor",
        href: `/app/fornecedores?id=${s.id}`,
      })),
      ...sales.map((s) => ({
        type: "venda",
        id: s.id,
        title: `Venda nº ${s.number}`,
        subtitle: formatBRL(num(s.total)),
        href: `/app/vendas?id=${s.id}`,
      })),
      ...purchases.map((p) => ({
        type: "compra",
        id: p.id,
        title: `Pedido nº ${p.number}`,
        subtitle: formatBRL(num(p.total)),
        href: `/app/compras?id=${p.id}`,
      })),
    ];
  });

export const listNotificationsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const low = await sql<{ n: number }>`
      select count(*)::int as n from inventories i
      join product_variants v on v.id = i.variant_id
      join products p on p.id = v.product_id
      where i.company_id = ${tenant.companyId} and p.deleted_at is null
        and i.quantity <= greatest(i.min_stock, p.min_stock) and greatest(i.min_stock, p.min_stock) > 0
    `;
    const overduePay = await sql<{ n: number }>`
      select count(*)::int as n from accounts_payable
      where company_id = ${tenant.companyId} and deleted_at is null
        and status in ('pendente','parcial') and due_date < current_date
    `;
    /*
      Cobranca do CLIENTE, nao repasse de cartao.

      O aviso anterior contava todo recebivel vencido. Agora que a venda no
      cartao tambem gera recebivel, isso encheria o sino de 'atraso' da
      adquirente -- que nao e cobranca, e conciliacao: ninguem liga pra
      maquininha pedindo o dinheiro. Fica so o que uma PESSOA deve.
    */
    const recVencido = await sql<{ n: number; v: string | number }>`
      select count(*)::int as n, coalesce(sum(amount - received_amount), 0) as v
        from accounts_receivable
       where company_id = ${tenant.companyId} and deleted_at is null
         and status in ('pendente','parcial') and origin <> 'cartao'
         and customer_id is not null and due_date < current_date
    `;
    /*
      'Vence hoje' tem aviso proprio: e o unico dia em que o telefonema
      ainda EVITA o atraso, em vez de cobrar um que ja aconteceu. Sem ele o
      sino so avisa quando ja e tarde.
    */
    const recHoje = await sql<{ n: number; v: string | number }>`
      select count(*)::int as n, coalesce(sum(amount - received_amount), 0) as v
        from accounts_receivable
       where company_id = ${tenant.companyId} and deleted_at is null
         and status in ('pendente','parcial') and origin <> 'cartao'
         and customer_id is not null and due_date = current_date
    `;
    /*
      Diferenca de caixa sem explicacao.

      O fechamento cego produz um numero que alguem precisa justificar --
      e justificativa que fica "pra depois" nunca acontece. Aqui e estado,
      nao evento: some sozinho quando a explicacao entra, e enquanto nao
      entrar continua aparecendo todo dia pra quem abre o sistema.
    */
    const caixaDivergente = await sql<{ n: number; v: string | number }>`
      select count(*)::int as n, coalesce(sum(abs(difference_amount)), 0) as v
        from cash_registers
       where company_id = ${tenant.companyId} and status = 'closed'
         and difference_reason is null
         and abs(difference_amount) > ${CASH_DIFFERENCE_TOLERANCE}
    `;
    const dueTasks = await sql<{ n: number }>`
      select count(*)::int as n from crm_tasks
      where company_id = ${tenant.companyId} and done_at is null
        and due_at is not null and due_at < now() + interval '1 day'
    `;
    const stored = await sql<{
      id: number;
      kind: string;
      title: string;
      body: string | null;
      href: string | null;
      created_at: string;
    }>`
      select id, kind, title, body, href, created_at from notifications
      where company_id = ${tenant.companyId} and read_at is null
      order by created_at desc limit 12
    `;
    /*
      `dismissible` separa os dois tipos de aviso que convivem aqui.

      Os derivados (estoque baixo, cobranca, tarefas) sao ESTADO: somem
      quando o problema acaba, e nao ha o que marcar como lido. Os
      armazenados sao EVENTO e se dispensam. Sem essa marca, o botao
      "Limpar" aparecia mesmo quando so havia derivados -- e nao limpava
      nada, porque nao havia nada pra limpar.
    */
    const items: {
      id: string;
      title: string;
      body: string;
      href: string;
      kind: string;
      dismissible: boolean;
    }[] = [];
    if (num(low[0]?.n) > 0) {
      items.push({
        id: "low",
        kind: "estoque",
        title: "Estoque baixo",
        body: `${low[0]!.n} produto(s) no ponto de reposição.`,
        href: "/app/estoque",
        dismissible: false,
      });
    }
    if (num(overduePay[0]?.n) > 0) {
      items.push({
        id: "ap",
        kind: "financeiro",
        title: "Contas vencidas",
        body: `${overduePay[0]!.n} conta(s) a pagar vencida(s).`,
        href: "/app/financeiro",
        dismissible: false,
      });
    }
    if (num(recHoje[0]?.n) > 0) {
      items.push({
        id: "cob-hoje",
        kind: "financeiro",
        title: "Parcelas vencendo hoje",
        body: `${recHoje[0]!.n} parcela(s) de cliente, ${formatBRL(num(recHoje[0]?.v))}. Hoje ainda dá pra evitar o atraso.`,
        href: "/app/financeiro?tab=cobranca",
        dismissible: false,
      });
    }
    if (num(recVencido[0]?.n) > 0) {
      items.push({
        id: "cob-vencido",
        kind: "financeiro",
        title: "Cobrança em atraso",
        body: `${recVencido[0]!.n} parcela(s) de cliente vencida(s), ${formatBRL(num(recVencido[0]?.v))}.`,
        href: "/app/financeiro?tab=cobranca",
        dismissible: false,
      });
    }
    if (num(caixaDivergente[0]?.n) > 0) {
      items.push({
        id: "caixa-dif",
        kind: "financeiro",
        title: "Diferença de caixa sem explicação",
        body: `${caixaDivergente[0]!.n} fechamento(s), ${formatBRL(num(caixaDivergente[0]?.v))} no total.`,
        href: "/app/caixa",
        dismissible: false,
      });
    }
    if (num(dueTasks[0]?.n) > 0) {
      items.push({
        id: "crm",
        kind: "crm",
        title: "Tarefas do CRM",
        body: `${dueTasks[0]!.n} follow-up(s) vencido(s) ou para hoje.`,
        href: "/app/crm",
        dismissible: false,
      });
    }
    for (const n of stored) {
      items.push({
        id: String(n.id),
        kind: n.kind,
        title: n.title,
        body: n.body ?? "",
        href: n.href ?? "/app",
        dismissible: true,
      });
    }
    return items;
  });

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const [company] = await sql<Row>`
      select id, name, trade_name, document, email, phone, address, city, state, zip, logo_url,
             ie, tax_regime
      from companies where id = ${tenant.companyId}
    `;
    const settings = await sql<Row>`select * from company_settings where company_id = ${tenant.companyId}`;
    // Equipe e convites so para quem pode ver gente. O resto do retorno
    // (empresa, settings, lojas) fica aberto de proposito: o PDV depende dele
    // para montar o comprovante e ler allow_negative_stock, entao fechar a
    // funcao inteira quebraria a venda. Antes, sem separar, o operador de PDV
    // recebia nome, e-mail, papel e limite de desconto de cada colega.
    const podeVerEquipe = can(tenant.role, "users.read");
    const members = !podeVerEquipe ? [] : await sql<{
      id: number;
      user_id: string;
      role: string;
      discount_limit: string | number | null;
      name: string | null;
      email: string | null;
    }>`
      select m.id, m.user_id, m.role, m.discount_limit, u.name, u.email
      from memberships m
      left join "user" u on u.id = m.user_id
      where m.company_id = ${tenant.companyId} and m.is_active = true
      order by m.id
    `;
    const invites = !podeVerEquipe
      ? []
      : await sql<Row>`
          select id, email, role, created_at from pending_invites
          where company_id = ${tenant.companyId} and accepted_at is null
        `;
    const stores = await sql<Row>`
      select id, name, code, phone, address, city, state, zip, is_active
      from stores where company_id = ${tenant.companyId} and deleted_at is null
    `;
    return dump({
      company: company ?? null,
      settings: settings[0] ?? null,
      members: members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        discount_limit: m.discount_limit == null ? null : num(m.discount_limit),
        name: m.name,
        email: m.email,
      })),
      invites,
      stores,
      appName: APP_NAME,
    });
  });

export const saveCompanyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      name: string;
      tradeName?: string;
      document?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      logoUrl?: string | null;
      printHeader?: string;
      printFooter?: string;
      receiptMessage?: string;
      allowNegativeStock?: boolean;
      issRate?: number;
      issWithhold?: boolean;
      ie?: string;
      taxRegime?: string;
      nfceEnabled?: boolean;
    }) => ({
      ...d,
      name: requireLine(d.name, "Nome da loja"),
      tradeName: optionalLine(d.tradeName) ?? undefined,
      document: parseCnpj(d.document) ?? undefined,
      email: optionalLine(d.email, 120) ?? undefined,
      phone: sanitizeCode(d.phone, 32) ?? undefined,
      address: optionalLine(d.address, 200) ?? undefined,
      city: optionalLine(d.city, 80) ?? undefined,
      state: optionalLine(d.state, 2) ?? undefined,
      zip: sanitizeCode(d.zip, 16) ?? undefined,
      logoUrl: sanitizeHttpUrl(d.logoUrl),
      printHeader: sanitizeMultiline(d.printHeader, 500) ?? undefined,
      printFooter: sanitizeMultiline(d.printFooter, 500) ?? undefined,
      receiptMessage: sanitizeMultiline(d.receiptMessage, 500) ?? undefined,
      ie: sanitizeCode(d.ie, 20) ?? undefined,
      taxRegime: isTaxRegime(d.taxRegime) ? d.taxRegime : undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "settings.write");
    await sql`
      update companies set
        name = ${data.name},
        trade_name = ${data.tradeName ?? null},
        document = ${data.document ?? null},
        email = ${data.email ?? null},
        phone = ${data.phone ?? null},
        address = ${data.address ?? null},
        city = ${data.city ?? null},
        state = ${data.state ?? null},
        zip = ${data.zip ?? null},
        logo_url = ${data.logoUrl ?? null},
        ie = coalesce(${data.ie ?? null}, ie),
        tax_regime = coalesce(${data.taxRegime ?? null}, tax_regime),
        updated_at = now()
      where id = ${tenant.companyId}
    `;
    const [cur] = await sql<{
      iss_rate: string | number | null;
      iss_withhold: boolean | null;
      nfce_enabled: boolean | null;
    }>`
      select iss_rate, iss_withhold, nfce_enabled from company_settings where company_id = ${tenant.companyId}
    `;
    const issRate = data.issRate != null ? clampIss(data.issRate) : cur?.iss_rate == null ? ISS_DEFAULT : clampIss(cur.iss_rate);
    const issWithhold = data.issWithhold != null ? data.issWithhold : cur?.iss_withhold !== false;
    const nfceEnabled = data.nfceEnabled != null ? data.nfceEnabled : cur?.nfce_enabled === true;
    await sql`
      insert into company_settings (
        company_id, print_header, print_footer, receipt_message, allow_negative_stock, iss_rate, iss_withhold,
        nfce_enabled
      )
      values (
        ${tenant.companyId}, ${data.printHeader ?? null}, ${data.printFooter ?? null}, ${data.receiptMessage ?? null},
        ${Boolean(data.allowNegativeStock)}, ${issRate}, ${issWithhold}, ${nfceEnabled}
      )
      on conflict (company_id) do update set
        print_header = excluded.print_header,
        print_footer = excluded.print_footer,
        receipt_message = excluded.receipt_message,
        allow_negative_stock = excluded.allow_negative_stock,
        iss_rate = excluded.iss_rate,
        nfce_enabled = excluded.nfce_enabled,
        iss_withhold = excluded.iss_withhold,
        updated_at = now()
    `;
    await audit(sql, tenant, "update", "company", tenant.companyId, null, { name: data.name });
    return { ok: true };
  });

export const saveStoreFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      code?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "settings.write");
    if (data.id) {
      await sql`
        update stores set name = ${data.name}, code = ${data.code ?? null}, phone = ${data.phone ?? null},
          address = ${data.address ?? null}, city = ${data.city ?? null}, state = ${data.state ?? null},
          zip = ${data.zip ?? null}, updated_at = now()
        where id = ${data.id} and company_id = ${tenant.companyId}
      `;
      return { id: data.id };
    }
    const [row] = await sql<{ id: number }>`
      insert into stores (company_id, name, code, phone, address, city, state, zip)
      values (${tenant.companyId}, ${data.name}, ${data.code ?? null}, ${data.phone ?? null}, ${data.address ?? null}, ${data.city ?? null}, ${data.state ?? null}, ${data.zip ?? null})
      returning id
    `;
    return { id: row!.id };
  });

export const inviteMemberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { email: string; role: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "users.write");
    const email = data.email.trim().toLowerCase();
    const role: Role = isRole(data.role) ? data.role : "vendedor";
    const existing = await sql<{ id: string }>`select id from "user" where lower(email) = ${email}`;
    if (existing[0]) {
      await sql`
        insert into memberships (company_id, user_id, role)
        values (${tenant.companyId}, ${existing[0].id}, ${role})
        on conflict (company_id, user_id) do update set role = excluded.role, is_active = true
      `;
    } else {
      await sql`
        insert into pending_invites (company_id, email, role, invited_by)
        values (${tenant.companyId}, ${email}, ${role}, ${tenant.userId})
      `;
    }
    await audit(sql, tenant, "invite", "membership", email, null, { role });
    return { ok: true };
  });

export const listAuditFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { page?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "audit.read");
    const page = data.page ?? 1;
    const offset = (page - 1) * 40;
    return dump(await sql<Row>`
      select id, user_id, action, entity, entity_id, created_at
      from audit_logs
      where company_id = ${tenant.companyId}
      order by created_at desc
      limit 40 offset ${offset}
    `);
  });

export const markNotificationReadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    if (data.id) {
      await sql`
        update notifications set read_at = now()
        where id = ${data.id} and company_id = ${tenant.companyId} and read_at is null
      `;
    } else {
      await sql`
        update notifications set read_at = now()
        where company_id = ${tenant.companyId} and read_at is null
      `;
    }
    return { ok: true };
  });

export const updateMemberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { id: number; role?: string; discountLimit?: number | null; isActive?: boolean }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "users.write");
    const [member] = await sql<{ id: number; user_id: string; role: string }>`
      select id, user_id, role from memberships
      where id = ${data.id} and company_id = ${tenant.companyId}
    `;
    if (!member) throw new Error("Usuário não encontrado.");
    if (data.isActive === false && member.user_id === tenant.userId) {
      throw new Error("Você não pode desativar a si mesmo.");
    }
    const nextRole = data.role && isRole(data.role) ? data.role : undefined;
    if (member.role === "admin" && (nextRole !== "admin" || data.isActive === false)) {
      const [admins] = await sql<{ n: number }>`
        select count(*)::int as n from memberships
        where company_id = ${tenant.companyId} and is_active = true and role = 'admin'
      `;
      if (num(admins?.n) <= 1) throw new Error("Mantenha ao menos um administrador.");
    }
    const role = nextRole ?? member.role;
    const limit =
      data.discountLimit == null ? DEFAULT_DISCOUNT_LIMIT[role as Role] : data.discountLimit;
    await sql`
      update memberships
         set role = ${role},
             discount_limit = ${limit},
             is_active = ${data.isActive ?? true}
       where id = ${member.id}
    `;
    await audit(sql, tenant, "update", "membership", member.id, { role: member.role }, { role, limit });
    return { ok: true };
  });
