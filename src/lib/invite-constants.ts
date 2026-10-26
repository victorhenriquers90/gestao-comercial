// Sem node:crypto aqui de proposito: context.ts importa isto, e context.ts
// chega ao bundle do navegador (via server/nfce.ts). Um import nomeado de
// node:crypto quebra a pagina inteira no carregamento.

export const INVITE_COOKIE = "gc_invite";
export const INVITE_TTL_DAYS = 7;

export const NO_ACCESS_MESSAGE =
  "Sua conta ainda não tem acesso a nenhuma empresa. Peça ao administrador um link de convite.";

// 24 bytes em base64url = 32 caracteres; o resto e lixo ou tentativa.
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32}$/.test(token);
}

/**
 * SaaS multi-empresa: com `GC_MULTI_TENANT=1` (so no projeto Vercel),
 * qualquer um pode criar conta E empresa nova, mesmo com outras empresas ja
 * existindo no mesmo banco. Sem a flag (padrao -- inclusive em toda
 * instalacao on-premise, que nunca a define), o comportamento antigo
 * continua: so o primeiro usuario do servidor vazio ou quem traz convite --
 * evita que alguem crie uma empresa extra por engano numa instalacao de
 * loja unica. Usado por `signupAllowed` (invite-gate.ts) e `ensureTenant`
 * (context.ts); exportado daqui (em vez de invite-gate.ts) porque este
 * arquivo e o unico dos dois que o bundle do navegador pode importar
 * estaticamente sem puxar `node:crypto` (ver comentario no topo).
 */
export function multiTenantEnabled(flag: string | undefined): boolean {
  return flag === "1";
}
