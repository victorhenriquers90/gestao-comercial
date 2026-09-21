import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { batchStatus, compareDeposit, effectiveFeePct } from "./card-settlement.ts";

const hoje = "2026-09-21";

describe("batchStatus", () => {
  it("separa o que cai hoje do que ja deveria ter caido", () => {
    assert.equal(batchStatus("2026-09-25", hoje), "a_receber");
    assert.equal(batchStatus("2026-09-21", hoje), "hoje");
    // "Nao caiu" e diferente de "atrasado" de um cliente: aqui quem deve e a
    // adquirente, e o normal e cobrar explicacao, nao ligar cobrando.
    assert.equal(batchStatus("2026-09-20", hoje), "atrasado");
  });

  it("ignora a hora quando vem timestamp", () => {
    assert.equal(batchStatus("2026-09-21T23:00:00Z", hoje), "hoje");
  });
});

describe("compareDeposit", () => {
  it("bateu exatamente", () => {
    const d = compareDeposit(1000, 1000);
    assert.equal(d.diferenca, 0);
    assert.equal(d.relevante, false);
  });

  it("centavo de arredondamento nao vira problema", () => {
    assert.equal(compareDeposit(1000, 999.97).relevante, false);
    assert.equal(compareDeposit(1000, 1000.03).relevante, false);
  });

  it("diferenca de verdade e sinalizada, com sinal", () => {
    const menos = compareDeposit(1000, 960);
    assert.equal(menos.diferenca, -40);
    assert.equal(menos.relevante, true);

    const mais = compareDeposit(1000, 1010);
    assert.equal(mais.diferenca, 10);
    assert.equal(mais.relevante, true);
  });

  it("nao decide o que fazer com a diferenca", () => {
    // Ela so informa. Ajustar sozinho esconderia exatamente o que a
    // conciliacao existe pra revelar: que a taxa cadastrada nao e a cobrada.
    const d = compareDeposit(1000, 960);
    assert.deepEqual(Object.keys(d).sort(), ["diferenca", "esperado", "informado", "relevante"]);
  });

  it("valor ilegivel conta como zero em vez de contaminar", () => {
    const d = compareDeposit(Number.NaN, 100);
    assert.equal(d.esperado, 0);
    assert.equal(d.diferenca, 100);
  });
});

describe("effectiveFeePct", () => {
  it("revela a taxa que a adquirente cobrou de verdade", () => {
    // Bruto 1000, caiu 960 -> 4% e nao os 3,5% cadastrados.
    assert.equal(effectiveFeePct(1000, 960), 4);
  });

  it("sem bruto nao inventa percentual", () => {
    assert.equal(effectiveFeePct(0, 100), null);
    assert.equal(effectiveFeePct(Number.NaN, 100), null);
  });

  it("deposito maior que o bruto da taxa negativa, e isso e informacao", () => {
    // Acontece com estorno de taxa ou credito da adquirente -- esconder isso
    // atras de um zero tiraria o sinal de que algo incomum aconteceu.
    assert.equal(effectiveFeePct(1000, 1020), -2);
  });
});
