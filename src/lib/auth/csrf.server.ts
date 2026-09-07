import { getRequest } from "@tanstack/react-start/server";
import { CSRF_COOKIE, CSRF_HEADER, csrfTokensMatch, readCookieValue, shouldSkipCsrf } from "./csrf";

export class CsrfError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: CSRF token mismatch");
    this.name = "CsrfError";
  }
}

export function assertCsrfOnRequest(request: Request, contextToken?: string | null): void {
  const site = request.headers.get("sec-fetch-site");
  if (shouldSkipCsrf(request.method, site)) return;
  const cookieToken = readCookieValue(request.headers.get("cookie"), CSRF_COOKIE);
  const headerToken = request.headers.get(CSRF_HEADER);
  if (!csrfTokensMatch(cookieToken, headerToken ?? contextToken ?? null)) {
    throw new CsrfError();
  }
}

/** For `authMiddleware` — uses the current TanStack request + RPC context token. */
export function assertCsrfFromContext(contextToken?: string | null): void {
  const request = getRequest();
  if (!request) return;
  assertCsrfOnRequest(request, contextToken);
}
