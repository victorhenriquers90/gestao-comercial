/**
 * Cliente HTTP minimo pro harness da Fase 3: cookie jar por sessao
 * sintetica (um "VU" = uma empresa/usuario) + o header de bypass do
 * Vercel Deployment Protection (preview fica atras do SSO wall por
 * padrao; sem este header toda requisicao cai num redirect de login em
 * vez de chegar na rota real). Ver HANDOFF.md / loadtest/README.md.
 */

const BYPASS_HEADER = "x-vercel-protection-bypass";

export function createSession() {
  return { cookies: new Map() };
}

function cookieHeader(session) {
  return [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbSetCookie(session, response) {
  // Node's fetch Headers.get("set-cookie") only returns the FIRST one when
  // there are several -- getSetCookie() (available since Node 18.14+) is the
  // one that returns all of them.
  const raw =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    session.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

/**
 * @param {ReturnType<typeof createSession>} session
 * @param {string} baseUrl
 * @param {string} path
 * @param {{method?: string, json?: unknown, headers?: Record<string,string>}} opts
 */
export async function request(session, baseUrl, path, opts = {}) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers = { ...opts.headers };
  if (bypass) headers[BYPASS_HEADER] = bypass;
  // Better Auth recusa POST sem Origin (checagem de CSRF/origin -- ver
  // auth/server.ts, trustedOrigins). Fetch do Node nao manda isso sozinho
  // como um browser manda.
  headers.origin = new URL(baseUrl).origin;
  const cookie = cookieHeader(session);
  if (cookie) headers.cookie = cookie;
  let body;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  const started = performance.now();
  let response;
  let error;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: opts.method ?? "GET",
      headers,
      body,
      redirect: "manual",
    });
  } catch (err) {
    error = err;
  }
  const ms = performance.now() - started;

  if (error) {
    return { ok: false, status: 0, ms, error: String(error), text: "" };
  }
  absorbSetCookie(session, response);
  const text = await response.text();
  const blockedByProtection =
    response.status === 401 &&
    (response.headers.get("x-vercel-sso-protection") || text.includes("Authentication Required"));
  return {
    ok: response.ok,
    status: response.status,
    ms,
    text,
    blockedByProtection,
  };
}
