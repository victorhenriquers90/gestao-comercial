import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planReversal, planSettlement } from "./settlement.ts";

const base = { amount: 100, paid: 0, interest: 0, discount: 0, payment: 100, status: "pendente" };

describe("baixa de titulo", () => {
  it("pagamento integral quita", () => {
    const p = planSettlement(base);
    assert.equal(p.status, "pago");
    assert.equal(p.paid, 100);
    assert.equal(p.open, 100);
  });

  it("pagamento menor deixa parcial e a segunda parte quita", () => {
    const a = planSettlement({ ...base, payment: 40 });
    assert.equal(a.status, "parcial");
    assert.equal(a.paid, 40);
    const b = planSettlement({ ...base, paid: 40, status: "parcial", payment: 60 });
    assert.equal(b.status, "pago");
    assert.equal(b.paid, 100);
  });

  it("recusa baixar titulo ja quitado, mesmo com saldo aparente", () => {
    assert.throws(() => planSettlement({ ...base, paid: 100, status: "pago" }), /já está quitado/);
    assert.throws(() => planSettlement({ ...base, paid: 100, status: "parcial" }), /já está quitado/);
  });

  it("recusa valor acima do saldo e mostra o saldo", () => {
    assert.throws(() => planSettlement({ ...base, payment: 1000 }), /maior que o saldo do título \(R\$\s?100,00\)/);
    assert.throws(
      () => planSettlement({ ...base, paid: 70, status: "parcial", payment: 40 }),
      /maior que o saldo do título \(R\$\s?30,00\)/,
    );
  });

  it("aceita diferenca de centavos dentro da tolerancia", () => {
    const p = planSettlement({ ...base, payment: 100.04 });
    assert.equal(p.status, "pago");
    assert.throws(() => planSettlement({ ...base, payment: 100.06 }), /maior que o saldo/);
  });

  it("juros aumentam o alvo e desconto reduz", () => {
    assert.equal(planSettlement({ ...base, interest: 5, payment: 105 }).status, "pago");
    assert.equal(planSettlement({ ...base, interest: 5, payment: 100 }).status, "parcial");
    assert.equal(planSettlement({ ...base, discount: 10, payment: 90 }).status, "pago");
    assert.throws(() => planSettlement({ ...base, discount: 10, payment: 100 }), /maior que o saldo/);
  });

  it("desconto que cobre o titulo inteiro nao vira baixa", () => {
    assert.throws(() => planSettlement({ ...base, discount: 100, payment: 1 }), /desconto cobre/i);
    assert.throws(() => planSettlement({ ...base, discount: 500, payment: 1 }), /desconto cobre/i);
  });
});

describe("estorno de baixa", () => {
  it("voltar a unica baixa deixa o titulo pendente e zerado", () => {
    assert.deepEqual(planReversal({ paid: 100, amount: 100 }), { paid: 0, status: "pendente" });
  });

  it("voltar so a ultima baixa deixa o titulo parcial", () => {
    assert.deepEqual(planReversal({ paid: 100, amount: 60 }), { paid: 40, status: "parcial" });
  });

  it("nunca fica negativo", () => {
    assert.deepEqual(planReversal({ paid: 50, amount: 80 }), { paid: 0, status: "pendente" });
  });
});
