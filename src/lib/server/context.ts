import { dbSource, getSql, type Sql } from "@/lib/db";
import { demoSeedEnabled } from "@/lib/demo-seed";
import { INVITE_COOKIE, NO_ACCESS_MESSAGE } from "@/lib/invite-constants";
import { DEFAULT_DISCOUNT_LIMIT, isRole, type Role } from "@/lib/permissions";
import { num, str } from "@/lib/utils";
import { seedCompany } from "./seed";

export type StoreRef = { id: number; name: string; city: string | null };

export type Tenant = {
  userId: string;
  userName: string;
  userEmail: string | null;
  companyId: number;
  companyName: string;
  tradeName: string | null;
  document: string | null;
  role: Role;
  discountLimit: number;
  defaultStoreId: number;
  stores: StoreRef[];
};

export async function requireTenant(userId: string): Promise<{ sql: Sql; tenant: Tenant }> {
  const sql = await getSql();
  const convite = await readInviteCookie();
  try {
    const tenant = await ensureTenant(sql, userId, convite);
    return { sql, tenant };
  } finally {
    // Usado ou recusado, o cookie sai: um convite vencido preso nele
    // repetiria o mesmo erro em toda requisicao.
    if (convite) await clearInviteCookie();
  }
}

/*
  import() dinamico, nao estatico: este arquivo chega ao bundle do
  navegador (via server/nfce.ts), e modulo so-de-servidor importado no topo
  quebra a pagina no carregamento. Mesmo padrao do gate-session.server.ts.
  Fora de uma requisicao (script, teste) nao ha cookie -- e nao e erro.
*/
async function readInviteCookie(): Promise<string | null> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(INVITE_COOKIE) ?? null;
  } catch {
    return null;
  }
}

async function clearInviteCookie(): Promise<void> {
  try {
    const { deleteCookie } = await import("@tanstack/react-start/server");
    deleteCookie(INVITE_COOKIE, { path: "/" });
  } catch {
    // idem
  }
}

export async function assertStore(
  sql: Sql,
  companyId: number,
  storeId: number,
): Promise<void> {
  const rows = await sql<{ id: number }>`
    select id from stores
    where id = ${storeId} and company_id = ${companyId} and deleted_at is null
  `;
  if (!rows.length) throw new Error("Loja inválida para esta empresa.");
}

const OWNED = {
  customers: "Cliente inválido",
  sellers: "Vendedor inválido",
  suppliers: "Fornecedor inválido",
  brands: "Marca inválida",
  categories: "Categoria inválida",
  products: "Produto inválido",
  stores: "Loja inválida",
} as const;

// Qualquer conta nova ganha empresa propria no mesmo banco: um id vindo do
// cliente pode ser de outra empresa, e o join na leitura mostraria os dados dela.
export async function assertOwned(
  sql: Sql,
  companyId: number,
  table: keyof typeof OWNED,
  id: number | null | undefined,
): Promise<void> {
  if (id == null) return;
  const rows = await sql.query<{ id: number }>(
    `select id from ${table} where id = $1 and company_id = $2`,
    [id, companyId],
  );
  if (!rows.length) throw new Error(`${OWNED[table]} para esta empresa.`);
}

