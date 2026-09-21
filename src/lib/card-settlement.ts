/**
 * Conciliacao de cartao: dar baixa no que a adquirente depositou.
 *
 * A venda no cartao gera recebivel com a data em que o dinheiro cai. Faltava
 * o outro lado: quando cai de verdade, alguem precisa marcar como recebido.
 * Sem isso os recebiveis de cartao se acumulam como "a receber" pra sempre e
 * inflam o saldo financeiro -- o sistema passaria a mentir pro outro lado do
 * que mentia antes (antes tratava cartao como dinheiro na hora; sem baixa,
 * trataria como dinheiro que nunca chega).
 *
 * A conciliacao e por DATA DE LIQUIDACAO, nao por venda: o extrato traz um
 * deposito por dia, juntando dezenas de vendas. Conferir venda a venda
 * contra um deposito unico e trabalho que ninguem faz.
 */

export type BatchStatus = "a_receber" | "hoje" | "atrasado";

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  a_receber: "A receber",
  hoje: "Cai hoje",
  atrasado: "Não caiu",
};

export function batchStatus(dueDate: string, today: string): BatchStatus {
  const d = String(dueDate).slice(0, 10);
  const t = String(today).slice(0, 10);
  if (d > t) return "a_receber";
  if (d === t) return "hoje";
  return "atrasado";
}

export type Divergence = {
  esperado: number;
  informado: number;
  diferenca: number;
  /** Acima disto a diferenca deixa de ser arredondamento. */
  relevante: boolean;
};

/**
 * Compara o que o sistema espera com o que caiu na conta.
 *
 * NAO decide o que fazer com a diferenca de proposito. A causa quase sempre
 * e taxa diferente da cadastrada, antecipacao ou estorno -- e cada uma tem
 * um destino contabil diferente. Um sistema que "ajusta sozinho" esconde
 * justamente a informacao que a conciliacao existe pra revelar: que a taxa
 * cadastrada nao e a taxa cobrada.
 */
export function compareDeposit(esperado: number, informado: number): Divergence {
  const e = round2(Number(esperado) || 0);
  const i = round2(Number(informado) || 0);
  const diferenca = round2(i - e);
  return { esperado: e, informado: i, diferenca, relevante: Math.abs(diferenca) > 0.05 };
}

/** Taxa efetiva que a diferenca revela, em % sobre o bruto do lote. */
export function effectiveFeePct(bruto: number, liquidoRecebido: number): number | null {
  const b = Number(bruto) || 0;
  if (b <= 0) return null;
  const pct = ((b - (Number(liquidoRecebido) || 0)) / b) * 100;
  return Math.round(pct * 100) / 100;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
