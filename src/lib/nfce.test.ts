import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocateHeaderDiscount,
  buildNfcePayload,
  buildNfceRef,
  HOMOLOGATION_BUYER_NAME,
  crtForRegime,
  icmsCodeForRegime,
  paymentCode,
  pisCofinsCst,
  validateNfceReadiness,
  type BuildNfceInput,
  type NfceItemInput,
} from "./nfce.ts";

function baseInput(overrides: Partial<BuildNfceInput> = {}): BuildNfceInput {
  return {
    ref: "gc-1-venda-50",
    env: "producao",
    saleNumber: 50,
    soldAt: "2026-09-08T14:30:00-03:00",
    emitter: {
      cnpj: "11222333000181",
      name: "Victor Comércio",
      ie: "123456789",
      regime: "simples",
    },
    buyer: { document: null, name: null },
    items: [
      {
        description: "Camiseta Algodão Premium",
        ncm: "61091000",
        cfop: "5102",
        unit: "UN",
        quantity: 1,
        unitPrice: 79.9,
        discount: 0,
        total: 79.9,
      },
    ],
    payments: [{ method: "dinheiro", amount: 79.9 }],
    ...overrides,
  };
}

describe("crtForRegime / icmsCodeForRegime / pisCofinsCst", () => {
  it("Simples e MEI usam CRT 1 e CSOSN", () => {
    assert.equal(crtForRegime("simples"), 1);
    assert.equal(crtForRegime("mei"), 1);
    assert.deepEqual(icmsCodeForRegime("simples"), { csosn: "102" });
    assert.deepEqual(icmsCodeForRegime("mei"), { csosn: "102" });
  });

  it("Presumido e Real usam CRT 3 e CST", () => {
    assert.equal(crtForRegime("presumido"), 3);
    assert.equal(crtForRegime("real"), 3);
    assert.deepEqual(icmsCodeForRegime("presumido"), { cst: "00" });
    assert.deepEqual(icmsCodeForRegime("real"), { cst: "00" });
  });

  it("PIS/COFINS usa CST 49 (recolhimento pelo DAS) como padrão em todo regime", () => {
    assert.equal(pisCofinsCst("simples"), "49");
    assert.equal(pisCofinsCst("real"), "49");
  });
});

describe("paymentCode", () => {
  it("mapeia cada forma de pagamento do app pro código SEFAZ (tPag)", () => {
    assert.equal(paymentCode("dinheiro"), "01");
    assert.equal(paymentCode("credito"), "03");
    assert.equal(paymentCode("debito"), "04");
    assert.equal(paymentCode("pix"), "17");
    assert.equal(paymentCode("vale"), "12");
    assert.equal(paymentCode("crediario"), "99");
  });
});

describe("buildNfceRef", () => {
  it("é determinística e única por empresa+venda", () => {
    assert.equal(buildNfceRef(1, 50, "producao"), "gc-1-venda-50");
    assert.notEqual(buildNfceRef(1, 50, "producao"), buildNfceRef(2, 50, "producao"));
    assert.notEqual(buildNfceRef(1, 50, "producao"), buildNfceRef(1, 51, "producao"));
  });

  it("teste e nota real nunca dividem a mesma referência", () => {
    // Se a Focus NFe compartilhar namespace entre os ambientes, a emissão
    // real de uma venda já testada voltaria como duplicada -- e a loja
    // ficaria sem a única nota que vale.
    assert.notEqual(buildNfceRef(1, 50, "homologacao"), buildNfceRef(1, 50, "producao"));
    assert.equal(buildNfceRef(1, 50, "homologacao"), "gc-1-venda-50-hom");
  });
});

