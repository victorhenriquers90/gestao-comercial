import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASH_DENOMINATIONS,
  CASH_DIFFERENCE_TOLERANCE,
  breakdownExactTotal,
  breakdownTotal,
  classifyDifference,
  isRegisterStale,
  needsExplanation,
  normalizeBreakdown,
  parseQty,
  registerAgeLabel,
} from "./cash-count.ts";

describe("parseQty", () => {
  it("campo vazio e zero, nao erro", () => {
    assert.equal(parseQty(""), 0);
    assert.equal(parseQty(null), 0);
    assert.equal(parseQty(undefined), 0);
  });

  it("aceita inteiro nao negativo", () => {
    assert.equal(parseQty("12"), 12);
    assert.equal(parseQty(" 7 "), 7);
    assert.equal(parseQty(0), 0);
  });

  it("recusa o que nao e contagem de cedula", () => {
    // Meia cedula nao existe; negativo tiraria dinheiro da gaveta na soma.
    assert.ok(Number.isNaN(parseQty("2.5")));
    assert.ok(Number.isNaN(parseQty("-3")));
    assert.ok(Number.isNaN(parseQty("1e3")));
    assert.ok(Number.isNaN(parseQty("dez")));
  });
});

describe("breakdownTotal", () => {
  it("soma em centavos, sem erro de float", () => {
    // 3 x 0,10 + 1 x 0,05 + 1 x 0,25. Em float isto da 0.6000000000000001.
    const total = breakdownTotal({ "10": 3, "5": 1, "25": 1 });
    assert.equal(total, 0.6);
  });

  it("gaveta cheia fecha no centavo", () => {
    const total = breakdownTotal({ "20000": 1, "10000": 3, "5000": 7, "50": 9, "25": 3 });
    assert.equal(total, 200 + 300 + 350 + 4.5 + 0.75);
  });

  it("campo ainda ilegivel conta como zero em vez de NaN no total", () => {
    // O total aparece ao vivo enquanto se digita; um "1." no meio da
    // digitacao nao pode apagar o total inteiro.
    assert.equal(breakdownTotal({ "10000": 2, "5000": "1." }), 200);
  });

  it("chave desconhecida nao entra na soma", () => {
    assert.equal(breakdownTotal({ "10000": 1, "77777": 5 }), 100);
  });
});

describe("normalizeBreakdown", () => {
  it("descarta zeros e devolve so o que foi contado", () => {
    assert.deepEqual(normalizeBreakdown({ "10000": 2, "5000": 0, "25": "" }), { "10000": 2 });
  });

  it("ficha toda vazia vira null, nao objeto vazio", () => {
    assert.equal(normalizeBreakdown({ "10000": 0, "50": "" }), null);
    assert.equal(normalizeBreakdown(null), null);
  });

  it("recusa chave inventada em vez de ignorar", () => {
    // Ignorar seria pior que recusar: o contado subiria sem cedula
    // correspondente na ficha, e a divergencia sumiria parecendo conferida.
    assert.throws(() => normalizeBreakdown({ "99999": 1 }), /inválida/);
  });

  it("recusa quantidade que nao e contagem", () => {
    assert.throws(() => normalizeBreakdown({ "5000": -2 }), /R\$ 50/);
    assert.throws(() => normalizeBreakdown({ "100": 1.5 }), /R\$ 1/);
  });

  it("recusa formato que nao e mapa", () => {
    assert.throws(() => normalizeBreakdown([1, 2]), /inválida/);
    assert.throws(() => normalizeBreakdown("350"), /inválida/);
  });

  it("o que passa pelo estrito soma igual ao tolerante", () => {
    const bruto = { "10000": 2, "2000": 3, "25": 4 };
    assert.equal(breakdownExactTotal(normalizeBreakdown(bruto)), breakdownTotal(bruto));
  });
});

describe("classifyDifference", () => {
  it("separa falta de sobra em vez de chamar tudo de diferenca", () => {
    assert.equal(classifyDifference(-40).kind, "falta");
    assert.equal(classifyDifference(40).kind, "sobra");
    assert.equal(classifyDifference(0).kind, "exato");
  });

  it("troco de uma venda cabe na tolerancia", () => {
    assert.equal(classifyDifference(-1.5).dentroDaTolerancia, true);
    assert.equal(classifyDifference(CASH_DIFFERENCE_TOLERANCE).dentroDaTolerancia, true);
    assert.equal(classifyDifference(-CASH_DIFFERENCE_TOLERANCE).dentroDaTolerancia, true);
  });

  it("acima da tolerancia exige explicacao, nos dois sentidos", () => {
    // Sobra tambem: quase sempre e venda que nao foi registrada -- buraco no
    // registro, nao lucro.
    assert.equal(needsExplanation(-40), true);
    assert.equal(needsExplanation(40), true);
    assert.equal(needsExplanation(-2.01), true);
  });

  it("diferenca ilegivel nao vira 'exato' silencioso", () => {
    // Se um NaN chegasse aqui, o pior resultado seria fechar como "bateu
    // certo". Vira exato/dentro da tolerancia so porque a origem ja valida
    // o contado -- e o teste existe pra fixar esse contrato.
    assert.equal(classifyDifference(Number.NaN).kind, "exato");
  });
});

describe("CASH_DENOMINATIONS", () => {
  it("cobre a gaveta inteira, da maior cedula ao centavo", () => {
    const cents = CASH_DENOMINATIONS.map((d) => d.cents);
    assert.deepEqual(cents, [...cents].sort((a, b) => b - a));
    assert.equal(cents[0], 20000);
    assert.equal(cents.at(-1), 1);
    assert.equal(new Set(cents).size, cents.length);
  });
});

describe("caixa aberto de um dia pro outro", () => {
  it("aberto hoje nao e atraso", () => {
    assert.equal(isRegisterStale(0), false);
    assert.equal(registerAgeLabel(0), "aberto hoje");
  });

  it("amanhecer aberto ja e o problema, mesmo com poucas horas", () => {
    // Corte por dia de calendario: caixa aberto as 20h de ontem tem 12h de
    // vida e mesmo assim atravessou o fechamento que deveria ter havido.
    assert.equal(isRegisterStale(1), true);
    assert.equal(registerAgeLabel(1), "aberto desde ontem");
  });

  it("conta os dias quando ja virou habito", () => {
    assert.equal(isRegisterStale(10), true);
    assert.equal(registerAgeLabel(10), "aberto há 10 dias");
  });

  it("relogio fora de hora nao vira 'aberto ha -2 dias' na tela", () => {
    assert.equal(registerAgeLabel(-2), "aberto hoje");
    assert.equal(isRegisterStale(-2), false);
    assert.equal(registerAgeLabel(Number.NaN), "aberto hoje");
    assert.equal(isRegisterStale(Number.NaN), false);
  });
});
