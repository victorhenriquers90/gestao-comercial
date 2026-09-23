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
