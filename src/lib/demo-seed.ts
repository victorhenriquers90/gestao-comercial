import type { DbSource } from "./db";

/**
 * Dados de demonstracao so onde nao ha loja de verdade.
 *
 * Antes toda empresa nova era semeada -- inclusive a do dono numa
 * instalacao real, que ja nascia com ~50 vendas, recebiveis, comissoes e
 * caixa ficticios misturados aos numeros de verdade, sem como separar.
 *
 * Padrao: semeia no preview local (PGLite, sem DATABASE_URL) e nao semeia
 * com Postgres configurado. GC_DEMO_SEED=1 liga e =0 desliga, nos dois.
 */
export function demoSeedEnabled(source: DbSource, flag: string | undefined): boolean {
  const f = flag?.trim();
  if (f === "1") return true;
  if (f === "0") return false;
  return source === "pglite";
}
