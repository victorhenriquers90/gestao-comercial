import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePurchaseExtra, parseStockQuantity, parseUnitCost } from "./stock-input.ts";

describe("parseStockQuantity", () => {
  it("aceita quantidade normal", () => {
    assert.equal(parseStockQuantity(3), 3);
    assert.equal(parseStockQuantity(0.5), 0.5);
    assert.equal(parseStockQuantity("7"), 7);
  });

  it("recusa NaN -- o caso que corrompia o estoque", () => {
    // `quantity <= 0` nao pegava: NaN <= 0 e false. E no Postgres
    // 'NaN'::numeric >= 0 e TRUE, entao a guarda do applyStockChange tambem
    // deixava passar, gravando quantity = NaN pra sempre.
    assert.throws(() => parseStockQuantity(Number.NaN), /maior que zero/);
    assert.throws(() => parseStockQuantity("abc"), /maior que zero/);
    assert.throws(() => parseStockQuantity(undefined), /maior que zero/);
  });

  it("recusa infinito", () => {
    assert.throws(() => parseStockQuantity(Number.POSITIVE_INFINITY), /maior que zero/);
    assert.throws(() => parseStockQuantity(Number.NEGATIVE_INFINITY), /maior que zero/);
  });

  it("recusa zero e negativo", () => {
    assert.throws(() => parseStockQuantity(0), /maior que zero/);
    assert.throws(() => parseStockQuantity(-2), /maior que zero/);
  });

  it("usa o rotulo informado na mensagem", () => {
    assert.throws(() => parseStockQuantity(0, "quantidade a transferir"), /quantidade a transferir/);
  });
});

describe("parseUnitCost", () => {
  it("aceita zero -- brinde e bonificacao existem", () => {
    assert.equal(parseUnitCost(0), 0);
    assert.equal(parseUnitCost(12.5), 12.5);
  });

  it("recusa negativo, NaN e infinito", () => {
    // Custo negativo viraria pedido de compra com total negativo, que o
    // financeiro le como credito.
    assert.throws(() => parseUnitCost(-1), /valido/);
    assert.throws(() => parseUnitCost(Number.NaN), /valido/);
    assert.throws(() => parseUnitCost(Number.POSITIVE_INFINITY), /valido/);
  });
});

describe("parsePurchaseExtra", () => {
  it("ausente vira zero", () => {
    assert.equal(parsePurchaseExtra(undefined, "frete"), 0);
    assert.equal(parsePurchaseExtra(null, "frete"), 0);
    assert.equal(parsePurchaseExtra("", "frete"), 0);
  });

  it("aceita valor normal", () => {
    assert.equal(parsePurchaseExtra(30, "frete"), 30);
    assert.equal(parsePurchaseExtra(0, "desconto"), 0);
  });

  it("recusa negativo e nao finito, citando o campo", () => {
    assert.throws(() => parsePurchaseExtra(-5, "frete"), /frete/);
    assert.throws(() => parsePurchaseExtra(Number.NaN, "imposto"), /imposto/);
    assert.throws(() => parsePurchaseExtra(Number.POSITIVE_INFINITY, "desconto"), /desconto/);
  });
});
