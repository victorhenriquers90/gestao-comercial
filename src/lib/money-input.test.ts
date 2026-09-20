import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMoneyInput, requireMoneyInput } from "./money-input.ts";

describe("parseMoneyInput", () => {
  it("le o jeito que se digita no balcao", () => {
    // O caso que trocava a forma de pagamento sozinho no PDV.
    assert.equal(parseMoneyInput("50,00"), 50);
    assert.equal(parseMoneyInput("0,5"), 0.5);
    assert.equal(parseMoneyInput("1.234,56"), 1234.56);
    assert.equal(parseMoneyInput("1.234.567,89"), 1234567.89);
  });

  it("continua lendo ponto decimal", () => {
    assert.equal(parseMoneyInput("50.00"), 50);
    assert.equal(parseMoneyInput("50"), 50);
    assert.equal(parseMoneyInput("0.5"), 0.5);
  });

  it("desambigua ponto de milhar sem virgula", () => {
    // "1.234" digitado por quem pensa em milhar, nao em 1 real e 234.
    assert.equal(parseMoneyInput("1.234"), 1234);
    assert.equal(parseMoneyInput("1.234.567"), 1234567);
    // Mas "1.23" so pode ser decimal.
    assert.equal(parseMoneyInput("1.23"), 1.23);
  });

  it("tolera moeda, espaco e espaco nao-separavel de planilha", () => {
    assert.equal(parseMoneyInput("R$ 1.500,00"), 1500);
    assert.equal(parseMoneyInput(" 1.500,00 "), 1500);
  });

  it("devolve NaN -- nunca zero -- pro que nao da pra ler", () => {
    // Zero seria uma resposta perigosa demais pra um campo de dinheiro: e
    // exatamente o que fazia o pagamento sumir em silencio.
    for (const lixo of ["", "   ", "abc", "12abc", "1,2,3", "--5", "1e999", null, undefined, {}]) {
      assert.ok(Number.isNaN(parseMoneyInput(lixo as unknown)), `deveria ser NaN: ${String(lixo)}`);
    }
  });

  it("recusa numero nao finito vindo como number", () => {
    assert.ok(Number.isNaN(parseMoneyInput(Number.POSITIVE_INFINITY)));
    assert.ok(Number.isNaN(parseMoneyInput(Number.NaN)));
    assert.equal(parseMoneyInput(12.5), 12.5);
  });

  it("le negativo (quem decide se aceita e quem chama)", () => {
    assert.equal(parseMoneyInput("-10,50"), -10.5);
  });
});

describe("requireMoneyInput", () => {
  it("passa valor positivo", () => {
    assert.equal(requireMoneyInput("50,00", "erro"), 50);
  });

  it("recusa vazio, zero, negativo e ilegivel com a mensagem dada", () => {
    for (const ruim of ["", "0", "0,00", "-5", "abc"]) {
      assert.throws(() => requireMoneyInput(ruim, "Informe um valor válido."), /Informe um valor válido/);
    }
  });
});
