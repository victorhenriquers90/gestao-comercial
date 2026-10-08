/**
 * Divisao de um valor em parcelas com vencimento.
 *
 * Uma regra de arredondamento so, usada pelo cartao (repasse da adquirente)
 * e pelo crediario (fiado da loja). Duas implementacoes separadas iam
 * divergir no centavo, e "por que a soma das parcelas nao bate com a venda"
 * e o tipo de pergunta que ninguem consegue responder seis meses depois.
 */

import { ymdLocal } from "./local-date.ts";

export type Installment = {
  /** 1, 2, 3... */
  number: number;
  amount: number;
  /** ISO curto, YYYY-MM-DD. */
  dueDate: string;
};

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function addDays(from: Date, days: number): string {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  // Local, nao toISOString: venda as 22h vencia um dia depois.
  return ymdLocal(d);
}

/**
 * Quebra `total` em `count` parcelas.
 *
 * A soma das parcelas fecha EXATAMENTE com o total: a sobra dos
 * arredondamentos vai toda na PRIMEIRA, nao espalhada. Espalhar centavo por
 * centavo faria a conferencia (contra o extrato da adquirente, ou contra o
 * carne do cliente) virar cacada ao centavo; concentrar deixa N-1 parcelas
 * redondas e uma unica diferente, que e facil de explicar no balcao.
 */
export function splitInstallments(args: {
  total: number;
  count: number;
  /** Dias ate a PRIMEIRA parcela. */
  firstDueInDays: number;
  /** Intervalo entre as seguintes. 30 = mensal. */
  stepDays?: number;
  from: Date;
}): Installment[] {
  const parcelas = Math.max(1, Math.trunc(args.count));
  const total = round2(args.total);
  const passo = args.stepDays ?? 30;

  let base = round2(total / parcelas);
  let somaDemais = 0;
  for (let i = 2; i <= parcelas; i++) somaDemais = round2(somaDemais + base);

  /*
    `base` arredonda pro centavo mais proximo -- pra cima, na metade dos
    casos. Com total bem pequeno (nada impede, mesmo sem fazer sentido no
    balcao) e muitas parcelas, essa sobra de arredondamento multiplicada
    por (parcelas-1) passa do total, e a primeira parcela (que absorve a
    diferenca) saia NEGATIVA -- ex.: R$0,07 em 12x: base arredondava pra
    R$0,01, 11 parcelas somavam R$0,11, e a primeira saia em -R$0,04.
    Só nesse caso (que o calculo normal já teria detectado como negativo)
    troca pra arredondar as demais SEMPRE pra baixo: `(parcelas-1) * base`
    fica estritamente menor que o total, entao a primeira nunca fica
    negativa. Não mexe no caso comum -- só entra quando ele já ia quebrar.
  */
  if (parcelas > 1 && round2(total - somaDemais) < 0) {
    base = Math.floor((total / parcelas) * 100) / 100;
    somaDemais = 0;
    for (let i = 2; i <= parcelas; i++) somaDemais = round2(somaDemais + base);
  }

  const linhas: Installment[] = [];
  for (let i = 1; i <= parcelas; i++) {
    linhas.push({
      number: i,
      amount: i === 1 ? round2(total - somaDemais) : base,
      dueDate: addDays(args.from, args.firstDueInDays + passo * (i - 1)),
    });
  }
  return linhas;
}