describe("validateNfceReadiness", () => {
  it("passa limpo quando todo dado obrigatório está presente", () => {
    assert.deepEqual(validateNfceReadiness(baseInput()), []);
  });

  it("acusa CNPJ e IE faltando", () => {
    const errors = validateNfceReadiness(
      baseInput({ emitter: { ...baseInput().emitter, cnpj: "", ie: null } }),
    );
    assert.equal(errors.length, 2);
    assert.match(errors[0]!, /CNPJ/);
    assert.match(errors[1]!, /Inscrição Estadual/);
  });

  it("acusa produto sem NCM pelo nome", () => {
    const errors = validateNfceReadiness(
      baseInput({ items: [{ ...baseInput().items[0]!, ncm: null }] }),
    );
    assert.deepEqual(errors, ['Produto "Camiseta Algodão Premium" sem NCM cadastrado.']);
  });

  it("acusa venda sem itens", () => {
    assert.deepEqual(validateNfceReadiness(baseInput({ items: [] })), ["Venda sem itens."]);
  });

  it("acusa total dos itens divergente do total pago", () => {
    const errors = validateNfceReadiness(baseInput({ payments: [{ method: "dinheiro", amount: 50 }] }));
    assert.deepEqual(errors, ["Total dos itens não bate com o total dos pagamentos."]);
  });

  it("tolera diferença de arredondamento até 5 centavos", () => {
    const errors = validateNfceReadiness(baseInput({ payments: [{ method: "dinheiro", amount: 79.94 }] }));
    assert.deepEqual(errors, []);
  });

  it("venda com desconto de fechamento passa limpo DEPOIS de repartir o desconto nos itens", () => {
    // Bug real: sale_items.total nunca contava o desconto concedido no
    // fechamento (campo "Desconto" do PDV, não desconto de linha/promoção).
    // Sem passar por allocateHeaderDiscount antes, item.total somava o
    // SUBTOTAL (R$79,90), o pagamento registrava o total COM desconto
    // (R$69,90) e esta checagem recusava toda venda com desconto de
    // fechamento -- o tipo de desconto mais comum do sistema.
    const items = allocateHeaderDiscount(baseInput().items, 10);
    const errors = validateNfceReadiness(baseInput({ items, payments: [{ method: "dinheiro", amount: 69.9 }] }));
    assert.deepEqual(errors, []);
  });
});

describe("allocateHeaderDiscount", () => {
  function item(total: number, discount = 0): NfceItemInput {
    return { description: "Item", ncm: "61091000", cfop: "5102", unit: "UN", quantity: 1, unitPrice: total, discount, total };
  }

  it("sem desconto de cabeçalho, devolve os itens sem tocar em nada", () => {
    const items = [item(50), item(30)];
    assert.deepEqual(allocateHeaderDiscount(items, 0), items);
  });

  it("reparte proporcionalmente ao bruto de cada item, e a soma bate exata", () => {
    const result = allocateHeaderDiscount([item(80), item(20)], 10);
    assert.equal(result[0]!.total, 72); // 80 - 8 (80% do desconto)
    assert.equal(result[1]!.total, 18); // 20 - 2 (20% do desconto)
    assert.equal(result[0]!.discount, 8);
    assert.equal(result[1]!.discount, 2);
    const sum = result.reduce((a, i) => a + i.total, 0);
    assert.equal(Math.round(sum * 100) / 100, 90);
  });

  it("muitas linhas pequenas: nenhuma fica negativa e a soma ainda fecha exata", () => {
    // Mesmo caso de borda que allocateTax documenta (tax.ts): arredondar
    // fatia por fatia, em vez de acumulado, pode empurrar a última linha
    // pra um total menor que zero -- 7 linhas de R$0,33 (soma R$2,31) com
    // R$2,00 de desconto de cabeçalho.
    const items = Array.from({ length: 7 }, () => item(0.33));
    const result = allocateHeaderDiscount(items, 2);
    for (const r of result) assert.ok(r.total >= -0.001, `linha negativa: ${r.total}`);
    const sumTotal = Math.round(result.reduce((a, i) => a + i.total, 0) * 100) / 100;
    assert.equal(sumTotal, 0.31); // 2,31 - 2,00
  });

  it("desconto maior que o bruto dos itens é limitado ao bruto (defensivo)", () => {
    const result = allocateHeaderDiscount([item(10)], 999);
    assert.equal(result[0]!.total, 0);
    assert.equal(result[0]!.discount, 10);
  });

  it("preserva o desconto de linha já existente, somando o de cabeçalho", () => {
    const result = allocateHeaderDiscount([item(90, 10)], 9);
    assert.equal(result[0]!.discount, 19);
    assert.equal(result[0]!.total, 81);
  });
});

