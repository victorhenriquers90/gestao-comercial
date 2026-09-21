/**
 * Quebra de caixa por operador.
 *
 * Agora que cada turno tem contagem cega, dono e hora, da pra fazer a
 * pergunta que um fechamento isolado nunca responde: isso foi um dia ruim ou
 * e um padrao? Uma falta de R$ 20 nao diz nada. Tres faltas de R$ 20 na
 * mesma pessoa, no mesmo turno da semana, dizem tudo.
 *
 * O ERRO QUE ESTE MODULO EXISTE PRA NAO COMETER
 *
 * Somar `difference_amount` e mostrar o resultado seria o caminho obvio -- e
 * apagaria justamente quem se quer enxergar:
 *
 *   operador A:  -40, +40   -> soma 0
 *   operador B:    0,   0   -> soma 0
 *
 * Os dois aparecem iguais, e nao sao. B fechou certo duas vezes. A errou
 * duas vezes em R$ 40 e as duas se cancelaram no papel. Pior: "tira numa
 * noite, devolve na outra" produz exatamente a soma zero de A.
 *
 * Por isso o numero principal e o DESVIO ABSOLUTO (soma de |diferenca|), que
 * nao deixa erro cancelar erro. O liquido continua na tabela, ao lado, com
 * outro nome -- ele serve pra ver quanto dinheiro de fato faltou no caixa,
 * que e outra pergunta, nao a mesma.
 *
 * COMPARACAO JUSTA
 *
 * Quem trabalhou 20 turnos erra mais, em valor absoluto, que quem trabalhou
 * 3. Por isso existe o desvio POR TURNO: sem ele, o ranking premia quem
 * trabalha pouco.
 *
 * A QUEM O TURNO PERTENCE
 *
 * Ao operador que ABRIU, nao a quem fechou: a diferenca nasce do trabalho do
 * turno (troco errado, venda lancada no meio errado), nao do ato de contar.
 * Quando os dois nao sao a mesma pessoa, a atribuicao fica mais fraca -- e
 * por isso esses turnos sao contados a parte, em vez de silenciosamente
 * somados como se nada fosse.
 */

import { CASH_DIFFERENCE_TOLERANCE } from "./cash-count.ts";

export type ShiftBreak = {
  /** Quem trabalhou o turno. */
  operador: string;
  diff: number;
  /** A diferenca ja foi explicada por escrito. */
  explicada: boolean;
  /** O esperado nao tinha sido revelado antes da contagem. */
  cego: boolean;
  /** Quem fechou e quem abriu sao a mesma pessoa. */
  fechadoPeloDono: boolean;
  /** Dinheiro esperado do turno -- base pra comparar lojas de porte diferente. */
  movimento: number;
};

export type OperatorBreak = {
  operador: string;
  turnos: number;
  /** Turnos cuja diferenca passou da tolerancia. */
  comDiferenca: number;
  /** Total que FALTOU, em modulo. */
  faltas: number;
  /** Total que SOBROU. */
  sobras: number;
  /** Soma de |diferenca|: o numero que nao deixa erro cancelar erro. */
  desvio: number;
  desvioPorTurno: number;
  /** Desvio sobre o dinheiro que passou pela gaveta, em %. */
  desvioPct: number;
  /** A pior falta isolada -- um pico nao aparece numa media. */
  maiorFalta: number;
  /** Soma com sinal. Quanto dinheiro de fato faltou; NAO mede acerto. */
  liquido: number;
  semExplicar: number;
  /** Fechamentos em que o esperado ja tinha sido revelado: provam menos. */
  naoCegos: number;
  /** Turnos fechados por outra pessoa: a atribuicao vale menos. */
  fechadosPorOutro: number;
};

export function summarizeBreaks(
  shifts: ShiftBreak[],
  tolerance: number = CASH_DIFFERENCE_TOLERANCE,
): OperatorBreak[] {
  const porOperador = new Map<string, OperatorBreak>();
  // Movimento acumula a parte, e so vira % no fim: somar porcentagens turno a
  // turno daria a media das porcentagens, que nao e a porcentagem do total --
  // um turno de R$ 80 com R$ 8 de desvio pesaria igual a um de R$ 8.000.
  const movimentoPor = new Map<string, number>();
  for (const s of shifts) {
    const nome = s.operador || "Sem operador";
    const diff = Number.isFinite(Number(s.diff)) ? round2(Number(s.diff)) : 0;
    const alem = Math.abs(diff) > tolerance;
    const atual =
      porOperador.get(nome) ??
      {
        operador: nome,
        turnos: 0,
        comDiferenca: 0,
        faltas: 0,
        sobras: 0,
        desvio: 0,
        desvioPorTurno: 0,
        desvioPct: 0,
        maiorFalta: 0,
        liquido: 0,
        semExplicar: 0,
        naoCegos: 0,
        fechadosPorOutro: 0,
      };
    atual.turnos += 1;
    atual.desvio = round2(atual.desvio + Math.abs(diff));
    atual.liquido = round2(atual.liquido + diff);
    if (alem) {
      atual.comDiferenca += 1;
      if (diff < 0) atual.faltas = round2(atual.faltas + Math.abs(diff));
      else atual.sobras = round2(atual.sobras + diff);
      if (!s.explicada) atual.semExplicar += 1;
    }
    if (diff < 0 && Math.abs(diff) > atual.maiorFalta) atual.maiorFalta = Math.abs(diff);
    if (!s.cego) atual.naoCegos += 1;
    if (!s.fechadoPeloDono) atual.fechadosPorOutro += 1;
    const mov = Number(s.movimento);
    movimentoPor.set(nome, (movimentoPor.get(nome) ?? 0) + (Number.isFinite(mov) ? mov : 0));
    porOperador.set(nome, atual);
  }

  const linhas = [...porOperador.values()].map((o) => {
    const movimento = movimentoPor.get(o.operador) ?? 0;
    return {
      ...o,
      desvioPorTurno: o.turnos ? round2(o.desvio / o.turnos) : 0,
      desvioPct: movimento > 0 ? round2((o.desvio / movimento) * 100) : 0,
    };
  });

  // Maior desvio primeiro: o relatorio existe pra apontar onde olhar, e
  // ordenar por nome esconderia isso atras do alfabeto.
  return linhas.sort((a, b) => b.desvio - a.desvio || a.operador.localeCompare(b.operador));
}

export type BreakTotals = {
  turnos: number;
  desvio: number;
  faltas: number;
  sobras: number;
  liquido: number;
  semExplicar: number;
  fechadosPorOutro: number;
};

export function totalBreaks(linhas: OperatorBreak[]): BreakTotals {
  return linhas.reduce<BreakTotals>(
    (a, o) => ({
      turnos: a.turnos + o.turnos,
      desvio: round2(a.desvio + o.desvio),
      faltas: round2(a.faltas + o.faltas),
      sobras: round2(a.sobras + o.sobras),
      liquido: round2(a.liquido + o.liquido),
      semExplicar: a.semExplicar + o.semExplicar,
      fechadosPorOutro: a.fechadosPorOutro + o.fechadosPorOutro,
    }),
    { turnos: 0, desvio: 0, faltas: 0, sobras: 0, liquido: 0, semExplicar: 0, fechadosPorOutro: 0 },
  );
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
