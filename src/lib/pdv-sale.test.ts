import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQuantity, paymentStatus, stepQty, summarizeSale, valorDigitado } from "./pdv-sale.ts";

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
