import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePromo, type Promo } from "./promo.ts";

function promo(overrides: Partial<Promo>): Promo {
  return {
    id: 1,
    name: "Promo",
    kind: "percent",
    percent: null,
    amount: null,
    promoPrice: null,
    buyQty: null,
    payQty: null,
    minQty: null,
    productId: null,
    categoryId: null,
    isActive: true,
    startsAt: "2026-01-01",
    endsAt: "2026-12-31",
    ...overrides,
  };
}

describe("computePromo", () => {
  it("percentual acima de 100 não vira desconto maior que a própria linha", () => {
    // Bug real: gerente digitou 500 no campo percentual (queria 50,0%).
    // checkoutFn fazia unitPrice*qty - disc sem teto, e a linha fechava
    // negativa (2x R$100 -> -R$800), passando pelo `if (total < 0)` que só
    // olha a venda inteira quando há outra linha positiva compensando.
    const r = computePromo(promo({ kind: "percent", percent: 500 }), 2, 100);
    assert.equal(r.discount, 200);
    assert.ok(100 * 2 - r.discount >= 0, "linha não pode ficar negativa");
  });

  it("percentual negativo não gera desconto (nem crédito)", () => {
    const r = computePromo(promo({ kind: "percent", percent: -50 }), 1, 100);
    assert.equal(r.discount, 0);
  });

  it("preço promocional negativo ou zero é ignorado, não vira preço negativo", () => {
    const r = computePromo(promo({ kind: "promo_price", promoPrice: -10 }), 3, 50);
    assert.equal(r.unitPrice, 50);
    assert.equal(r.discount, 0);
  });

  it("preço promocional válido abate a diferença normalmente", () => {
    const r = computePromo(promo({ kind: "promo_price", promoPrice: 40 }), 3, 50);
    assert.equal(r.unitPrice, 40);
    assert.equal(r.discount, 30);
  });

  it("desconto fixo nunca passa do valor da linha", () => {
    const r = computePromo(promo({ kind: "fixed", amount: 999 }), 1, 30);
    assert.equal(r.discount, 30);
  });

  it("leve X pague Y nunca dá mais itens grátis do que a quantidade levada", () => {
    // 3 unidades, "leve 3 pague 2": 1 grátis, desconto = 1 unidade.
    const r = computePromo(promo({ kind: "bxgy", buyQty: 3, payQty: 2 }), 3, 20);
    assert.equal(r.discount, 20);
    // 5 unidades: só 1 grupo completo de 3 cabe, as 2 sobrando não geram desconto extra.
    const r2 = computePromo(promo({ kind: "bxgy", buyQty: 3, payQty: 2 }), 5, 20);
    assert.equal(r2.discount, 20);
  });
});
