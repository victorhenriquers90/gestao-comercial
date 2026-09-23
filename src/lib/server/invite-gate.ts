import type { Sql } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite";
import { isInviteTokenShape } from "@/lib/invite-constants";

/*
  Sem server functions aqui de proposito: o auth/server.ts importa este
  arquivo, e o middleware de auth importa o auth/server.ts -- um
  createServerFn neste modulo fecharia o ciclo.

  So servidor (puxa node:crypto). O context.ts, que vai pro navegador,
  carrega isto com import() dinamico.
*/

export type OpenInvite = {
  id: number;
  companyId: number;
  companyName: string;
  role: string;
  storeId: number | null;
  label: string;
};

export async function findOpenInvite(sql: Sql, token: unknown): Promise<OpenInvite | null> {
  if (!isInviteTokenShape(token)) return null;
  const [row] = await sql<{
    id: number;
    company_id: number;
    company_name: string;
    role: string;
    store_id: number | null;
    email: string;
  }>`
    select i.id, i.company_id, coalesce(c.trade_name, c.name) as company_name,
           i.role, i.store_id, i.email
      from pending_invites i
      join companies c on c.id = i.company_id
     where i.token_hash = ${hashInviteToken(token)}
       and i.accepted_at is null
       and i.expires_at > now()
  `;
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    role: row.role,
    storeId: row.store_id,
    label: row.email,
  };
}

/**
 * Quem pode CRIAR conta: o primeiro usuario do servidor (vira o dono ao
 * entrar) ou quem traz um convite valido. O resto -- qualquer um que
 * alcance a maquina pela rede -- nao.
 */
export async function signupAllowed(sql: Sql, token: unknown): Promise<boolean> {
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from "user"`;
  if (Number(n) === 0) return true;
  return (await findOpenInvite(sql, token)) !== null;
}

/**
 * Aceita o convite para `userId`. Trava a linha do convite: dois aceites
 * do mesmo link (duas abas) nao geram duas entradas, e o segundo recebe
 * "convite invalido".
 */
export async function acceptInvite(sql: Sql, userId: string, token: unknown): Promise<void> {
  if (!isInviteTokenShape(token)) throw new Error("Convite inválido ou expirado.");
  await sql.transaction(async (tx) => {
    const [inv] = await tx<{ id: number; company_id: number; role: string; store_id: number | null }>`
      select id, company_id, role, store_id from pending_invites
       where token_hash = ${hashInviteToken(token)}
         and accepted_at is null
         and expires_at > now()
       for update
    `;
    if (!inv) throw new Error("Convite inválido ou expirado.");
    // Uma conta, uma empresa: o sistema abre sempre a mesma empresa por
    // usuario, entao aceitar um segundo convite deixaria o acesso novo
    // invisivel -- melhor dizer agora.
    const [outra] = await tx<{ id: number }>`
      select id from memberships
       where user_id = ${userId} and company_id <> ${inv.company_id} and is_active = true
       limit 1
    `;
    if (outra) {
      throw new Error("Esta conta já pertence a outra empresa. Crie outra conta para aceitar o convite.");
    }
    await tx`
      insert into memberships (company_id, user_id, role, store_id)
      values (${inv.company_id}, ${userId}, ${inv.role}, ${inv.store_id})
      on conflict (company_id, user_id) do update set role = excluded.role, is_active = true
    `;
    await tx`
      update pending_invites set accepted_at = now(), accepted_by = ${userId}
       where id = ${inv.id}
    `;
  });
}
