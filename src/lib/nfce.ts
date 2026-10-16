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

export type NfceEnv = "homologacao" | "producao";

/**
 * Nome que o SEFAZ exige no destinatário em ambiente de homologação.
 *
 * Não é enfeite: a regra do manual da NF-e manda esse texto exato no
 * xNome quando há destinatário em homologação, e emissão fora disso é
 * recusada. Se a Focus NFe já sobrescrever por conta própria, mandar o
 * valor certo é redundante e inofensivo; se não sobrescrever, evita uma
 * tarde inteira perdida lendo rejeição do SEFAZ.
 *
 * De quebra, o nome real do cliente não viaja para um ambiente de teste.
 */
export const HOMOLOGATION_BUYER_NAME =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

/**
 * Referência única enviada à Focus NFe (idempotência do lado deles).
 *
 * O ambiente entra na referência. Homologação e produção provavelmente
 * têm namespaces separados lá -- URLs e tokens diferentes --, mas
 * "provavelmente" é onde esse tipo de bug mora: se compartilharem, a
 * emissão REAL de uma venda já testada seria recusada como duplicada e a
 * loja ficaria justamente sem a nota que vale. Separar custa um sufixo.
 */
export function buildNfceRef(companyId: number, saleId: number, env: NfceEnv): string {
  const base = `gc-${companyId}-venda-${saleId}`;
  return env === "homologacao" ? `${base}-hom` : base;
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

/**
 * Reparte o desconto de CABEÇALHO (`sales.discount`) pelos itens, antes da
 * nota ir pro payload.
 *
 * `sale_items.total`/`discount` (ver `checkoutFn`, commerce.ts) só contam o
 * desconto de LINHA -- o desconto concedido no fechamento (campo "Desconto"
 * do PDV) nunca entra na linha, só no `sales.total` final. Resultado: a
 * soma de `item.total` ficava igual ao SUBTOTAL (antes do desconto de
 * fechamento), não ao total pago -- e `validateNfceReadiness` abaixo
 * recusa qualquer venda com mais de R$0,05 de diferença entre os dois.
 * Bug real, reproduzido lendo o código (emissão está desligada no piloto,
 * sem token configurado, então não dava pra reproduzir ao vivo): toda
 * venda com desconto concedido no fechamento -- o caso mais comum de
 * desconto do sistema inteiro -- ficava impossível de emitir nota, com uma
 * mensagem ("total dos itens não bate") que soa erro de dado, não "este
 * tipo de desconto ainda não é suportado".
 *
 * Mesma técnica de `allocateTax` (tax.ts): acumula o bruto até cada linha
 * e arredonda o ACUMULADO, não a fatia isolada -- garante que a soma final
 * bate exato com o desconto pedido e nenhuma linha fica negativa (a
 * diferença entre dois acumulados não decrescentes nunca é negativa).
 */
function money(n: number): number {
  return Math.round(n * 100 + 1e-6) / 100;
}

export function allocateHeaderDiscount(
  items: NfceItemInput[],
  headerDiscount: number,
): NfceItemInput[] {
  if (headerDiscount <= 0 || items.length === 0) return items;
  // Arredonda o bruto de cada linha ANTES de somar/repartir -- não só o
  // resultado -- senão a soma dos totais de saída (cada um já arredondado
  // pra centavo) pode ficar 1-2 centavos longe de `somaOriginal - desconto`
  // quando o bruto em si não é um valor de dinheiro "redondo" (mesma razão
  // de `allocateTax`/`money` em tax.ts).
  const gross = items.map((i) => money(Math.max(0, i.total)));
  const totalGross = money(gross.reduce((a, n) => a + n, 0));
  if (totalGross <= 0) return items;
  // Nunca repartir mais do que existe pra descontar -- defensivo; na
  // prática `checkoutFn` já impede `sales.discount > subtotal`.
  const capped = Math.min(money(headerDiscount), totalGross);
  let cumGross = 0;
  let prevShare = 0;
  return items.map((item, i) => {
    const last = i === items.length - 1;
    cumGross += gross[i]!;
    const cumShare = last ? capped : money((capped * cumGross) / totalGross);
    const share = money(cumShare - prevShare);
    prevShare = cumShare;
    return {
      ...item,
      total: money(gross[i]! - share),
      discount: money(item.discount + share),
    };
  });
}

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
  env: NfceEnv;
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
  if (!input.emitter.cnpj) errors.push("Configure o CNPJ da empresa em Configurações.");
  if (!input.emitter.ie) errors.push("Configure a Inscrição Estadual da empresa em Configurações.");
  if (!input.items.length) errors.push("Venda sem itens.");
  for (const item of input.items) {
    if (!item.ncm) errors.push(`Produto "${item.description}" sem NCM cadastrado.`);
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
    cnpj_emitente: input.emitter.cnpj,
    ...(input.buyer.document
      ? {
          ...(input.buyer.document.length > 11
            ? { cnpj_destinatario: input.buyer.document }
            : { cpf_destinatario: input.buyer.document }),
          nome_destinatario: input.env === "homologacao"
            ? HOMOLOGATION_BUYER_NAME
            : (input.buyer.name ?? undefined),
        }
      : {}),
    items: input.items.map((item, i) => ({
      numero_item: i + 1,
      codigo_produto: String(i + 1),
      descricao: item.description.slice(0, 120),
      ncm: item.ncm,
      cfop: item.cfop,
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
