/**
 * Troca de turno.
 *
 * O caixa e por LOJA, nao por operador: se duas pessoas passam pelo balcao
 * no mesmo dia, um unico fechamento junta as duas e a diferenca perde o
 * dono. Falta de R$ 40 num turno tem hora e responsavel; a mesma falta
 * dividida entre duas pessoas que nunca conferiram nada entre si nao tem.
 *
 * A TROCA NAO ABRE O TURNO SEGUINTE
 *
 * Seria comodo: um botao "passar o turno" que fecha o de quem sai e ja abre
 * o de quem entra, escolhido numa lista. Mas isso gravaria que B e
 * responsavel por um turno em que B nunca se autenticou -- e se esse turno
 * fechar com falta, o sistema acusaria B por causa de um clique de A. Isso e
 * pior do que nao separar turno nenhum: fabrica responsabilidade falsa.
 *
 * Entao a troca tem dois lados, cada um no seu login:
 *
 *   quem SAI  conta a gaveta as cegas, fecha o turno, e declara quanto FICA
 *             na gaveta pro proximo (o resto vai pro cofre);
 *   quem ENTRA conta a gaveta que esta recebendo -- tambem as cegas -- e so
 *             depois ve quanto o turno anterior disse ter deixado.
 *
 * A segunda contagem e o que faz a troca valer. Se quem entra apenas aceita
 * o numero de quem sai, herda o erro do outro e a diferenca volta a nao ter
 * dono -- que e exatamente o problema que a troca existe pra resolver. E o
 * momento de descobrir um desencontro e agora, com as duas pessoas na frente
 * da gaveta, nao no fim do turno seguinte.
 *
 * LIMITE HONESTO: nada disto funciona se os dois operadores usam o mesmo
 * login. Ai nao existe desenho que produza responsabilidade -- existe uma
 * conta por pessoa, ou nao existe rastro.
 */

import { CASH_DIFFERENCE_TOLERANCE } from "./cash-count.ts";

/**
 * Quanto fica na gaveta pro proximo turno.
 *
 * Nunca mais do que foi contado: deixar R$ 500 numa gaveta em que se contou
 * R$ 350 inventaria dinheiro na virada, e o turno seguinte comecaria com uma
 * sobra que nao veio de venda nenhuma.
 */
export function parseHandoverAmount(raw: unknown, counted: number): number {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("Valor da troca de turno inválido.");
  const c = Number(counted);
  if (Number.isFinite(c) && n > c + 0.005) {
    throw new Error("Não dá para deixar na gaveta mais do que foi contado.");
  }
  return round2(n);
}

/** O que sai da gaveta no fechamento e vai pro cofre/banco. */
export function safeAmount(counted: number, handover: number): number {
  const c = Number.isFinite(Number(counted)) ? Number(counted) : 0;
  const h = Number.isFinite(Number(handover)) ? Number(handover) : 0;
  return round2(Math.max(0, c - h));
}

export type HandoverKind = "confere" | "falta" | "sobra";

export const HANDOVER_LABELS: Record<HandoverKind, string> = {
  confere: "Confere",
  falta: "Falta na troca",
  sobra: "Sobra na troca",
};

export type HandoverCheck = {
  /** Quanto o turno anterior declarou ter deixado. */
  deixado: number;
  /** Quanto quem entrou contou de verdade. */
  recebido: number;
  diferenca: number;
  kind: HandoverKind;
  dentroDaTolerancia: boolean;
};

/**
 * Compara o que o turno anterior disse ter deixado com o que o proximo
 * contou.
 *
 * Esta diferenca e de outra natureza que a do fechamento: nao e "o sistema
 * contra a gaveta", e "uma pessoa contra outra", sobre o MESMO dinheiro, com
 * as duas presentes. Por isso ela nao entra no calculo de nenhum dos dois
 * turnos -- e um fato da virada, e some se for tratada como erro de um lado
 * so.
 */
export function checkHandover(deixado: number, recebido: number): HandoverCheck {
  const d = round2(Number(deixado) || 0);
  const r = round2(Number(recebido) || 0);
  const diferenca = round2(r - d);
  return {
    deixado: d,
    recebido: r,
    diferenca,
    kind: diferenca < 0 ? "falta" : diferenca > 0 ? "sobra" : "confere",
    dentroDaTolerancia: Math.abs(diferenca) <= CASH_DIFFERENCE_TOLERANCE,
  };
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
