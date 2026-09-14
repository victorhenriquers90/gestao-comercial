/**
 * NFC-e (Nota Fiscal de Consumidor eletrônica) — lógica pura de montagem do
 * payload pra Focus NFe (https://focusnfe.com.br), sem I/O. A chamada HTTP
 * real fica em `src/lib/server/nfce.ts`.
 *
 * Os códigos fiscais (CSOSN/CST/CFOP/forma de pagamento) seguem as tabelas
 * públicas do SEFAZ e são os mesmos pra qualquer emissor — mas o CSOSN/CST
 * "certo" pra cada produto depende de detalhes que só o contador da loja
 * sabe (substituição tributária, benefícios do estado, etc.). Os valores
 * abaixo são o ponto de partida mais comum pra um varejo simples, não uma
 * garantia fiscal — revisar com o contador antes da primeira emissão real.
 */
import type { PaymentMethod } from "./constants";
import { isValidCnpj, isValidCpf, onlyDigits } from "./document.ts";

export type TaxRegime = "mei" | "simples" | "presumido" | "real";

export function isTaxRegime(v: unknown): v is TaxRegime {
  return v === "mei" || v === "simples" || v === "presumido" || v === "real";
}

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};

/** Código de Regime Tributário (CRT) — tabela SEFAZ. */
export function crtForRegime(regime: TaxRegime): 1 | 3 {
  return regime === "mei" || regime === "simples" ? 1 : 3;
}

/**
 * ICMS por item. CRT 1 (Simples/MEI) usa CSOSN; CRT 3 (Presumido/Real) usa
 * CST. "102"/"00" são os códigos mais comuns pra revenda simples sem
 * substituição tributária nem benefício fiscal específico.
 */
export function icmsCodeForRegime(regime: TaxRegime): { csosn: string } | { cst: string } {
  return crtForRegime(regime) === 1 ? { csosn: "102" } : { cst: "00" };
}

/**
 * PIS/COFINS por item. Simples Nacional recolhe PIS/COFINS pelo DAS
 * (unificado), não por item — CST "49" ("outras operações de saída") é o
 * padrão nesse caso. Presumido/Real teriam apuração própria (CST 01/02...),
 * que este sistema ainda não modela — cai no mesmo "49" como ponto de
 * partida, a revisar com o contador se o regime não for Simples/MEI.
 */
export function pisCofinsCst(_regime: TaxRegime): string {
  return "49";
}

/** Forma de pagamento (tPag) — tabela SEFAZ. */
export function paymentCode(method: PaymentMethod): string {
  switch (method) {
    case "dinheiro":
      return "01";
    case "credito":
      return "03";
    case "debito":
      return "04";
    case "pix":
      return "17";
    case "vale":
      return "12"; // Vale presente — aproximação; não há código dedicado.
    case "crediario":
      return "99"; // Outros — crediário próprio não tem código SEFAZ dedicado.
  }
}

/** Referência única enviada à Focus NFe (idempotência do lado deles). */
export function buildNfceRef(companyId: number, saleId: number): string {
  return `gc-${companyId}-venda-${saleId}`;
}

export type NfceItemInput = {
  description: string;
  ncm: string | null;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number; // preço unitário bruto, sem desconto
  discount: number; // desconto total da linha (0 = sem desconto)
  total: number; // líquido: unitPrice*quantity - discount
};

export type NfcePaymentInput = { method: PaymentMethod; amount: number };

/**
 * Só o necessário pro corpo da requisição. Endereço/IE/certificado do
 * emitente ficam cadastrados uma vez no painel da Focus NFe (associados ao
 * CNPJ) — não fazem parte do payload por venda.
 */
export type NfceEmitterInput = {
  cnpj: string;
  name: string;
  ie: string | null;
  regime: TaxRegime;
};

export type NfceBuyerInput = { document: string | null; name: string | null };

export type BuildNfceInput = {
  ref: string;
  saleNumber: number;
  soldAt: string;
  emitter: NfceEmitterInput;
  buyer: NfceBuyerInput;
  items: NfceItemInput[];
  payments: NfcePaymentInput[];
};

/**
 * Campos obrigatórios que faltam pra emitir — mensagens já em pt-BR pro
 * operador, não erro técnico. Lista vazia = pronto pra emitir.
 */
