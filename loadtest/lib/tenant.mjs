import { createSession, request } from "./http.mjs";

/**
 * Cria uma empresa sintetica via cadastro publico (Better Auth
 * email/password). So funciona com GC_MULTI_TENANT=1 no preview --
 * sem a flag, so o primeiro usuario do servidor pode se cadastrar
 * (ver src/lib/server/invite-gate.ts).
 *
 * `gc_company_name` e o MESMO cookie que `stashCompanyNameFn`
 * (session.ts) escreve a partir do formulario -- setar direto aqui
 * evita precisar do path com hash do serverFn pra essa unica chamada.
 *
 * Sign-up/sign-in do Better Auth tem rate limit agressivo por padrao
 * (~3 tentativas/10s, ver auth/server.ts). Chame esta funcao com
 * pacing (ver `rampTenants` em run.mjs) -- nao em paralelo sem limite.
 */
export async function signUpTenant(baseUrl, { email, password, name, companyName }) {
  const session = createSession();
  session.cookies.set("gc_company_name", encodeURIComponent(companyName));

  const res = await request(session, baseUrl, "/api/auth/sign-up/email", {
    method: "POST",
    json: { email, password, name, callbackURL: "/app" },
  });

  if (res.blockedByProtection) {
    throw new Error(
      "Bloqueado pelo Vercel Deployment Protection -- confira VERCEL_AUTOMATION_BYPASS_SECRET em loadtest/.env.",
    );
  }
  if (res.status === 429) {
    const err = new Error("rate limited");
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`signup falhou (${res.status}): ${res.text.slice(0, 300)}`);
  }
  return session;
}

export function syntheticTenant(i) {
  const n = String(i).padStart(4, "0");
  return {
    email: `loadtest.vu${n}@example.com`,
    password: `Loadtest!${n}aB`,
    name: `VU ${n}`,
    companyName: `Loja Carga ${n}`,
  };
}

/**
 * Cria `count` empresas sinteticas, respeitando o rate limit do
 * Better Auth: tenta `concurrency` por vez, com retry+backoff quando
 * leva 429. Isto roda uma vez, fora da janela cronometrada do teste de
 * carga (equivalente ao `setup()` do k6).
 */
export async function rampTenants(baseUrl, count, { concurrency = 2, onProgress } = {}) {
  const sessions = [];
  let i = 0;
  while (i < count) {
    const batch = [];
    for (let b = 0; b < concurrency && i < count; b++, i++) {
      batch.push(createTenantWithRetry(baseUrl, i));
    }
    const settled = await Promise.allSettled(batch);
    for (const r of settled) {
      if (r.status === "fulfilled") sessions.push(r.value);
      else console.error(`[tenant] falhou: ${r.reason?.message ?? r.reason}`);
    }
    onProgress?.(sessions.length, count);
    // Espaco entre lotes pra nao estourar a janela de rate limit de novo.
    if (i < count) await sleep(4000);
  }
  return sessions;
}

async function createTenantWithRetry(baseUrl, index, attempt = 0) {
  const tenant = syntheticTenant(index);
  try {
    const session = await signUpTenant(baseUrl, tenant);
    return { session, tenant };
  } catch (err) {
    if (err.retryable && attempt < 4) {
      await sleep(3000 * (attempt + 1));
      return createTenantWithRetry(baseUrl, index, attempt + 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
