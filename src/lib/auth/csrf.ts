import { createOAuthState, isOAuthState } from "./oauth-state.ts";

/** Prefixed cookie — only sticks on HTTPS with Path=/ and no Domain. */
export const CSRF_COOKIE = "__Host-grok-auth.csrf";
/** Fallback for HTTP / partitioned preview iframes that drop `__Host-`. */
export const CSRF_COOKIE_FALLBACK = "grok-auth.csrf";
export const CSRF_HEADER = "x-csrf-token";

const CSRF_TOKEN_BYTES = 16;
const CSRF_TOKEN_HEX_LEN = 32;
const CSRF_DUMMY_HEX = "0".repeat(CSRF_TOKEN_HEX_LEN);

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

export function readCsrfCookie(cookieHeader: string | null | undefined): string | null {
  return readCookieValue(cookieHeader, CSRF_COOKIE) ?? readCookieValue(cookieHeader, CSRF_COOKIE_FALLBACK);
}

function hexNibble(code: number): number {
  const digit = code - 48;
  const lower = code - 97;
  if (digit >= 0 && digit <= 9) return digit;
  if (lower >= 0 && lower <= 5) return lower + 10;
  return -1;
}

/**
 * Decode a 32-hex CSRF nonce into 16 bytes. Always walks 32 chars — malformed
 * or missing values still fill a dummy buffer and set `valid = 0`.
 */
export function decodeCsrfToken(value: string | null | undefined): { bytes: Uint8Array; valid: number } {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
  const lengthOk = typeof value === "string" && value.length === CSRF_TOKEN_HEX_LEN ? 1 : 0;
  const src = lengthOk === 1 ? (value as string) : CSRF_DUMMY_HEX;
  let valid = lengthOk;
  for (let i = 0; i < CSRF_TOKEN_BYTES; i++) {
    const hi = hexNibble(src.charCodeAt(i * 2));
    const lo = hexNibble(src.charCodeAt(i * 2 + 1));
    const nibblesOk = hi >= 0 && lo >= 0 ? 1 : 0;
    valid &= nibblesOk;
    bytes[i] = (((hi < 0 ? 0 : hi) << 4) | (lo < 0 ? 0 : lo)) & 0xff;
  }
  return { bytes, valid };
}

/**
 * XOR-fold a fixed 16-byte window. No early return on the first mismatch, so
 * the walk does not leak the differing index. Returns 1 when equal.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): number {
  let diff = a.length === CSRF_TOKEN_BYTES && b.length === CSRF_TOKEN_BYTES ? 0 : 1;
  for (let i = 0; i < CSRF_TOKEN_BYTES; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0 ? 1 : 0;
}

/** Double-submit: cookie and header/body token must be the same 32-hex nonce. */
export function csrfTokensMatch(cookieToken: string | null | undefined, sentToken: string | null | undefined): boolean {
  const left = decodeCsrfToken(cookieToken);
  const right = decodeCsrfToken(sentToken);
  const equal = timingSafeEqualBytes(left.bytes, right.bytes);
  // Bitwise so JS does not short-circuit on `valid` the way `&&` would.
  return (equal & left.valid & right.valid) === 1;
}

export function shouldSkipCsrf(method: string, fetchSite: string | null | undefined): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  // Non-browser (SSR, curl, server-fn from the loader) — no Fetch-Metadata.
  if (!fetchSite || fetchSite === "none") return true;
  return false;
}

/** Same-origin fetch can send custom headers; a classic cross-site form cannot. */
export function isSameOriginFetch(fetchSite: string | null | undefined): boolean {
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

export function csrfRequestAllowed(input: {
  method: string;
  fetchSite: string | null | undefined;
  cookieToken: string | null;
  headerToken: string | null;
  contextToken?: string | null;
}): boolean {
  if (shouldSkipCsrf(input.method, input.fetchSite)) return true;
  const sent = input.headerToken ?? input.contextToken ?? null;
  if (csrfTokensMatch(input.cookieToken, sent)) return true;
  // Cookie presente e válido mas diferente do header/contexto = ataque ou sessão
  // velha — não cair no atalho de preview.
  if (isOAuthState(input.cookieToken)) return false;
  if (input.headerToken && input.contextToken && !csrfTokensMatch(input.headerToken, input.contextToken)) {
    return false;
  }
  // Preview iframe / HTTP: `__Host-` não cola. Same-origin + nonce no header
  // (ou no RPC) não é forjável por form cross-site.
  return isSameOriginFetch(input.fetchSite) && isOAuthState(sent);
}

export function csrfCookieWrite(token: string, secure = true): string[] {
  const lines = [`${CSRF_COOKIE_FALLBACK}=${token}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`];
  if (secure) lines.push(`${CSRF_COOKIE}=${token}; Path=/; Secure; SameSite=Lax`);
  return lines;
}

export function ensureCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const existing = readCsrfCookie(document.cookie);
  if (existing && isOAuthState(existing)) return existing;
  const token = createOAuthState();
  const secure = typeof window !== "undefined" ? window.isSecureContext : true;
  for (const line of csrfCookieWrite(token, secure)) {
    document.cookie = line;
  }
  return token;
}
