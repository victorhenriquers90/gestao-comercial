import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lineDiscountWithExtra,
  operatorPctOf,
  parseQuantity,
  paymentStatus,
  stepQty,
  summarizeSale,
  valorDigitado,
} from "./pdv-sale.ts";

describe("summarizeSale", () => {
  const linhas = [
    { qty: 2, sellPrice: 79.9, lineDiscount: 0 },
    { qty: 1, sellPrice: 159.9, lineDiscount: 16 },
  ];

  it("separa bruto, promocao, desconto manual e total", () => {
    const s = summarizeSale(linhas, 10);
    assert.equal(Number(s.gross.toFixed(2)), 319.7);
    assert.equal(s.promo, 16);
    assert.equal(Number(s.subtotal.toFixed(2)), 303.7);
    assert.equal(s.manual, 10);
    assert.equal(Number(s.total.toFixed(2)), 293.7);
  });

  it("conta pecas e linhas separado", () => {
    const s = summarizeSale(linhas, 0);
    assert.equal(s.pieces, 3);
    assert.equal(s.lines, 2);
  });

  it("subtotal e o mesmo da conta antiga (preco x qtd - desconto da linha)", () => {
    const antiga = linhas.reduce((a, l) => a + l.sellPrice * l.qty - l.lineDiscount, 0);
    assert.equal(summarizeSale(linhas, 0).subtotal, antiga);
  });

  it("total nunca fica negativo", () => {
    assert.equal(summarizeSale(linhas, 10_000).total, 0);
  });

  it("carrinho vazio zera tudo", () => {
    assert.deepEqual(summarizeSale([], 0), {
      gross: 0, promo: 0, subtotal: 0, manual: 0, total: 0, pieces: 0, lines: 0,
    });
  });

  it("desconto manual por linha entra em 'manual', nao em 'promo' -- mesmo vindo da coluna Desconto do carrinho", () => {
    // Peca de R$100 com promoDiscount 0 mas lineDiscount 15 (manual, sem
    // promocao nenhuma aplicada): o R$15 tem que contar como desconto do
    // OPERADOR (igual ao F6), nao aparecer como "Promoções" no resumo --
    // senao o cupom credita um desconto concedido por alguem como se fosse
    // regra do sistema.
    const s = summarizeSale([{ qty: 1, sellPrice: 100, lineDiscount: 15, promoDiscount: 0 }], 0);
    assert.equal(s.promo, 0);
    assert.equal(s.manual, 15);
    assert.equal(s.total, 85);
  });

  it("linha com promocao e extra: so o que passa da promocao conta como manual", () => {
    // Promocao tira R$10, o efetivo da linha e R$18 (lineDiscountWithExtra
    // com extra de R$8). So os R$8 contam pro limite do papel.
    const s = summarizeSale([{ qty: 1, sellPrice: 100, lineDiscount: 18, promoDiscount: 10 }], 0);
    assert.equal(s.promo, 10);
    assert.equal(s.manual, 8);
    assert.equal(s.total, 82);
  });

  it("linha so com promocao (extra zero): manual zero", () => {
    const s = summarizeSale([{ qty: 1, sellPrice: 100, lineDiscount: 10, promoDiscount: 10 }], 0);
    assert.equal(s.promo, 10);
    assert.equal(s.manual, 0);
  });

  it("header e manual por linha somam no mesmo 'manual'", () => {
    const s = summarizeSale(
      [
        { qty: 1, sellPrice: 100, lineDiscount: 20, promoDiscount: 0 },
        { qty: 1, sellPrice: 50, lineDiscount: 0 },
      ],
      5,
    );
    assert.equal(s.manual, 25);
    assert.equal(s.promo, 0);
    assert.equal(s.total, 125);
  });
});

describe("lineDiscountWithExtra", () => {
  it("extra do operador soma POR CIMA da promocao", () => {
    // R$100 com promocao de R$10: o operador ve R$90 e da mais R$5 -> R$85.
    assert.equal(lineDiscountWithExtra(100, 10, 5), 15);
  });

  it("sem promocao o extra e o desconto inteiro", () => {
    assert.equal(lineDiscountWithExtra(100, 0, 30), 30);
  });

  it("nunca passa do bruto da linha", () => {
    assert.equal(lineDiscountWithExtra(100, 10, 500), 100);
  });

  it("extra negativo nao devolve promocao", () => {
    assert.equal(lineDiscountWithExtra(100, 10, -5), 10);
  });
});