export async function assertVariants(
  sql: Sql,
  companyId: number,
  variantIds: number[],
): Promise<void> {
  /*
    Confere que cada variante citada pertence a esta empresa.

    Sem isto, `applyStockChange` cria a linha de inventario pelo id que
    chegou, sem perguntar de quem ele e: da pra referenciar a variante de
    OUTRA empresa e passar a ve-la nos joins de estoque e movimentacao, que
    trazem nome e detalhe do produto. A loja nao consegue alterar o estoque
    alheio (a linha nasce com o company_id de quem chamou), mas ve o que nao
    e dela -- e o mesmo tipo de vazamento que o globalSearch tinha.
  */
  const ids = [...new Set(variantIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) return;
  const rows = await sql.query<{ id: number }>(
    `select id from product_variants where company_id = $1 and id = any($2::int[])`,
    [companyId, ids],
  );
  if (rows.length !== ids.length) {
    throw new Error("Produto inválido para esta empresa.");
  }
}

export async function assertFreeDocument(
  sql: Sql,
  table: "customers" | "sellers" | "suppliers",
  companyId: number,
  document: string | null | undefined,
  exceptId: number | undefined,
  label: string,
): Promise<void> {
  if (!document) return;
  const rows = await sql.query<{ id: number }>(
    `select id from ${table}
      where company_id = $1 and document = $2 and deleted_at is null
        and ($3::int is null or id <> $3)
      limit 1`,
    [companyId, document, exceptId ?? null],
  );
  if (rows.length) throw new Error(`Já existe ${label} com este documento.`);
}

export async function nextNumber(sql: Sql, companyId: number, key: string): Promise<number> {
  const rows = await sql.query<{ value: number }>(
    `insert into company_counters (company_id, key, value)
     values ($1, $2, 1)
     on conflict (company_id, key)
     do update set value = company_counters.value + 1
     returning value`,
    [companyId, key],
  );
  return num(rows[0]?.value);
}

export async function audit(
  sql: Sql,
  tenant: Tenant,
  action: string,
  entity: string,
  entityId: string | number | null,
  before: unknown = null,
  after: unknown = null,
) {
  await sql.query(
    `insert into audit_logs (company_id, user_id, action, entity, entity_id, before_data, after_data)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      tenant.companyId,
      tenant.userId,
      action,
      entity,
      entityId == null ? null : String(entityId),
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  );
}

async function loadUser(sql: Sql, userId: string) {
  const rows = await sql<{ id: string; name: string; email: string | null }>`
    select id, name, email from "user" where id = ${userId}
  `;
  return rows[0] ?? { id: userId, name: "Usuário", email: null };
}

async function loadTenant(sql: Sql, userId: string): Promise<Tenant | null> {
  const rows = await sql<{
    company_id: number;
    company_name: string;
    trade_name: string | null;
    document: string | null;
    role: string;
    discount_limit: string | number | null;
    store_id: number | null;
  }>`
    select m.company_id, c.name as company_name, c.trade_name, c.document,
           m.role, m.discount_limit, m.store_id
    from memberships m
    join companies c on c.id = m.company_id
    where m.user_id = ${userId} and m.is_active = true and c.deleted_at is null
    order by m.id asc
    limit 1
  `;
  if (!rows.length) return null;
  const m = rows[0]!;
  const stores = await sql<StoreRef>`
    select id, name, city from stores
    where company_id = ${m.company_id} and deleted_at is null
    order by id
  `;
  const role: Role = isRole(m.role) ? m.role : "vendedor";
  const user = await loadUser(sql, userId);
  const discountLimit =
    m.discount_limit == null ? DEFAULT_DISCOUNT_LIMIT[role] : num(m.discount_limit);
  return {
    userId,
    userName: user.name,
    userEmail: user.email,
    companyId: m.company_id,
    companyName: m.company_name,
    tradeName: m.trade_name,
    document: m.document,
    role,
    discountLimit,
    defaultStoreId: m.store_id ?? stores[0]?.id ?? 0,
    stores,
  };
}

export async function ensureTenant(
  sql: Sql,
  userId: string,
  inviteToken?: string | null,
): Promise<Tenant> {
  const existing = await loadTenant(sql, userId);
  if (existing) return existing;

  // Convite so pelo link (token). Casar pelo e-mail entregava o papel a
  // quem cadastrasse aquele endereco primeiro -- o cadastro nao confere
  // posse do e-mail.
  if (inviteToken) {
    const { acceptInvite } = await import("./invite-gate");
    await acceptInvite(sql, userId, inviteToken);
    const tenant = await loadTenant(sql, userId);
    if (tenant) return tenant;
  }

  // Empresa nova so no servidor vazio: e o dono instalando. Antes qualquer
  // conta sem convite ganhava empresa propria no mesmo banco.
  const [{ n: empresas }] = await sql<{ n: number }>`select count(*)::int as n from companies`;
  if (Number(empresas) > 0) throw new Error(NO_ACCESS_MESSAGE);

  const user = await loadUser(sql, userId);
  const firstName = user.name?.split(" ")[0] || "Minha";
  const companyName = `${firstName} Comércio`;
  const [company] = await sql<{ id: number }>`
    insert into companies (name, trade_name, email)
    values (${companyName}, ${companyName}, ${user.email})
    returning id
  `;
  const companyId = company!.id;
  const demo = demoSeedEnabled(dbSource, process.env.GC_DEMO_SEED);

  // Sem demonstracao: uma loja so, sem cidade inventada -- endereco errado
  // aqui iria parar em cupom e nota. O dono completa em Configuracoes.
  const [store] = demo
    ? await sql<{ id: number }>`
        insert into stores (company_id, name, code, city, state)
        values (${companyId}, 'Loja Centro', 'LJ01', 'São Paulo', 'SP')
        returning id
      `
    : await sql<{ id: number }>`
        insert into stores (company_id, name, code)
        values (${companyId}, 'Loja principal', 'LJ01')
        returning id
      `;
  const storeId = store!.id;

  if (demo) {
    await sql`
      insert into stores (company_id, name, code, city, state)
      values (${companyId}, 'Loja Shopping', 'LJ02', 'São Paulo', 'SP')
    `;
  }

  await sql`
    insert into memberships (company_id, user_id, role, store_id)
    values (${companyId}, ${userId}, 'admin', ${storeId})
  `;

  await sql`
    insert into company_settings (company_id, print_header, print_footer, receipt_message)
    values (
      ${companyId},
      ${companyName},
      'Obrigado pela preferência.',
      'Trocas em até 7 dias com nota fiscal.'
    )
  `;

  for (const kind of ["caixa", "banco", "pix", "cartao", "carteira"] as const) {
    const label =
      kind === "caixa"
        ? "Caixa da loja"
        : kind === "banco"
          ? "Conta corrente"
          : kind === "pix"
            ? "PIX"
            : kind === "cartao"
              ? "Maquininha"
              : "Carteira";
    await sql`
      insert into cash_accounts (company_id, store_id, name, kind, opening_balance)
      values (${companyId}, ${storeId}, ${label}, ${kind}, ${demo && kind === "caixa" ? 350 : 0})
    `;
  }

  if (demo) {
    await seedCompany(sql, {
      companyId,
      storeId,
      userId,
      companyName,
      userName: user.name,
    });
  }

  const tenant = await loadTenant(sql, userId);
  if (!tenant) throw new Error("Falha ao inicializar a empresa.");
  return tenant;
}

export function storeClause(storeId?: number | null): { sql: string; params: unknown[] } {
  if (storeId == null || storeId <= 0) return { sql: "", params: [] };
  return { sql: " and store_id = $SID ", params: [storeId] };
}
