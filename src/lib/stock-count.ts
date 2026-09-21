/**
 * Inventario (contagem fisica): regras puras.
 *
 * A decisao central esta na migration 0024 e vale repetir aqui, porque e o
 * que separa um inventario que funciona de um que apaga venda: ao aplicar,
 * lanca-se a DIFERENCA encontrada na contagem, nao o contado como saldo
 * absoluto. Com o absoluto, qualquer venda feita entre contar e aplicar e
 * desfeita; com a diferenca, a loja pode continuar vendendo enquanto conta.
 */

export const STOCK_COUNT_STATUSES = ["aberto", "aplicado", "cancelado"] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  aberto: "Em contagem",
  aplicado: "Aplicado",
  cancelado: "Cancelado",
};

export function isStockCountStatus(v: unknown): v is StockCountStatus {
  return typeof v === "string" && (STOCK_COUNT_STATUSES as readonly string[]).includes(v);
}

export type CountLine = {
  variantId: number;
  expected: number;
  counted: number;
};

export type CountLineResult = CountLine & {
  /** counted - expected. Negativo = falta na prateleira. */
  diff: number;
};

/** Quantidade contada: finita, nao negativa. Zero e legitimo (acabou). */
export function parseCountedQuantity(value: unknown, label = "quantidade contada"): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Informe uma ${label} válida (zero ou mais).`);
  }
  // Tres casas: a mesma precisao da coluna, pra peso/metro alem de peca.
  return Math.round(n * 1000) / 1000;
}

export function lineDiff(line: CountLine): CountLineResult {
  return { ...line, diff: round3(line.counted - line.expected) };
}

export type CountSummary = {
  /** Quantas pecas distintas foram contadas. */
  items: number;
  /** Itens cujo contado difere do esperado. */
  divergentes: number;
  /** Soma das diferencas positivas (sobra na prateleira). */
  sobras: number;
  /** Soma das diferencas negativas, em modulo (falta na prateleira). */
  faltas: number;
  /** Diferenca liquida. */
  liquido: number;
};

export function summarize(lines: CountLine[]): CountSummary {
  let sobras = 0;
  let faltas = 0;
  let divergentes = 0;
  for (const l of lines) {
    const d = round3(l.counted - l.expected);
    if (d === 0) continue;
    divergentes++;
    if (d > 0) sobras = round3(sobras + d);
    else faltas = round3(faltas + -d);
  }
  return {
    items: lines.length,
    divergentes,
    sobras,
    faltas,
    liquido: round3(sobras - faltas),
  };
}

/**
 * Valor financeiro da divergencia, pelo CUSTO.
 *
 * Pelo custo e nao pelo preco de venda: falta de estoque e perda do que a
 * loja pagou, nao da margem que ela deixou de ganhar -- contar pelo preco
 * inflaria o prejuizo e nao bate com nenhuma conta do financeiro.
 */
export function divergenceValue(lines: (CountLine & { cost: number })[]): number {
  let total = 0;
  for (const l of lines) {
    total += round3(l.counted - l.expected) * (Number(l.cost) || 0);
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}
