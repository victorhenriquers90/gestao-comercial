import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { landedUnitCosts, parsePurchaseExtra, parseStockDelta, parseStockQuantity, parseUnitCost } from "./stock-input.ts";

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

describe("parseStockDelta", () => {
  it("aceita negativo -- e o caso que 'Ajuste (define delta)' promete e nao cumpria", () => {
    assert.equal(parseStockDelta(-3), -3);
    assert.equal(parseStockDelta("-3"), -3);
  });

  it("aceita positivo tambem", () => {
    assert.equal(parseStockDelta(5), 5);
  });

  it("recusa so zero, NaN e infinito -- nao recusa negativo", () => {
    assert.throws(() => parseStockDelta(0), /diferente de zero/);
    assert.throws(() => parseStockDelta(Number.NaN), /diferente de zero/);
    assert.throws(() => parseStockDelta(Number.POSITIVE_INFINITY), /diferente de zero/);
    assert.throws(() => parseStockDelta("abc"), /diferente de zero/);
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

describe("landedUnitCosts", () => {
  it("rateia o exemplo do HANDOFF -- item unico, 10 un a R$50 + R$100 de frete", () => {
    const [custo] = landedUnitCosts([{ quantity: 10, unitCost: 50 }], 100);
    assert.equal(custo, 60);
  });

  it("sem frete/imposto/desconto, custo fica igual ao digitado", () => {
    const custos = landedUnitCosts(
      [
        { quantity: 2, unitCost: 30 },
        { quantity: 5, unitCost: 10 },
      ],
      0,
    );
    assert.deepEqual(custos, [30, 10]);
  });

  it("rateia por VALOR, nao por quantidade -- item mais caro absorve mais frete", () => {
    // subtotal = 2*100 + 8*10 = 280; extra = 28 (10% do subtotal)
    // item 1: 200/280 do extra = 20, dividido por 2 un = 10 por unidade, + 100 = 110
    // item 2: 80/280 do extra = 8, dividido por 8 un = 1 por unidade, + 10 = 11
    const [custo1, custo2] = landedUnitCosts(
      [
        { quantity: 2, unitCost: 100 },
        { quantity: 8, unitCost: 10 },
      ],
      28,
    );
    assert.ok(Math.abs(custo1! - 110) < 1e-9);
    assert.ok(Math.abs(custo2! - 11) < 1e-9);
  });

  it("desconto reduz o custo, nunca abaixo de zero", () => {
    // subtotal = 100; desconto = 100 (extra = -100) -> total do pedido = 0
    const [custo] = landedUnitCosts([{ quantity: 10, unitCost: 10 }], -100);
    assert.equal(custo, 0);
  });

  it("desconto maior que o subtotal nao gera custo negativo (clamp)", () => {
    // Caso que so aconteceria se savePurchaseFn nao travasse total < 0 antes
    // -- a funcao pura tambem nao deve devolver custo negativo por conta
    // disso, mesma invariante de parseUnitCost.
    const [custo] = landedUnitCosts([{ quantity: 10, unitCost: 10 }], -500);
    assert.equal(custo, 0);
  });

  it("subtotal zero (tudo brinde) cai pra rateio igual por quantidade", () => {
    const custos = landedUnitCosts(
      [
        { quantity: 2, unitCost: 0 },
        { quantity: 8, unitCost: 0 },
      ],
      100,
    );
    assert.deepEqual(custos, [10, 10]);
  });

  it("pedido com varios itens: soma do rateio bate com o extra total", () => {
    const itens = [
      { quantity: 3, unitCost: 20 },
      { quantity: 1, unitCost: 200 },
      { quantity: 7, unitCost: 5 },
    ];
    const extra = 45.5;
    const custos = landedUnitCosts(itens, extra);
    const somaRateada = custos.reduce((a, c, i) => a + c * itens[i]!.quantity, 0);
    const somaOriginal = itens.reduce((a, i) => a + i.quantity * i.unitCost, 0);
    assert.ok(Math.abs(somaRateada - (somaOriginal + extra)) < 1e-9);
  });
});
