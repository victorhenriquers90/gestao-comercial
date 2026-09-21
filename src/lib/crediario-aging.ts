/**
 * Cobranca do crediario: quem deve, quanto, e ha quanto tempo.
 *
 * As parcelas ja nasciam certas, mas ficavam esperando alguem abrir o
 * Financeiro e reparar no vencimento. Crediario e dinheiro que a loja
 * EMPRESTOU -- sem uma lista de cobranca, a unica defesa e a memoria do
 * lojista.
 *
 * O que transforma isso em ferramenta de trabalho e o envelhecimento: uma
 * lista que so diz "R$ 3.000 em aberto" nao ajuda a decidir nada. Saber que
 * R$ 200 vencem amanha e R$ 800 estao ha mais de 60 dias diz exatamente
 * para quem ligar primeiro -- e quanto ja virou problema, nao atraso.
 */

export const AGING_BUCKETS = ["a_vencer", "hoje", "ate_30", "ate_60", "acima_60"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  a_vencer: "A vencer",
  hoje: "Vence hoje",
  ate_30: "Até 30 dias",
  ate_60: "31 a 60 dias",
  acima_60: "Mais de 60 dias",
};

/**
 * Em qual faixa a parcela cai.
 *
 * "Vence hoje" tem faixa propria de proposito: e o unico dia em que um
 * telefonema ainda evita o atraso, em vez de cobrar um atraso que ja
 * aconteceu.
 */
export function bucketFor(dueDate: string, today: string): AgingBucket {
  const dias = daysBetween(dueDate, today);
  if (dias < 0) return "a_vencer";
  if (dias === 0) return "hoje";
  if (dias <= 30) return "ate_30";
  if (dias <= 60) return "ate_60";
  return "acima_60";
}

/** Dias de atraso. Negativo quando ainda vai vencer. */
export function daysBetween(dueDate: string, today: string): number {
  const a = Date.parse(`${String(dueDate).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export type OpenInstallment = {
  id: number;
  dueDate: string;
  /** Quanto ainda falta receber desta parcela. */
  open: number;
};

export type CustomerDebt = {
  total: number;
  vencido: number;
  aVencer: number;
  /** Vencimento mais antigo em aberto -- e por ele que se prioriza. */
  maisAntigo: string | null;
  /** Dias de atraso do mais antigo. Zero ou negativo = em dia. */
  diasAtraso: number;
  porFaixa: Record<AgingBucket, number>;
  parcelas: number;
};

export function summarizeDebt(parcelas: OpenInstallment[], today: string): CustomerDebt {
  const porFaixa: Record<AgingBucket, number> = {
    a_vencer: 0,
    hoje: 0,
    ate_30: 0,
    ate_60: 0,
    acima_60: 0,
  };
  let total = 0;
  let vencido = 0;
  let aVencer = 0;
  let maisAntigo: string | null = null;

  for (const p of parcelas) {
    const aberto = round2(Number(p.open) || 0);
    if (aberto <= 0) continue;
    const faixa = bucketFor(p.dueDate, today);
    porFaixa[faixa] = round2(porFaixa[faixa] + aberto);
    total = round2(total + aberto);
    // "Vence hoje" conta como A VENCER no dinheiro: o cliente ainda tem o
    // dia todo pra pagar. So aparece destacado na faixa propria.
    if (faixa === "a_vencer" || faixa === "hoje") aVencer = round2(aVencer + aberto);
    else vencido = round2(vencido + aberto);
    if (maisAntigo == null || p.dueDate < maisAntigo) maisAntigo = p.dueDate;
  }

  return {
    total,
    vencido,
    aVencer,
    maisAntigo,
    diasAtraso: maisAntigo ? Math.max(0, daysBetween(maisAntigo, today)) : 0,
    porFaixa,
    parcelas: parcelas.filter((p) => (Number(p.open) || 0) > 0).length,
  };
}

/**
 * Ordem de cobranca: quem esta ha mais tempo devendo vem primeiro, e entre
 * atrasos iguais, quem deve mais.
 *
 * Nao e ordem alfabetica nem por valor puro: o que decide a ligacao e ha
 * QUANTO TEMPO o dinheiro esta fora, porque divida velha e a que menos
 * volta.
 */
export function collectionOrder(a: CustomerDebt, b: CustomerDebt): number {
  if (a.diasAtraso !== b.diasAtraso) return b.diasAtraso - a.diasAtraso;
  return b.total - a.total;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
