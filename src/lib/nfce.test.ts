import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildNfcePayload,
  buildNfceRef,
  crtForRegime,
  icmsCodeForRegime,
  nfceBlocksSaleCancel,
  nfceNeedsSefazCancel,
  paymentCode,
  pisCofinsCst,
  validateNfceCancelJustificativa,
  validateNfceReadiness,
  type BuildNfceInput,
} from "./nfce.ts";

function baseInput(overrides: Partial<BuildNfceInput> = {}): BuildNfceInput {
  return {
    ref: "gc-1-venda-50",
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
    assert.equal(buildNfceRef(1, 50), "gc-1-venda-50");
    assert.notEqual(buildNfceRef(1, 50), buildNfceRef(2, 50));
    assert.notEqual(buildNfceRef(1, 50), buildNfceRef(1, 51));
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

  it("rejeita CNPJ do emitente com dígito verificador errado (SEFAZ homologação)", () => {
    const errors = validateNfceReadiness(
      baseInput({ emitter: { ...baseInput().emitter, cnpj: "11222333000180" } }),
    );
    assert.equal(errors.some((e) => /CNPJ da empresa inválido/.test(e)), true);
  });

  it("rejeita NCM que não tem 8 dígitos", () => {
    const errors = validateNfceReadiness(
      baseInput({ items: [{ ...baseInput().items[0]!, ncm: "6109" }] }),
    );
    assert.deepEqual(errors, ['Produto "Camiseta Algodão Premium" com NCM inválido (use 8 dígitos).']);
  });

  it("rejeita CFOP que não tem 4 dígitos", () => {
    const errors = validateNfceReadiness(
      baseInput({ items: [{ ...baseInput().items[0]!, cfop: "51" }] }),
    );
    assert.deepEqual(errors, ['Produto "Camiseta Algodão Premium" com CFOP inválido.']);
  });

  it("rejeita CPF na nota inválido", () => {
    const errors = validateNfceReadiness(baseInput({ buyer: { document: "11111111111", name: "Ana" } }));
    assert.equal(errors.some((e) => /CPF na nota inválido/.test(e)), true);
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
});

describe("cancelamento NFC-e (SEFAZ/Focus)", () => {
  it("justificativa precisa ter 15 a 255 caracteres", () => {
    assert.match(validateNfceCancelJustificativa("curto") ?? "", /15 caracteres/);
    assert.equal(validateNfceCancelJustificativa("Cancelamento da venda no PDV."), null);
    assert.match(validateNfceCancelJustificativa("x".repeat(256)) ?? "", /255 caracteres/);
  });

  it("só nota autorizada exige cancelamento na SEFAZ", () => {
    assert.equal(nfceNeedsSefazCancel("autorizado"), true);
    assert.equal(nfceNeedsSefazCancel("processando_autorizacao"), false);
    assert.equal(nfceNeedsSefazCancel("erro"), false);
    assert.equal(nfceNeedsSefazCancel(null), false);
  });

  it("nota em processamento bloqueia cancelar a venda", () => {
    assert.equal(nfceBlocksSaleCancel("processando_autorizacao"), true);
    assert.equal(nfceBlocksSaleCancel("autorizado"), false);
  });
});