describe("operatorPctOf -- mesma conta do limite no checkoutFn", () => {
  const item = (sellPrice: number, promo: number, extra: number, qty = 1) => ({
    qty,
    sellPrice,
    promoDiscount: promo,
    lineDiscount: lineDiscountWithExtra(sellPrice * qty, promo, extra),
  });

  it("so cabecalho: desconto sobre o subtotal", () => {
    assert.equal(operatorPctOf([item(100, 0, 0)], 10), 10);
  });

  it("item + cabecalho SOMAM -- 10% + 10% passa do limite de 10%", () => {
    // R$10 no item, R$9 no cabecalho (10% do que sobrou): 19% da venda.
    assert.equal(operatorPctOf([item(100, 0, 10)], 9), 19);
  });

  it("50% num item barato e pouco na venda inteira", () => {
    const pct = operatorPctOf([item(100, 0, 50), item(900, 0, 0)], 0);
    assert.equal(pct, 5);
  });

  it("promocao nao consome limite, so o extra -- base e o preco ja promocional", () => {
    assert.equal(operatorPctOf([item(100, 10, 0)], 0), 0);
    assert.equal(operatorPctOf([item(100, 10, 9)], 0), 10);
  });

  it("venda sem base com desconto e infinito, igual ao servidor", () => {
    assert.equal(operatorPctOf([item(100, 100, 0)], 5), Infinity);
  });
});

describe("paymentStatus", () => {
  it("dinheiro com troco", () => {
    const s = paymentStatus([{ method: "dinheiro", amount: "87,90", received: "100,00" }], 87.9);
    assert.equal(s.remaining, 0);
    assert.equal(Number(s.change.toFixed(2)), 12.1);
    assert.equal(s.informed, true);
  });

  it("pagamento dividido mostra o que falta", () => {
    const s = paymentStatus(
      [
        { method: "pix", amount: "50", received: "" },
        { method: "credito", amount: "20", received: "" },
      ],
      100,
    );
    assert.equal(s.paid, 70);
    assert.equal(s.remaining, 30);
    assert.equal(s.change, 0);
  });

  it("nada digitado: nao informado (o F10 registra em dinheiro)", () => {
    const s = paymentStatus([{ method: "dinheiro", amount: "", received: "" }], 50);
    assert.equal(s.informed, false);
    assert.equal(s.remaining, 50);
  });

  it("valor ilegivel conta zero na previa", () => {
    assert.equal(valorDigitado("abc"), 0);
    assert.equal(paymentStatus([{ method: "pix", amount: "abc", received: "" }], 10).paid, 0);
  });
});

describe("parseQuantity", () => {
  it("aceita inteiro e decimal com virgula ou ponto", () => {
    assert.equal(parseQuantity("3"), 3);
    assert.equal(parseQuantity(" 1,5 "), 1.5);
    assert.equal(parseQuantity("0.25"), 0.25);
  });

  it("recusa o que nao e quantidade", () => {
    for (const ruim of ["", "0", "0,0", "-1", "abc", "1,2345", "1e3", "2x"]) {
      assert.equal(parseQuantity(ruim), null, ruim);
    }
  });
});

describe("stepQty", () => {
  it("quantidade inteira soma/subtrai 1, travando em 1 (produto por unidade)", () => {
    assert.equal(stepQty(3, 1), 4);
    assert.equal(stepQty(3, -1), 2);
    assert.equal(stepQty(1, -1), 1);
  });

  it("quantidade fracionada soma/subtrai 1 sem lixo de ponto flutuante", () => {
    assert.equal(stepQty(1.1, -1), 0.1);
    assert.equal(stepQty(2.2, -1), 1.2);
    assert.equal(stepQty(1.333, -1), 0.333);
    assert.equal(stepQty(1.1, 1), 2.1);
  });

  it("fracionada abaixo de 1 nao trava em 1 -- so no piso quase zero", () => {
    assert.equal(stepQty(1.5, -1), 0.5);
    assert.equal(stepQty(0.5, -1), 0.001);
  });
});