export function validateNfceReadiness(input: BuildNfceInput): string[] {
  const errors: string[] = [];
  const cnpj = onlyDigits(input.emitter.cnpj);
  if (!cnpj) errors.push("Configure o CNPJ da empresa em Configurações.");
  else if (!isValidCnpj(cnpj)) errors.push("CNPJ da empresa inválido — a SEFAZ rejeita na homologação.");
  const ie = (input.emitter.ie ?? "").trim();
  if (!ie) errors.push("Configure a Inscrição Estadual da empresa em Configurações.");
  if (!input.items.length) errors.push("Venda sem itens.");
  for (const item of input.items) {
    const ncm = onlyDigits(item.ncm);
    if (!item.ncm) errors.push(`Produto "${item.description}" sem NCM cadastrado.`);
    else if (ncm.length !== 8) errors.push(`Produto "${item.description}" com NCM inválido (use 8 dígitos).`);
    const cfop = onlyDigits(item.cfop);
    if (cfop.length !== 4) errors.push(`Produto "${item.description}" com CFOP inválido.`);
  }
  const buyerDoc = onlyDigits(input.buyer.document);
  if (buyerDoc) {
    if (buyerDoc.length <= 11 && !isValidCpf(buyerDoc)) {
      errors.push("CPF na nota inválido — a SEFAZ rejeita na homologação.");
    } else if (buyerDoc.length > 11 && !isValidCnpj(buyerDoc)) {
      errors.push("CNPJ do destinatário inválido — a SEFAZ rejeita na homologação.");
    }
  }
  if (input.items.length) {
    const itemsTotal = input.items.reduce((a, i) => a + i.total, 0);
    const paymentsTotal = input.payments.reduce((a, p) => a + p.amount, 0);
    if (Math.abs(itemsTotal - paymentsTotal) > 0.05) {
      errors.push("Total dos itens não bate com o total dos pagamentos.");
    }
  }
  return errors;
}

/** Payload da NFC-e pro endpoint POST /v2/nfce da Focus NFe. */
export function buildNfcePayload(input: BuildNfceInput): Record<string, unknown> {
  const icms = icmsCodeForRegime(input.emitter.regime);
  const pisCofins = pisCofinsCst(input.emitter.regime);
  return {
    natureza_operacao: "Venda ao consumidor",
    data_emissao: input.soldAt,
    presenca_comprador: 1, // operação presencial
    modalidade_frete: 9, // sem frete (venda de balcão)
    cnpj_emitente: onlyDigits(input.emitter.cnpj),
    ...(input.buyer.document
      ? onlyDigits(input.buyer.document).length > 11
        ? { cnpj_destinatario: onlyDigits(input.buyer.document), nome_destinatario: input.buyer.name ?? undefined }
        : { cpf_destinatario: onlyDigits(input.buyer.document), nome_destinatario: input.buyer.name ?? undefined }
      : {}),
    items: input.items.map((item, i) => ({
      numero_item: i + 1,
      codigo_produto: String(i + 1),
      descricao: item.description.slice(0, 120),
      ncm: onlyDigits(item.ncm),
      cfop: onlyDigits(item.cfop) || item.cfop,
      unidade_comercial: item.unit,
      quantidade_comercial: item.quantity,
      valor_unitario_comercial: item.unitPrice,
      valor_bruto: Number((item.unitPrice * item.quantity).toFixed(2)),
      valor_desconto: item.discount > 0 ? item.discount : undefined,
      unidade_tributavel: item.unit,
      quantidade_tributavel: item.quantity,
      valor_unitario_tributavel: item.unitPrice,
      icms_origem: "0", // nacional
      icms_situacao_tributaria: "csosn" in icms ? icms.csosn : icms.cst,
      pis_situacao_tributaria: pisCofins,
      cofins_situacao_tributaria: pisCofins,
    })),
    formas_pagamento: input.payments.map((p) => ({
      forma_pagamento: paymentCode(p.method),
      valor_pagamento: p.amount,
    })),
  };
}

/** SEFAZ/Focus: justificativa do evento de cancelamento. */
export const NFCE_CANCEL_JUSTIFICATIVA_MIN = 15;
export const NFCE_CANCEL_JUSTIFICATIVA_MAX = 255;

export function validateNfceCancelJustificativa(raw: string): string | null {
  const j = raw.trim();
  if (j.length < NFCE_CANCEL_JUSTIFICATIVA_MIN) {
    return "A justificativa da SEFAZ precisa ter pelo menos 15 caracteres.";
  }
  if (j.length > NFCE_CANCEL_JUSTIFICATIVA_MAX) {
    return "A justificativa da SEFAZ pode ter no máximo 255 caracteres.";
  }
  return null;
}

/** Nota já autorizada — precisa de DELETE na Focus antes de baixar a venda. */
export function nfceNeedsSefazCancel(status: string | null | undefined): boolean {
  return status === "autorizado";
}

/** Ainda na fila da SEFAZ — não dá para cancelar o cupom nem a nota. */
export function nfceBlocksSaleCancel(status: string | null | undefined): boolean {
  return status === "processando_autorizacao";
}

