import { getRequest } from "@tanstack/react-start/server";
import { CSRF_HEADER, csrfRequestAllowed, readCsrfCookie } from "./csrf";

export class CsrfError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: CSRF token mismatch");
    this.name = "CsrfError";
  }
}

export function assertCsrfOnRequest(request: Request, contextToken?: string | null): void {
  const allowed = csrfRequestAllowed({
    method: request.method,
    fetchSite: request.headers.get("sec-fetch-site"),
    cookieToken: readCsrfCookie(request.headers.get("cookie")),
    headerToken: request.headers.get(CSRF_HEADER),
    contextToken,
  });
  if (!allowed) throw new CsrfError();
}

/** For `authMiddleware` — uses the current TanStack request + RPC context token. */
export function assertCsrfFromContext(contextToken?: string | null): void {
  const request = getRequest();
  if (!request) return;
  assertCsrfOnRequest(request, contextToken);
}