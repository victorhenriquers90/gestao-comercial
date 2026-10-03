import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditChanges, auditTitle } from "./audit-label.ts";

describe("titulo da auditoria", () => {
  it("diz quem fez, o que fez e em qual registro", () => {
    assert.equal(
      auditTitle({
        user_name: "Maria",
        action: "update",
        entity: "product",
        entity_id: "9",
        after_data: { name: "Camiseta" },
      }),
      "Maria alterou produto “Camiseta”",
    );
  });

  it("sem nome no registro, mostra o numero", () => {
    assert.equal(
      auditTitle({ user_name: "Maria", action: "cancel", entity: "sale", entity_id: "31" }),
      "Maria cancelou venda #31",
    );
  });

  it("usuario sem nome vira 'Alguém' e acao desconhecida aparece crua", () => {
    assert.equal(auditTitle({ action: "novidade", entity: "coisa", entity_id: null }), "Alguém novidade coisa");
  });
});

describe("mudancas da auditoria", () => {
  it("mostra preco e custo de antes para depois", () => {
    const out = auditChanges({
      action: "update",
      entity: "product",
      before_data: { name: "Camiseta", price: 50, cost: 20, promoPrice: null, isActive: true },
      after_data: { name: "Camiseta", price: 40, cost: 20, promoPrice: 35, isActive: true },
    });
    assert.equal(out.length, 2);
    assert.match(out[0]!, /^preço: R\$\s?50,00 → R\$\s?40,00$/);
    assert.match(out[1]!, /^preço promocional: vazio → R\$\s?35,00$/);
  });

  it("nao lista campo que nao mudou", () => {
    assert.deepEqual(
      auditChanges({
        action: "update",
        entity: "product",
        before_data: { price: 10, isActive: true },
        after_data: { price: 10, isActive: true },
      }),
      [],
    );
  });

  it("traduz papel, situacao e limite do usuario", () => {
    assert.deepEqual(
      auditChanges({
        action: "update",
        entity: "membership",
        before_data: { role: "gerente", isActive: true },
        after_data: { role: "vendedor", limit: 5, isActive: false },
      }),
      ["papel: Gerente → Vendedor", "situação: ativo → inativo"],
    );
  });

  it("traduz comissao, limite de credito, regime e documento", () => {
    assert.deepEqual(
      auditChanges({
        action: "update",
        entity: "seller",
        before_data: { commissionPct: 5, taxRegime: "none", document: "52998224725", store: "Loja Centro" },
        after_data: { commissionPct: 8.5, taxRegime: "clt", document: "52998224725", store: "Loja Shopping" },
      }),
      ["comissão: 5% → 8.5%", "regime: Sem retenção → CLT (folha)", "loja: Loja Centro → Loja Shopping"],
    );
    const out = auditChanges({
      action: "update",
      entity: "customer",
      before_data: { creditLimit: 0, document: null },
      after_data: { creditLimit: 500, document: "52998224725" },
    });
    assert.equal(out.length, 2);
    assert.match(out[0]!, /^documento: vazio → 529\.982\.247-25$/);
    assert.match(out[1]!, /^limite de crédito: R\$\s?0,00 → R\$\s?500,00$/);
  });

  it("titulo de fornecedor e vendedor", () => {
    assert.equal(
      auditTitle({ user_name: "Ana", action: "update", entity: "supplier", entity_id: 3, after_data: { name: "Têxtil Sul" } }),
      "Ana alterou fornecedor “Têxtil Sul”",
    );
    assert.equal(
      auditTitle({ user_name: "Ana", action: "create", entity: "seller", entity_id: 4, after_data: { name: "João" } }),
      "Ana criou vendedor “João”",
    );
  });

  it("sem antes (criacao) ou com payload estranho nao quebra", () => {
    assert.deepEqual(auditChanges({ action: "create", entity: "store", before_data: null, after_data: { name: "X" } }), []);
    assert.deepEqual(auditChanges({ action: "x", entity: "y", before_data: [1], after_data: "z" }), []);
  });
});
