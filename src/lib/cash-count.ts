/**
 * Fechamento de caixa com conferencia CEGA.
 *
 * Ate aqui a tela do caixa mostrava "Dinheiro esperado" o turno inteiro, e o
 * campo da contagem ficava logo abaixo. Isso nao e conferencia: e transcricao.
 * Quem conta ja sabe a resposta antes de abrir a gaveta -- e as duas coisas
 * que a conferencia existe pra pegar deixam de aparecer:
 *
 *   1. ERRO. Ancorado no numero, o operador conta ate "dar certo" e para.
 *      Uma falta de R$ 40 vira "devo ter contado errado" e some.
 *   2. DESVIO. Vendo que sobram R$ 50 na gaveta, basta informar o esperado e
 *      levar a sobra. O fechamento fecha perfeito, todo dia.
 *
 * A trava de verdade nao e esconder o numero -- quem quiser somar as vendas
 * do dia consegue. A trava e a ORDEM: a contagem e registrada e fica
 * imutavel ANTES de o sistema revelar o esperado. Ajustar pra bater deixa de
 * ser um passo e passa a ser uma mentira assinada, com hora e autor.
 *
 * Esconder o numero da tela continua valendo: tira a ancora de quem esta
 * contando de boa-fe, que e a maioria absoluta dos fechamentos.
 */

export type Denomination = {
  /** Valor em CENTAVOS. Contagem de dinheiro em float nao fecha. */
  cents: number;
  label: string;
  kind: "nota" | "moeda";
};

/**
 * Cedulas e moedas do real em circulacao.
 *
 * A de R$ 200 e rara e a de R$ 0,01 praticamente sumiu, mas ficha de
 * contagem que nao representa a gaveta e ficha quebrada: na hora que
 * aparecer, o operador nao vai ter onde lancar e vai "arredondar".
 */
export const CASH_DENOMINATIONS: Denomination[] = [
  { cents: 20000, label: "R$ 200", kind: "nota" },
  { cents: 10000, label: "R$ 100", kind: "nota" },
  { cents: 5000, label: "R$ 50", kind: "nota" },
  { cents: 2000, label: "R$ 20", kind: "nota" },
  { cents: 1000, label: "R$ 10", kind: "nota" },
  { cents: 500, label: "R$ 5", kind: "nota" },
  { cents: 200, label: "R$ 2", kind: "nota" },
  { cents: 100, label: "R$ 1", kind: "moeda" },
  { cents: 50, label: "R$ 0,50", kind: "moeda" },
  { cents: 25, label: "R$ 0,25", kind: "moeda" },
  { cents: 10, label: "R$ 0,10", kind: "moeda" },
  { cents: 5, label: "R$ 0,05", kind: "moeda" },
  { cents: 1, label: "R$ 0,01", kind: "moeda" },
];

const VALID_KEYS = new Set(CASH_DENOMINATIONS.map((d) => String(d.cents)));

/** Mapa {centavos: quantidade}. A chave e o valor em centavos, como texto. */
export type CashBreakdown = Record<string, number>;

/**
 * Quantidade de uma cedula. Retorna NaN quando nao da pra contar.
 *
 * Campo vazio e 0 de proposito -- a ficha comeca toda vazia e obrigar a
 * digitar treze zeros e o caminho mais curto pra ninguem usar a ficha.
 */
export function parseQty(raw: unknown): number {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (!/^\d{1,6}$/.test(s)) return Number.NaN;
  return Number(s);
}

/**
 * Soma tolerante, pra o total ao vivo enquanto se digita: o que ainda nao da
 * pra ler conta como zero em vez de contaminar o total inteiro com NaN.
 */
export function breakdownTotal(raw: Record<string, unknown> | null | undefined): number {
  if (!raw) return 0;
  let cents = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!VALID_KEYS.has(key)) continue;
    const qty = parseQty(value);
    if (!Number.isFinite(qty)) continue;
    cents += Number(key) * qty;
  }
  return cents / 100;
}

/**
 * Versao estrita, pro servidor. Recusa o que a soma tolerante engoliria.
 *
 * Chave desconhecida e recusada em vez de ignorada: {"99999": 1} vindo de
 * um cliente adulterado inflaria o contado sem aparecer em cedula nenhuma
 * na ficha impressa -- a divergencia sumiria com aparencia de conferida.
 */
export function normalizeBreakdown(raw: unknown): CashBreakdown | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Contagem por cédula inválida.");
  const out: CashBreakdown = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_KEYS.has(key)) throw new Error("Contagem por cédula inválida.");
    const qty = parseQty(value);
    if (!Number.isFinite(qty)) {
      const d = CASH_DENOMINATIONS.find((x) => String(x.cents) === key);
      throw new Error(`Quantidade inválida em ${d?.label ?? key}.`);
    }
    if (qty > 0) out[key] = qty;
  }
  return Object.keys(out).length ? out : null;
}

/** Total exato do mapa ja normalizado (soma em centavos, sem float). */
export function breakdownExactTotal(map: CashBreakdown | null): number {
  if (!map) return 0;
  let cents = 0;
  for (const [key, qty] of Object.entries(map)) cents += Number(key) * qty;
  return cents / 100;
}

/**
 * Acima disto a diferenca deixa de ser troco e vira quebra de caixa: precisa
 * de explicacao escrita antes de virar estatistica.
 *
 * R$ 2,00 e o patamar em que erro de troco de uma venda ainda cabe. Se a
 * loja quiser outro numero, e aqui -- de proposito num lugar so, e nao numa
 * configuracao por loja: tolerancia que cada um ajusta deixa de ser
 * tolerancia.
 */
export const CASH_DIFFERENCE_TOLERANCE = 2;

export type DifferenceKind = "exato" | "sobra" | "falta";

export const DIFFERENCE_LABELS: Record<DifferenceKind, string> = {
  exato: "Bateu certo",
  sobra: "Sobra",
  falta: "Falta",
};

/**
 * Falta e sobra nao sao a mesma coisa, e por isso tem nome separado.
 *
 * Falta e dinheiro que nao esta na gaveta. Sobra quase sempre e venda que
 * nao foi registrada (ou troco a menos pro cliente) -- nao e "lucro", e um
 * buraco no registro apontando pro outro lado. Chamar as duas de
 * "diferenca" apaga essa distincao justo pra quem vai ler o relatorio.
 */
export function classifyDifference(
  diff: number,
  tolerance: number = CASH_DIFFERENCE_TOLERANCE,
): { kind: DifferenceKind; dentroDaTolerancia: boolean } {
  const d = Number.isFinite(Number(diff)) ? round2(Number(diff)) : 0;
  const kind: DifferenceKind = d > 0 ? "sobra" : d < 0 ? "falta" : "exato";
  return { kind, dentroDaTolerancia: Math.abs(d) <= Math.abs(tolerance) };
}

export function needsExplanation(
  diff: number,
  tolerance: number = CASH_DIFFERENCE_TOLERANCE,
): boolean {
  return !classifyDifference(diff, tolerance).dentroDaTolerancia;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
