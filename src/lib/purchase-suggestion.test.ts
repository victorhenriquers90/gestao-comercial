import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dailyRate, parsePositiveDays, suggestQuantity } from "./purchase-suggestion.ts";

describe("suggestQuantity", () => {
  it("nao sugere nada quando o estoque cobre o periodo", () => {
    const s = suggestQuantity({ saldo: 100, minimo: 10, consumoDiario: 1, coberturaDias: 30 });
    assert.equal(s.quantidade, 0);
    assert.equal(s.motivo, null);
  });

  it("repoe pelo CONSUMO, nao ate o minimo", () => {
    // Vende 2 por dia, quer 30 dias na prateleira = alvo 60. Tem 10.
    // Repor "ate o minimo" (10) sugeriria ZERO e a peca acabaria em 5 dias.
    const s = suggestQuantity({ saldo: 10, minimo: 10, consumoDiario: 2, coberturaDias: 30 });
    assert.equal(s.alvo, 60);
    assert.equal(s.quantidade, 50);
    assert.equal(s.diasDeCobertura, 5);
  });

  it("usa o minimo quando o giro e baixo demais", () => {
    // Uma venda por trimestre: pelo consumo o alvo daria ~0,3 e a peca
    // sumiria da loja. O minimo cadastrado segura.
    const s = suggestQuantity({ saldo: 1, minimo: 5, consumoDiario: 0.011, coberturaDias: 30 });
    assert.equal(s.alvo, 5);
    assert.equal(s.quantidade, 4);
    assert.equal(s.motivo, "abaixo-do-minimo");
  });

  it("sem historico de venda, cai no minimo", () => {
    const s = suggestQuantity({ saldo: 2, minimo: 8, consumoDiario: 0, coberturaDias: 30 });
    assert.equal(s.quantidade, 6);
    assert.equal(s.diasDeCobertura, null);
  });

  it("arredonda pra CIMA -- sugerir menos nao resolve", () => {
    const s = suggestQuantity({ saldo: 0, minimo: 0, consumoDiario: 0.7, coberturaDias: 10 });
    assert.equal(s.alvo, 7);
    assert.equal(s.quantidade, 7);
    const t = suggestQuantity({ saldo: 0, minimo: 0, consumoDiario: 0.71, coberturaDias: 10 });
    assert.equal(t.quantidade, 8); // 7,1 -> 8
  });

  it("distingue quem esta abaixo do minimo de quem so tem cobertura curta", () => {
    const abaixo = suggestQuantity({ saldo: 3, minimo: 10, consumoDiario: 1, coberturaDias: 5 });
    assert.equal(abaixo.motivo, "abaixo-do-minimo");
    const curta = suggestQuantity({ saldo: 20, minimo: 5, consumoDiario: 4, coberturaDias: 30 });
    assert.equal(curta.motivo, "cobertura-curta");
  });

  it("saldo negativo (venda com estoque negativo permitido) nao quebra", () => {
    const s = suggestQuantity({ saldo: -3, minimo: 5, consumoDiario: 0, coberturaDias: 30 });
    assert.equal(s.quantidade, 8);
  });

  it("valores nao finitos contam como zero em vez de contaminar", () => {
    const s = suggestQuantity({
      saldo: Number.NaN,
      minimo: 10,
      consumoDiario: Number.POSITIVE_INFINITY,
      coberturaDias: 30,
    });
    assert.equal(Number.isFinite(s.quantidade), true);
    assert.equal(s.quantidade, 10);
  });
});

describe("dailyRate", () => {
  it("divide pela JANELA, nao pelos dias com venda", () => {
    // 3 unidades vendidas num unico dia de um mes: 0,1/dia, nao 3/dia.
    assert.equal(dailyRate(3, 30), 0.1);
  });

  it("janela invalida nao divide por zero", () => {
    assert.equal(dailyRate(10, 0), 10);
    assert.equal(dailyRate(10, Number.NaN), 10);
  });

  it("sem venda, zero", () => {
    assert.equal(dailyRate(0, 60), 0);
  });
});

describe("parsePositiveDays", () => {
  it("aceita faixa util", () => {
    assert.equal(parsePositiveDays(30, "a cobertura"), 30);
    assert.equal(parsePositiveDays(365, "a janela"), 365);
  });

  it("recusa fora da faixa e lixo, citando o campo", () => {
    assert.throws(() => parsePositiveDays(0, "a cobertura"), /a cobertura/);
    assert.throws(() => parsePositiveDays(400, "a janela"), /a janela/);
    assert.throws(() => parsePositiveDays(1.5, "a cobertura"), /a cobertura/);
    assert.throws(() => parsePositiveDays(Number.NaN, "a janela"), /a janela/);
  });
});
