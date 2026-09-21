import { CARD_BRANDS } from "./constants.ts";
import { splitInstallments } from "./installments.ts";

/**
 * Cartao: taxa da maquininha, prazo de recebimento e validacao dos campos
 * que vem do PDV.
 *
 * O problema que isto resolve: ate aqui, uma venda de R$ 1.000 no credito
 * entrava no sistema como R$ 1.000 disponiveis na hora. Na loja real sao
 * uns R$ 970 daqui a 30 dias -- e parcelado, sao N pedacos chegando mes a
 * mes. So o crediario virava conta a receber; cartao era tratado como
 * dinheiro a vista, entao o "Saldo financeiro" e o "Lucro" do painel
 * ficavam otimistas por construcao.
 *
 * Cartao passa a se comportar como o crediario, que ja e o modelo que
 * funciona nesta base: gera conta a receber (pelo LIQUIDO, que e o que a
 * adquirente deposita) com a data em que o dinheiro realmente cai.
 */

export const CARD_METHODS = ["debito", "credito"] as const;
export type CardMethod = (typeof CARD_METHODS)[number];

export function isCardMethod(method: string): method is CardMethod {
  return (CARD_METHODS as readonly string[]).includes(method);
}

/** Teto de parcelas aceito. Acima disto nao e mais venda de loja. */
export const MAX_INSTALLMENTS = 18;

export type CardRate = {
  method: CardMethod;
  /** null = vale para qualquer bandeira (regra geral da loja). */
  brand: string | null;
  minInstallments: number;
  maxInstallments: number;
  /** Percentual retido pela adquirente. */
  feePct: number;
  /** Dias ate a PRIMEIRA parcela cair na conta. */
  settlementDays: number;
};

/**
 * Escolhe a regra aplicavel. Regra com bandeira especifica ganha da regra
 * geral -- e assim que a loja negocia: uma taxa padrao e uma diferente para
 * a bandeira que cobra mais.
 */
export function pickCardRate(
  rates: CardRate[],
  method: CardMethod,
  brand: string | null,
  installments: number,
): CardRate | null {
  const candidatas = rates.filter(
    (r) =>
      r.method === method &&
      installments >= r.minInstallments &&
      installments <= r.maxInstallments &&
      (r.brand == null || (brand != null && r.brand.toLowerCase() === brand.toLowerCase())),
  );
  if (candidatas.length === 0) return null;
  // Bandeira especifica primeiro; entre iguais, a faixa mais estreita, que e
  // a mais especifica ("credito 2x a 6x" ganha de "credito 1x a 18x").
  candidatas.sort((a, b) => {
    const especificaA = a.brand == null ? 1 : 0;
    const especificaB = b.brand == null ? 1 : 0;
    if (especificaA !== especificaB) return especificaA - especificaB;
    return a.maxInstallments - a.minInstallments - (b.maxInstallments - b.minInstallments);
  });
  return candidatas[0]!;
}

/**
 * Usado quando a loja ainda nao cadastrou taxa nenhuma.
 *
 * A taxa e ZERO de proposito: o percentual que a adquirente cobra e
 * negociado loja a loja, e chutar um numero aqui inventaria uma despesa que
 * ninguem conferiu -- pior que nao ter. Ja o PRAZO nao e opiniao: debito cai
 * no dia seguinte e credito em 30 dias, e isso vale pra qualquer loja. Entao
 * o padrao ja corrige o erro principal (dinheiro de cartao aparecer como
 * disponivel na hora) sem afirmar nada sobre o quanto a loja paga.
 */
export const DEFAULT_CARD_RATES: Record<CardMethod, { feePct: number; settlementDays: number }> = {
  debito: { feePct: 0, settlementDays: 1 },
  credito: { feePct: 0, settlementDays: 30 },
};

/** Como pickCardRate, mas sempre devolve algo aplicavel. */
export function resolveCardRate(
  rates: CardRate[],
  method: CardMethod,
  brand: string | null,
  installments: number,
): { feePct: number; settlementDays: number; configured: boolean } {
  const achada = pickCardRate(rates, method, brand, installments);
  if (achada) {
    return { feePct: achada.feePct, settlementDays: achada.settlementDays, configured: true };
  }
  return { ...DEFAULT_CARD_RATES[method], configured: false };
}

export type CardSettlement = {
  /** Valor bruto cobrado do cliente. */
  gross: number;
  /** Retido pela adquirente. */
  fee: number;
  /** O que a loja efetivamente recebe. */
  net: number;
  feePct: number;
  /** Uma entrada por parcela, na ordem em que caem. */
  installments: { number: number; amount: number; dueDate: string }[];
};

/**
 * Quebra o pagamento no cartao nas parcelas que a adquirente vai depositar.
 *
 * A soma das parcelas fecha exatamente com o liquido: a sobra dos
 * arredondamentos vai toda na PRIMEIRA parcela, nao espalhada. Espalhar
 * centavo por centavo faria a conferencia contra o extrato virar cacada ao
 * centavo; concentrar deixa N-1 parcelas redondas e uma unica diferente.
 */
