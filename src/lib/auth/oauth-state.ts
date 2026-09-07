import type { GrokProvider } from "./providers";

export const OAUTH_POPUP_SOURCE = "grok-auth-popup";
export const OAUTH_STATE_RE = /^[a-f0-9]{32}$/;
/** HttpOnly cookie binds the opener nonce to this popup (not the query string). */
export const POPUP_STATE_COOKIE = "__Host-grok-auth.oauth_popup_state";

export type OAuthPopupMessage = {
  source: typeof OAUTH_POPUP_SOURCE;
  token: string | null;
  state: string;
  error?: string;
};

/** 16 random bytes as hex — opener and popup must echo the same value. */
export function createOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isOAuthState(value: string | null | undefined): value is string {
  return typeof value === "string" && OAUTH_STATE_RE.test(value);
}

export function isAllowedOAuthProvider(
  providerId: string | null | undefined,
  providers: readonly GrokProvider[],
): boolean {
  if (!providerId) return false;
  return providers.some((p) => p.providerId === providerId);
}

export function statesEqual(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Cookie is the source of truth. A query `state` is optional; if present it must
 * match. Missing/malformed cookie → reject (blocks `?done=1&state=` CSRF).
 */
export function boundPopupState(
  queryState: string | null | undefined,
  cookieState: string | null | undefined,
): string | null {
  if (!isOAuthState(cookieState)) return null;
  const q = queryState?.trim() ?? "";
  if (q && (!isOAuthState(q) || !statesEqual(cookieState, q))) return null;
  return cookieState;
}

export function parseOAuthPopupMessage(
  data: unknown,
  expectedOrigin: string,
  eventOrigin: string,
  expectedState: string,
): OAuthPopupMessage | null {
  if (eventOrigin !== expectedOrigin) return null;
  if (!data || typeof data !== "object") return null;
  const msg = data as Partial<OAuthPopupMessage>;
  if (msg.source !== OAUTH_POPUP_SOURCE) return null;
  if (!isOAuthState(msg.state) || !statesEqual(expectedState, msg.state)) return null;
  if (msg.token != null && typeof msg.token !== "string") return null;
  return {
    source: OAUTH_POPUP_SOURCE,
    token: msg.token ?? null,
    state: msg.state,
    ...(typeof msg.error === "string" ? { error: msg.error } : {}),
  };
}
