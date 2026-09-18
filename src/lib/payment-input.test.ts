import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePaymentAmount, parsePaymentMethod, parseReceived } from "./payment-input.ts";

describe("forma de pagamento", () => {
  it("aceita as formas do sistema", () => {
    assert.equal(parsePaymentMethod("dinheiro"), "dinheiro");
    assert.equal(parsePaymentMethod("pix"), "pix");
    assert.equal(parsePaymentMethod("crediario"), "crediario");
  });

  it("normaliza espaco e caixa", () => {
    assert.equal(parsePaymentMethod(" Dinheiro "), "dinheiro");
  });

  /**
   * O fechamento soma so o que tem method === 'dinheiro'. Uma variacao que
   * passasse direto (ex.: "dinheiro " com espaco) sairia da conta do caixa
   * esperado, e a diferenca em especie nao apareceria na conferencia.
   */
  it("recusa metodo inventado", () => {
    assert.throws(() => parsePaymentMethod("dinheiro_2"), /inválida/);
    assert.throws(() => parsePaymentMethod("bitcoin"), /inválida/);
    assert.throws(() => parsePaymentMethod(""), /inválida/);
  });
});

describe("valor do pagamento", () => {
  it("aceita valor positivo", () => {
    assert.equal(parsePaymentAmount(219.9), 219.9);
  });

  /**
   * O furo principal: como a unica checagem era a soma (paySum >= total), um
   * pagamento negativo em dinheiro passava junto de outro positivo e reduzia o
   * dinheiro esperado no caixa.
   */
  it("recusa negativo e zero", () => {
    assert.throws(() => parsePaymentAmount(-500), /inválido/);
    assert.throws(() => parsePaymentAmount(0), /inválido/);
  });

  it("recusa valor nao numerico", () => {
    assert.throws(() => parsePaymentAmount(Number.NaN), /inválido/);
    assert.throws(() => parsePaymentAmount(Number.POSITIVE_INFINITY), /inválido/);
  });
});

describe("valor recebido em dinheiro", () => {
  it("sem informar, assume o proprio valor pago", () => {
    assert.equal(parseReceived(100, undefined), 100);
  });

  it("maior que o pago vira troco", () => {
    assert.equal(parseReceived(100, 150), 150);
  });

  it("recusa recebido menor que o pago", () => {
    assert.throws(() => parseReceived(100, 40), /menor que o valor/);
  });

  it("tolera centavo de arredondamento", () => {
    assert.equal(parseReceived(100, 99.995), 100);
  });
});