export function splitCardSettlement(args: {
  gross: number;
  feePct: number;
  settlementDays: number;
  installments: number;
  soldAt: Date;
}): CardSettlement {
  const gross = round2(args.gross);
  const fee = round2((gross * args.feePct) / 100);
  const net = round2(gross - fee);

  // Mesma regra de arredondamento do crediario (src/lib/installments.ts):
  // duas implementacoes iam divergir no centavo, e "por que a soma das
  // parcelas nao bate com a venda" e pergunta que ninguem responde depois.
  // Primeira parcela em settlementDays; as seguintes de 30 em 30, que e como
  // a adquirente repassa.
  const installments = splitInstallments({
    total: net,
    count: args.installments,
    firstDueInDays: args.settlementDays,
    stepDays: 30,
    from: args.soldAt,
  });
  return { gross, fee, net, feePct: args.feePct, installments };
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/* --------------------------------------------------------------------- */
/* Validacao do que chega do PDV                                          */
/* --------------------------------------------------------------------- */

/**
 * Parcelas. Debito nunca parcela -- e o PDV nem mostra o campo, mas quem
 * chama o servidor direto mostra o que quiser.
 */
export function parseInstallments(value: unknown, method: string): number {
  const bruto = value == null || value === "" ? 1 : Number(value);
  if (!Number.isInteger(bruto) || bruto < 1) {
    throw new Error("Número de parcelas inválido.");
  }
  if (method !== "credito" && bruto !== 1) {
    throw new Error("Só o cartão de crédito aceita parcelamento.");
  }
  if (bruto > MAX_INSTALLMENTS) {
    throw new Error(`Máximo de ${MAX_INSTALLMENTS} parcelas.`);
  }
  return bruto;
}

/**
 * Bandeira. So faz sentido em cartao, e precisa ser uma da lista: bandeira
 * livre quebra a conferencia contra o extrato da adquirente, que e o unico
 * motivo de guardar este campo.
 */
export function parseCardBrand(value: unknown, method: string): string | null {
  const texto = typeof value === "string" ? value.trim() : "";
  if (!isCardMethod(method)) return null;
  if (!texto) throw new Error("Informe a bandeira do cartão.");
  const achada = CARD_BRANDS.find((b) => b.toLowerCase() === texto.toLowerCase());
  if (!achada) throw new Error(`Bandeira inválida: ${texto}`);
  return achada;
}

/** Prazo maximo aceito: acima disto e erro de digitacao, nao negociacao. */
export const MAX_SETTLEMENT_DAYS = 180;

/**
 * Valida uma linha de taxa vinda da tela de configuracao.
 *
 * Importa mais que uma validacao comum de formulario: estes numeros entram
 * no calculo do que a loja TEM A RECEBER. Uma taxa digitada errada nao da
 * erro em lugar nenhum -- so faz o financeiro mentir daqui pra frente.
 */
export function parseCardRate(input: {
  method: unknown;
  brand: unknown;
  minInstallments: unknown;
  maxInstallments: unknown;
  feePct: unknown;
  settlementDays: unknown;
}): CardRate {
  const method = String(input.method ?? "");
  if (!isCardMethod(method)) throw new Error("Escolha débito ou crédito.");

  const brandTexto = typeof input.brand === "string" ? input.brand.trim() : "";
  let brand: string | null = null;
  if (brandTexto) {
    const achada = CARD_BRANDS.find((b) => b.toLowerCase() === brandTexto.toLowerCase());
    if (!achada) throw new Error(`Bandeira inválida: ${brandTexto}`);
    brand = achada;
  }

  const min = Number(input.minInstallments);
  const max = Number(input.maxInstallments);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    throw new Error("Faixa de parcelas inválida.");
  }
  if (max > MAX_INSTALLMENTS) throw new Error(`Máximo de ${MAX_INSTALLMENTS} parcelas.`);
  if (method === "debito" && max !== 1) {
    throw new Error("Débito não parcela: a faixa precisa ser 1 a 1.");
  }

  const feePct = Number(input.feePct);
  if (!Number.isFinite(feePct) || feePct < 0 || feePct >= 100) {
    throw new Error("Taxa inválida (0 a 99,99%).");
  }

  const settlementDays = Number(input.settlementDays);
  if (!Number.isInteger(settlementDays) || settlementDays < 0 || settlementDays > MAX_SETTLEMENT_DAYS) {
    throw new Error(`Prazo inválido (0 a ${MAX_SETTLEMENT_DAYS} dias).`);
  }

  return { method, brand, minInstallments: min, maxInstallments: max, feePct, settlementDays };
}

/**
 * NSU / codigo de autorizacao impresso no comprovante da maquininha.
 * Opcional: a venda nao pode travar porque a maquininha nao imprimiu, mas
 * quando vier tem que ser algo conferivel -- so letras, numeros e hifen.
 */
export function parseNsu(value: unknown): string | null {
  const texto = typeof value === "string" ? value.trim() : "";
  if (!texto) return null;
  if (texto.length > 32) throw new Error("NSU muito longo.");
  if (!/^[A-Za-z0-9-]+$/.test(texto)) {
    throw new Error("NSU deve ter apenas letras, números e hífen.");
  }
  return texto.toUpperCase();
}
