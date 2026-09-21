import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeBreaks, totalBreaks, type ShiftBreak } from "./cash-break.ts";

const turno = (o: Partial<ShiftBreak> & { operador: string; diff: number }): ShiftBreak => ({
  explicada: true,
  cego: true,
  fechadoPeloDono: true,
  movimento: 1000,
  ...o,
});

describe("summarizeBreaks", () => {
  it("erro nao cancela erro", () => {
    // O ponto do relatorio inteiro. Somando com sinal, A e B ficam iguais em
    // zero -- e A errou R$ 40 duas vezes enquanto B fechou certo duas vezes.
    // "Tira numa noite, devolve na outra" produz exatamente a soma zero de A.
    const [a, b] = summarizeBreaks([
      turno({ operador: "A", diff: -40 }),
      turno({ operador: "A", diff: 40 }),
      turno({ operador: "B", diff: 0 }),
      turno({ operador: "B", diff: 0 }),
    ]);
    assert.equal(a!.operador, "A");
    assert.equal(a!.liquido, 0);
    assert.equal(a!.desvio, 80);
    assert.equal(b!.desvio, 0);
    assert.equal(b!.liquido, 0);
  });

  it("separa o que faltou do que sobrou", () => {
    const [a] = summarizeBreaks([
      turno({ operador: "A", diff: -40 }),
      turno({ operador: "A", diff: 25 }),
    ]);
    assert.equal(a!.faltas, 40);
    assert.equal(a!.sobras, 25);
    assert.equal(a!.liquido, -15);
  });

  it("quem trabalha mais nao vira o pior do ranking por isso", () => {
    // Sem o desvio por turno, dez turnos de R$ 2 pareceriam pior que um de
    // R$ 18 -- e o ranking passaria a punir quem esta no balcao todo dia.
    const linhas = summarizeBreaks(
      [
        ...Array.from({ length: 10 }, () => turno({ operador: "Maria", diff: -2.5 })),
        turno({ operador: "João", diff: -18 }),
      ],
      2,
    );
    const maria = linhas.find((l) => l.operador === "Maria")!;
    const joao = linhas.find((l) => l.operador === "João")!;
    assert.equal(maria.desvio, 25);
    assert.equal(joao.desvio, 18);
    assert.equal(maria.desvioPorTurno, 2.5);
    assert.equal(joao.desvioPorTurno, 18);
  });

  it("percentual usa o total movimentado, nao a media das porcentagens", () => {
    // Turno de R$ 80 com R$ 8 de desvio (10%) e turno de R$ 8.000 com R$ 8
    // (0,1%). A media das porcentagens daria 5,05%; a conta certa e
    // 16 / 8080 = 0,2%.
    const [a] = summarizeBreaks([
      turno({ operador: "A", diff: -8, movimento: 80 }),
      turno({ operador: "A", diff: -8, movimento: 8000 }),
    ]);
    assert.equal(a!.desvioPct, 0.2);
  });

  it("um pico nao desaparece na media", () => {
    const [a] = summarizeBreaks([
      turno({ operador: "A", diff: -200 }),
      ...Array.from({ length: 9 }, () => turno({ operador: "A", diff: 0 })),
    ]);
    assert.equal(a!.maiorFalta, 200);
    assert.equal(a!.desvioPorTurno, 20);
  });

  it("sobra nao entra como maior falta", () => {
    const [a] = summarizeBreaks([
      turno({ operador: "A", diff: 500 }),
      turno({ operador: "A", diff: -30 }),
    ]);
    assert.equal(a!.maiorFalta, 30);
  });

  it("diferenca dentro da tolerancia nao conta como ocorrencia, mas conta no desvio", () => {
    // Nao vira "turno com diferenca" (seria ruido), e mesmo assim entra no
    // desvio: e erro de verdade, so pequeno. Zerar seria maquiar.
    const [a] = summarizeBreaks([turno({ operador: "A", diff: -1.5 })], 2);
    assert.equal(a!.comDiferenca, 0);
    assert.equal(a!.desvio, 1.5);
  });

  it("conta o que enfraquece o proprio numero", () => {
    const [a] = summarizeBreaks([
      turno({ operador: "A", diff: -50, explicada: false }),
      turno({ operador: "A", diff: -50, cego: false }),
      turno({ operador: "A", diff: -50, fechadoPeloDono: false }),
    ]);
    assert.equal(a!.semExplicar, 1);
    assert.equal(a!.naoCegos, 1);
    assert.equal(a!.fechadosPorOutro, 1);
  });

  it("ordena por desvio, nao por nome", () => {
    const linhas = summarizeBreaks([
      turno({ operador: "Ana", diff: -5 }),
      turno({ operador: "Zeca", diff: -90 }),
    ]);
    assert.deepEqual(
      linhas.map((l) => l.operador),
      ["Zeca", "Ana"],
    );
  });

  it("turno sem dono nao some da conta", () => {
    const [a] = summarizeBreaks([turno({ operador: "", diff: -10 })]);
    assert.equal(a!.operador, "Sem operador");
    assert.equal(a!.desvio, 10);
  });

  it("diferenca ilegivel conta como zero em vez de contaminar o operador inteiro", () => {
    const [a] = summarizeBreaks([
      turno({ operador: "A", diff: Number.NaN }),
      turno({ operador: "A", diff: -30 }),
    ]);
    assert.equal(a!.desvio, 30);
    assert.equal(a!.turnos, 2);
  });
});

describe("totalBreaks", () => {
  it("soma o desvio, que e o total de erro -- nao o liquido", () => {
    const t = totalBreaks(
      summarizeBreaks([
        turno({ operador: "A", diff: -40 }),
        turno({ operador: "B", diff: 40 }),
      ]),
    );
    assert.equal(t.desvio, 80);
    assert.equal(t.liquido, 0);
    assert.equal(t.faltas, 40);
    assert.equal(t.sobras, 40);
    assert.equal(t.turnos, 2);
  });

  it("periodo sem turno nenhum nao quebra", () => {
    const t = totalBreaks([]);
    assert.equal(t.turnos, 0);
    assert.equal(t.desvio, 0);
  });
});