describe("buildNfcePayload", () => {
  it("monta emitente, item e forma de pagamento no formato da Focus NFe", () => {
    const payload = buildNfcePayload(baseInput()) as Record<string, any>;
    assert.equal(payload.cnpj_emitente, "11222333000181");
    assert.equal(payload.presenca_comprador, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].ncm, "61091000");
    assert.equal(payload.items[0].icms_situacao_tributaria, "102");
    assert.equal(payload.formas_pagamento[0].forma_pagamento, "01");
    assert.equal(payload.formas_pagamento[0].valor_pagamento, 79.9);
    assert.equal("cpf_destinatario" in payload, false);
    assert.equal("cnpj_destinatario" in payload, false);
  });

  it("usa CST em vez de CSOSN fora do Simples/MEI", () => {
    const payload = buildNfcePayload(
      baseInput({ emitter: { ...baseInput().emitter, regime: "presumido" } }),
    ) as Record<string, any>;
    assert.equal(payload.items[0].icms_situacao_tributaria, "00");
  });

  it("separa bruto e desconto no item, em vez de só mandar o líquido", () => {
    const payload = buildNfcePayload(
      baseInput({
        items: [
          {
            description: "Calça Jeans Reta",
            ncm: "62034200",
            cfop: "5102",
            unit: "UN",
            quantity: 2,
            unitPrice: 100,
            discount: 20,
            total: 180,
          },
        ],
        payments: [{ method: "pix", amount: 180 }],
      }),
    ) as Record<string, any>;
    assert.equal(payload.items[0].valor_bruto, 200);
    assert.equal(payload.items[0].valor_desconto, 20);
  });

  it("omite valor_desconto do JSON enviado quando a linha não tem desconto", () => {
    // valor_desconto fica `undefined` no objeto JS (a chave "existe" ali),
    // mas JSON.stringify descarta chaves undefined — o que importa é o que
    // realmente vai no corpo da requisição pra Focus NFe.
    const payload = buildNfcePayload(baseInput());
    const wireItem = JSON.parse(JSON.stringify(payload)).items[0];
    assert.equal("valor_desconto" in wireItem, false);
  });

  it("roteia o documento do comprador por CPF ou CNPJ pelo tamanho", () => {
    const cpf = buildNfcePayload(baseInput({ buyer: { document: "52998224725", name: "Ana" } })) as Record<string, any>;
    assert.equal(cpf.cpf_destinatario, "52998224725");
    assert.equal("cnpj_destinatario" in cpf, false);

    const cnpj = buildNfcePayload(
      baseInput({ buyer: { document: "11222333000181", name: "Loja XPTO" } }),
    ) as Record<string, any>;
    assert.equal(cnpj.cnpj_destinatario, "11222333000181");
    assert.equal("cpf_destinatario" in cnpj, false);
  });

  it("em homologação, o nome do destinatário é o texto exigido pelo SEFAZ", () => {
    // Regra do manual da NF-e: com destinatário em homologação, o xNome
    // tem que ser esse texto exato, senão a emissão é recusada. E o nome
    // real do cliente não viaja pra um ambiente de teste.
    const p = buildNfcePayload(
      baseInput({ env: "homologacao", buyer: { document: "52998224725", name: "Ana" } }),
    ) as Record<string, any>;
    assert.equal(p.nome_destinatario, HOMOLOGATION_BUYER_NAME);
    assert.equal(p.cpf_destinatario, "52998224725");
  });

  it("sem documento não há destinatário nenhum, nem em homologação", () => {
    const p = buildNfcePayload(baseInput({ env: "homologacao" })) as Record<string, any>;
    assert.equal("nome_destinatario" in p, false);
    assert.equal("cpf_destinatario" in p, false);
  });

  it("em produção o nome do cliente é preservado", () => {
    const p = buildNfcePayload(
      baseInput({ buyer: { document: "52998224725", name: "Ana" } }),
    ) as Record<string, any>;
    assert.equal(p.nome_destinatario, "Ana");
  });
});
