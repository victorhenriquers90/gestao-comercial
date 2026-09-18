import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { operatorDiscountPct } from "./discount.ts";

describe("desconto que conta contra o limite do papel", () => {
  it("cabecalho sozinho: comportamento de sempre", () => {
    // 100 de subtotal, 10 de desconto no total -> 10%.
    assert.equal(operatorDiscountPct({ subtotal: 100, lineDiscount: 0, headerDiscount: 10 }), 10);
  });

  /**
   * O furo que isto fecha: com a conta antiga (cabecalho / subtotal), mandar o
   * desconto na LINHA zerava o percentual, porque o subtotal ja vinha
   * reduzido. Um operador com limite de 2% zerava a venda sem disparar o teto.
   */
  it("linha sozinha conta igual ao cabecalho", () => {
    // Peca de 100 com 100 de desconto na linha: subtotal 0, operador deu tudo.
    assert.equal(operatorDiscountPct({ subtotal: 0, lineDiscount: 100, headerDiscount: 0 }), 100);
  });

  it("linha e cabecalho somam", () => {
    // Base 100 (subtotal 80 + 20 que o operador tirou na linha), mais 10 no
    // cabecalho -> 30 de 100.
    assert.equal(operatorDiscountPct({ subtotal: 80, lineDiscount: 20, headerDiscount: 10 }), 30);
  });

  it("promocao nao consome o limite", () => {
    // A promocao ja reduziu o subtotal, mas nao entra em lineDiscount: o
    // operador nao concedeu nada, entao o percentual dele e zero.
    assert.equal(operatorDiscountPct({ subtotal: 90, lineDiscount: 0, headerDiscount: 0 }), 0);
  });

  it("dar a peca inteira e 100%, nao zero", () => {
    // Peca de 5 com 5 de desconto: a base e o proprio preco (5), entao o
    // operador concedeu 100% dela. O furo antigo daria 0% aqui.
    assert.equal(operatorDiscountPct({ subtotal: 0, lineDiscount: 5, headerDiscount: 0 }), 100);
  });

  it("desconto sem base nao vira zero por divisao evitada", () => {
    // Base zero de verdade (carrinho sem valor) com desconto no cabecalho:
    // percentual infinito, que qualquer limite finito barra.
    assert.equal(operatorDiscountPct({ subtotal: 0, lineDiscount: 0, headerDiscount: 5 }), Infinity);
    assert.equal(operatorDiscountPct({ subtotal: 0, lineDiscount: 0, headerDiscount: 0 }), 0);
  });
});
