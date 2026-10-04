export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;
const MAX_OFFSET = 1_000_000;

function wholeNumber(v: unknown, message: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(message);
  return Math.trunc(v);
}

/**
 * Janela de uma listagem paginada. Valor ausente cai no padrão; fora da faixa
 * é recortado (uma tela que pede 5000 linhas recebe o máximo, não derruba o
 * servidor); lixo (NaN, texto) é recusado em vez de virar `limit NaN` no SQL.
 */
export function parsePaging(
  input: { limit?: unknown; offset?: unknown },
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { limit: number; offset: number } {
  const max = opts.maxLimit ?? MAX_PAGE_SIZE;
  const def = Math.min(opts.defaultLimit ?? DEFAULT_PAGE_SIZE, max);
  const limit = input.limit == null ? def : Math.min(Math.max(wholeNumber(input.limit, "Limite inválido."), 1), max);
  const offset = input.offset == null ? 0 : Math.min(Math.max(wholeNumber(input.offset, "Posição inválida."), 0), MAX_OFFSET);
  return { limit, offset };
}

/** "1–100 de 250" — vazio quando a lista está vazia. */
export function pageRangeLabel(offset: number, shown: number, total: number): string {
  if (total <= 0 || shown <= 0) return "";
  return `${offset + 1}–${offset + shown} de ${total}`;
}
