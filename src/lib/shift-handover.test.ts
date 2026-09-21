import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkHandover, parseHandoverAmount, safeAmount } from "./shift-handover.ts";

describe("parseHandoverAmount", () => {
  it("vazio e fim de dia: gaveta recolhida", () => {
    assert.equal(parseHandoverAmount("", 1170), 0);
    assert.equal(parseHandoverAmount(null, 1170), 0);
    assert.equal(parseHandoverAmount(undefined, 1170), 0);
  });

  it("deixa o troco combinado", () => {
    assert.equal(parseHandoverAmount(350, 1170), 350);
    assert.equal(parseHandoverAmount("350.5", 1170), 350.5);
  });

  it("nao deixa mais do que foi contado", () => {
    // Senao o turno seguinte comecaria com dinheiro que nao veio de venda
    // nenhuma -- uma sobra inventada na virada.
    assert.throws(() => parseHandoverAmount(500, 350), /mais do que foi contado/);
  });

  it("deixar tudo e valido", () => {
    assert.equal(parseHandoverAmount(350, 350), 350);
  });

  it("recusa valor que nao e dinheiro", () => {
    assert.throws(() => parseHandoverAmount(-1, 1170), /inválido/);
    assert.throws(() => parseHandoverAmount("abc", 1170), /inválido/);
    assert.throws(() => parseHandoverAmount(Number.POSITIVE_INFINITY, 1170), /inválido/);
  });
});

describe("safeAmount", () => {
  it("o que nao fica na gaveta vai pro cofre", () => {
    assert.equal(safeAmount(1170, 350), 820);
  });

  it("fim de dia leva tudo", () => {
    assert.equal(safeAmount(1170, 0), 1170);
  });

  it("nunca negativo, mesmo com entrada estranha", () => {
    assert.equal(safeAmount(350, 500), 0);
    assert.equal(safeAmount(Number.NaN, 350), 0);
  });
});

describe("checkHandover", () => {
  it("as duas contagens batem", () => {
    const h = checkHandover(350, 350);
    assert.equal(h.kind, "confere");
    assert.equal(h.diferenca, 0);
    assert.equal(h.dentroDaTolerancia, true);
  });

  it("quem entrou contou menos do que o outro disse ter deixado", () => {
    const h = checkHandover(350, 330);
    assert.equal(h.kind, "falta");
    assert.equal(h.diferenca, -20);
    assert.equal(h.dentroDaTolerancia, false);
  });

  it("contou mais tambem e desencontro, nao sorte", () => {
    const h = checkHandover(350, 380);
    assert.equal(h.kind, "sobra");
    assert.equal(h.diferenca, 30);
  });

  it("centavo de troco nao vira ocorrencia", () => {
    assert.equal(checkHandover(350, 349).dentroDaTolerancia, true);
    assert.equal(checkHandover(350, 352).dentroDaTolerancia, true);
    assert.equal(checkHandover(350, 352.01).dentroDaTolerancia, false);
  });

  it("guarda os dois lados, nao so o resultado", () => {
    // A troca so serve de prova se der pra ver QUEM disse o que. Guardar so
    // a diferenca apagaria de quem foi cada numero.
    const h = checkHandover(350, 330);
    assert.equal(h.deixado, 350);
    assert.equal(h.recebido, 330);
  });
});
