#!/usr/bin/env node
/**
 * Fase 3 -- teste de carga real (ver HANDOFF.md / plano
 * stateless-chasing-stallman.md). Roda contra o deployment de Preview
 * da branch loadtest/fase3 (nunca produção) -- ver loadtest/README.md
 * pro setup da branch Neon descartável.
 *
 * v1: só rotas de página (GET /app/...), não as server functions com
 * path com hash (POST /_serverFn/<hash>) -- a navegação de página já
 * exercita o SSR inteiro (requireTenant + RLS em todas as tabelas que
 * aquela página lê), sem precisar descobrir o hash de cada função pra
 * este build específico. Checkout/search ficam de fora por ora (ver
 * README).
 *
 * Uso:
 *   node loadtest/run.mjs --base-url https://<preview>.vercel.app --tenants 12
 */
import { loadLocalEnv } from "./lib/env.mjs";
import { rampTenants } from "./lib/tenant.mjs";
import { request } from "./lib/http.mjs";
import { summarize, fmtMs } from "./lib/percentiles.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"] ?? process.env.LOADTEST_BASE_URL;
if (!baseUrl) {
  console.error("Uso: node loadtest/run.mjs --base-url https://<preview>.vercel.app [--tenants 12] [--stages 5,20,40] [--stage-seconds 30]");
  process.exit(1);
}
const tenantCount = Number(args.tenants ?? 12);
const stages = (args.stages ?? "5,20,40").split(",").map(Number);
const stageSeconds = Number(args["stage-seconds"] ?? 30);

const PAGE_SCENARIOS = [
  "/app",
  "/app/vendas",
  "/app/estoque",
  "/app/financeiro",
  "/app/clientes",
];

console.log(`[setup] criando ${tenantCount} empresas sinteticas em ${baseUrl} ...`);
const tenants = await rampTenants(baseUrl, tenantCount, {
  concurrency: 2,
  onProgress: (done, total) => console.log(`[setup] ${done}/${total} empresas prontas`),
});
if (tenants.length === 0) {
  console.error("[setup] nenhuma empresa criada -- abortando.");
  process.exit(1);
}
console.log(`[setup] ${tenants.length}/${tenantCount} empresas prontas. Iniciando carga.\n`);

const results = [];
let errors = 0;
let stopped = false;

for (const vus of stages) {
  console.log(`[carga] estagio: ${vus} VUs por ${stageSeconds}s`);
  const stageEnd = Date.now() + stageSeconds * 1000;
  const workers = Array.from({ length: vus }, (_, i) => runVirtualUser(i, stageEnd));
  await Promise.all(workers);
  if (stopped) break;
}

const stageLatencies = results.map((r) => r.ms);
const summary = summarize(stageLatencies);
console.log("\n=== Resumo ===");
console.log(`requisicoes: ${summary.n}  erros: ${errors} (${((errors / (summary.n + errors || 1)) * 100).toFixed(1)}%)`);
console.log(`p50 ${fmtMs(summary.p50)}  p95 ${fmtMs(summary.p95)}  p99 ${fmtMs(summary.p99)}  max ${fmtMs(summary.max)}`);

const byPath = new Map();
for (const r of results) {
  if (!byPath.has(r.path)) byPath.set(r.path, []);
  byPath.get(r.path).push(r.ms);
}
console.log("\npor rota:");
for (const [path, latencies] of byPath) {
  const s = summarize(latencies);
  console.log(`  ${path.padEnd(18)} n=${String(s.n).padEnd(5)} p50=${fmtMs(s.p50).padEnd(7)} p95=${fmtMs(s.p95).padEnd(7)} p99=${fmtMs(s.p99)}`);
}

async function runVirtualUser(workerIndex, stageEnd) {
  const { session } = tenants[workerIndex % tenants.length];
  while (Date.now() < stageEnd) {
    const path = PAGE_SCENARIOS[Math.floor(Math.random() * PAGE_SCENARIOS.length)];
    const res = await request(session, baseUrl, path, { method: "GET" });
    if (res.blockedByProtection) {
      console.error("[carga] bloqueado pelo Vercel Deployment Protection -- abortando.");
      stopped = true;
      return;
    }
    if (!res.ok) errors += 1;
    results.push({ path, ms: res.ms, status: res.status });
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}
