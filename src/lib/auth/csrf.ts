import { createOAuthState, isOAuthState, statesEqual } from "./oauth-state.ts";

export const CSRF_COOKIE = "__Host-grok-auth.csrf";
export const CSRF_HEADER = "x-csrf-token";

export function readCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Double-submit: cookie and header/body token must be the same 32-hex nonce. */
export function csrfTokensMatch(cookieToken: string | null | undefined, sentToken: string | null | undefined): boolean {
  if (!isOAuthState(cookieToken) || !isOAuthState(sentToken)) return false;
  return statesEqual(cookieToken, sentToken);
}

export function shouldSkipCsrf(method: string, fetchSite: string | null | undefined): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  // Non-browser (SSR, curl, server-fn from the loader) — no Fetch-Metadata.
  if (!fetchSite || fetchSite === "none") return true;
  return false;
}

export function csrfCookieWrite(token: string): string {
  return `${CSRF_COOKIE}=${token}; Path=/; Secure; SameSite=Lax`;
}

export function ensureCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const existing = readCookieValue(document.cookie, CSRF_COOKIE);
  if (existing && isOAuthState(existing)) return existing;
  const token = createOAuthState();
  document.cookie = csrfCookieWrite(token);
  return token;
}
