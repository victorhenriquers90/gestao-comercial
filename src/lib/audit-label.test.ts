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

  it("lancamentos financeiros: titulo pela descricao e detalhe do evento", () => {
    assert.equal(
      auditTitle({ user_name: "Ana", action: "create", entity: "expense", entity_id: 7, after_data: { description: "Aluguel" } }),
      "Ana criou despesa “Aluguel”",
    );
    const out = auditChanges({
      action: "create",
      entity: "expense",
      before_data: null,
      after_data: { description: "Aluguel", amount: 1500, category: "Aluguel", method: "pix" },
    });
    assert.equal(out.length, 3);
    assert.match(out[0]!, /^valor: R\$\s?1\.500,00$/);
    assert.equal(out[1], "categoria: Aluguel");
    assert.equal(out[2], "forma: PIX");
  });

  it("cancelamento de lancamento mostra o valor, o dinheiro devolvido e o motivo", () => {
    assert.equal(
      auditTitle({
        user_name: "Ana",
        action: "cancel",
        entity: "expense",
        entity_id: 7,
        after_data: { description: "Motoboy" },
      }),
      "Ana cancelou despesa “Motoboy”",
    );
    const out = auditChanges({
      action: "cancel",
      entity: "expense",
      before_data: null,
      after_data: {
        description: "Motoboy",
        amount: 25,
        category: null,
        method: "dinheiro",
        cashReversal: 25,
        reason: "Lançada em duplicidade",
      },
    });
    assert.equal(out.length, 4);
    assert.match(out[0]!, /^valor: R\$\s?25,00$/);
    assert.equal(out[1], "forma: Dinheiro");
    assert.match(out[2]!, /^devolvido ao caixa: R\$\s?25,00$/);
    assert.equal(out[3], "motivo: Lançada em duplicidade");

    const conta = auditChanges({
      action: "cancel",
      entity: "accounts_payable",
      before_data: null,
      after_data: { description: "Luz", amount: 200, dueDate: "2026-10-05", reason: "Fornecedor errado" },
    });
    assert.equal(conta.length, 3);
    assert.equal(conta[1], "vencimento: 05/10/2026");
    assert.equal(conta[2], "motivo: Fornecedor errado");
  });

  it("estorno de baixa diz o que voltou, o dinheiro do caixa e o motivo", () => {
    assert.equal(
      auditTitle({
        user_name: "Ana",
        action: "reverse-pay",
        entity: "accounts_payable",
        entity_id: 4,
        after_data: { description: "Luz" },
      }),
      "Ana estornou pagamento de conta a pagar “Luz”",
    );
    assert.equal(
      auditTitle({
        user_name: "Ana",
        action: "reverse-receive",
        entity: "accounts_receivable",
        entity_id: 9,
        after_data: { description: "Parcela 2/3" },
      }),
      "Ana estornou recebimento de conta a receber “Parcela 2/3”",
    );
    const pago = auditChanges({
      action: "reverse-pay",
      entity: "accounts_payable",
      before_data: null,
      after_data: { description: "Luz", amount: 80, method: "dinheiro", status: "pendente", cashReversal: 80, cashRemoved: null, reason: "Fornecedor errado" },
    });
    assert.equal(pago.length, 5);
    assert.match(pago[0]!, /^valor: R\$\s?80,00$/);
    assert.equal(pago[1], "forma: Dinheiro");
    assert.equal(pago[2], "situação: pendente");
    assert.match(pago[3]!, /^devolvido ao caixa: R\$\s?80,00$/);
    assert.equal(pago[4], "motivo: Fornecedor errado");
    const recebido = auditChanges({
      action: "reverse-receive",
      entity: "accounts_receivable",
      before_data: null,
      after_data: { amount: 50, method: "dinheiro", cashReversal: null, cashRemoved: 50, reason: "Valor errado" },
    });
    assert.match(recebido[2]!, /^retirado do caixa: R\$\s?50,00$/);
  });

  it("sangria e suprimento mostram valor e motivo", () => {
    assert.equal(
      auditTitle({ user_name: "Rui", action: "sangria", entity: "cash_register", entity_id: 3, after_data: { amount: 80 } }),
      "Rui lançou sangria no caixa #3",
    );
    const out = auditChanges({
      action: "sangria",
      entity: "cash_register",
      before_data: null,
      after_data: { amount: 80, reason: "Troco para o padeiro" },
    });
    assert.equal(out.length, 2);
    assert.match(out[0]!, /^valor: R\$\s?80,00$/);
    assert.equal(out[1], "motivo: Troco para o padeiro");
  });

  it("edicao de conta mostra valor, vencimento em dd/mm/aaaa e vinculo", () => {
    const out = auditChanges({
      action: "update",
      entity: "accounts_payable",
      before_data: { description: "Luz", amount: 200, dueDate: "2026-10-05", supplierId: null, storeId: 7 },
      after_data: { description: "Luz", amount: 230, dueDate: "2026-10-10", supplierId: 3, storeId: 7 },
    });
    assert.equal(out.length, 3);
    assert.match(out[0]!, /^valor: R\$\s?200,00 → R\$\s?230,00$/);
    assert.equal(out[1], "vencimento: 05/10/2026 → 10/10/2026");
    assert.equal(out[2], "fornecedor: vazio → nº 3");
  });

  it("promocao: titulo, criacao completa e desativacao", () => {
    assert.equal(
      auditTitle({ user_name: "Ana", action: "update", entity: "promotion", entity_id: 5, after_data: { name: "Liquida verao" } }),
      "Ana alterou promoção “Liquida verao”",
    );
    const criada = auditChanges({
      action: "create",
      entity: "promotion",
      before_data: null,
      after_data: {
        name: "Liquida verao",
        kind: "percent",
        percent: 15,
        amount: null,
        promoPrice: null,
        buyQty: null,
        payQty: null,
        minQty: null,
        productId: null,
        categoryId: 3,
        startsAt: "2026-10-01",
        endsAt: "2026-10-31",
        isActive: true,
      },
    });
    assert.deepEqual(criada, [
      "nome: Liquida verao",
      "tipo: Desconto percentual",
      "percentual: 15%",
      "categoria: nº 3",
      "início: 01/10/2026",
      "fim: 31/10/2026",
      "situação: ativo",
    ]);
    assert.deepEqual(
      auditChanges({
        action: "update",
        entity: "promotion",
        before_data: { name: "Liquida verao", kind: "percent", percent: 15, isActive: true, endsAt: "2026-10-31" },
        after_data: { name: "Liquida verao", kind: "percent", percent: 15, isActive: false, endsAt: "2026-10-31" },
      }),
      ["situação: ativo → inativo"],
    );
  });

  it("regra de comissao: faixas, valor por peca e exclusao", () => {
    assert.equal(
      auditTitle({ user_name: "Rui", action: "delete", entity: "commission_rule", entity_id: 2, before_data: { name: "Geral" }, after_data: null }),
      "Rui excluiu regra de comissão “Geral”",
    );
    const out = auditChanges({
      action: "update",
      entity: "commission_rule",
      before_data: { name: "Geral", kind: "percent_sales", percent: 5, tierBasis: "none", tiers: [], paymentMethod: null, skipPromo: false },
      after_data: {
        name: "Geral",
        kind: "percent_sales",
        percent: 5,
        tierBasis: "month",
        tiers: [
          { min: 0, percent: 5 },
          { min: 8000, percent: 7 },
        ],
        paymentMethod: "crediario",
        skipPromo: true,
      },
    });
    assert.equal(out.length, 4);
    assert.equal(out[0], "base da faixa: Percentual único → Faixa sobre o faturamento do mês");
    assert.match(out[1]!, /^faixas: nenhuma → R\$\s?0,00\+ → 5% · R\$\s?8\.000,00\+ → 7%$/);
    assert.equal(out[2], "pagamento: vazio → Crediário");
    assert.equal(out[3], "ignora itens em promoção: não → sim");
    const porPeca = auditChanges({
      action: "update",
      entity: "commission_rule",
      before_data: { kind: "fixed_unit", percent: 2 },
      after_data: { kind: "fixed_unit", percent: 3 },
    });
    assert.match(porPeca[0]!, /^valor por peça: R\$\s?2,00 → R\$\s?3,00$/);
  });

  it("meta: criacao omite bonus desligado e bonus segue a unidade do tipo", () => {
    const criada = auditChanges({
      action: "create",
      entity: "target",
      before_data: null,
      after_data: {
        name: "Meta outubro",
        amount: 20000,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        storeId: null,
        sellerId: 4,
        categoryId: null,
        bonusKind: "none",
        bonusValue: 0,
      },
    });
    assert.equal(criada.length, 5);
    assert.equal(criada[0], "nome: Meta outubro");
    assert.match(criada[1]!, /^meta: R\$\s?20\.000,00$/);
    assert.equal(criada[4], "vendedor: nº 4");
    const edit = auditChanges({
      action: "update",
      entity: "target",
      before_data: { bonusKind: "extra_percent", bonusValue: 1 },
      after_data: { bonusKind: "extra_percent", bonusValue: 2 },
    });
    assert.deepEqual(edit, ["valor do bônus: 1% → 2%"]);
  });

  it("sem antes (criacao) ou com payload estranho nao quebra", () => {
    assert.deepEqual(auditChanges({ action: "create", entity: "store", before_data: null, after_data: { name: "X" } }), []);
    assert.deepEqual(auditChanges({ action: "x", entity: "y", before_data: [1], after_data: "z" }), []);
  });
});
