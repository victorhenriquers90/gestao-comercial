import { operatorDiscountPct } from "./discount.ts";
import { parseMoneyInput } from "./money-input.ts";

/*
  Contas da tela do PDV, fora do componente pra poderem ser testadas.
  Sao as MESMAS formulas que viviam dentro do pdv.tsx -- a reforma visual
  nao pode mudar um centavo do que vai pro checkoutFn.
*/

/**
 * Valor digitado, para os calculos DA TELA (falta, troco, soma).
 * Ilegivel conta como zero aqui de proposito: e so previa, e o bloqueio de
 * verdade acontece no finish(), com erro nomeando o campo.
 */
export function valorDigitado(texto: string): number {
  const n = parseMoneyInput(texto);
  return Number.isFinite(n) ? n : 0;
}

export type SaleLineLike = {
  qty: number;
  sellPrice: number;
  /** Desconto EFETIVO da linha: promoção + extra manual, até o bruto (ver lineDiscountWithExtra). */
  lineDiscount: number;
  /**
   * Só a parte de promoção, pra separar de um desconto manual por item
   * (botão "Desconto" da coluna, F6 escopo linha). Omitido = sem desconto
   * manual nesta linha, `lineDiscount` é puro promoção (comportamento de
   * antes do desconto por linha existir).
   */
  promoDiscount?: number;
};

export type SaleSummary = {
  /** Preco cheio x quantidade, antes de qualquer desconto. */
  gross: number;
  /** Descontos de promocao, somados das linhas (nunca inclui desconto manual). */
  promo: number;
  /** Bruto menos promocoes -- o "subtotal" que o desconto manual abate. */
  subtotal: number;
  /** Desconto manual: F6 no cabecalho MAIS o manual por linha, somados. */
  manual: number;
  total: number;
  /** Quantidade de pecas (soma das quantidades). */
  pieces: number;
  /** Quantidade de linhas (produtos distintos). */
  lines: number;
};

export function summarizeSale(lines: readonly SaleLineLike[], headerDiscount: number): SaleSummary {
  let gross = 0;
  let promo = 0;
  let lineManual = 0;
  let pieces = 0;
  for (const l of lines) {
    gross += l.sellPrice * l.qty;
    // Sem promoDiscount (chamador antigo, ou linha sem desconto manual): o
    // desconto inteiro da linha e promocao, igual sempre foi.
    const pureza = l.promoDiscount ?? l.lineDiscount;
    promo += pureza;
    lineManual += Math.max(0, l.lineDiscount - pureza);
    pieces += l.qty;
  }
  const subtotal = gross - promo;
  const manual = headerDiscount + lineManual;
  return {
    gross,
    promo,
    subtotal,
    manual,
    total: Math.max(0, subtotal - manual),
    pieces,
    lines: lines.length,
  };
}

/**
 * Desconto efetivo da linha: a promoção MAIS o extra que o operador deu por
 * cima dela, nunca passando do bruto. O extra é o que se digita no diálogo
 * do item, a partir do preço já promocional que aparece no carrinho.
 *
 * O checkoutFn faz `max(item.discount, promoção)` -- como o PDV manda
 * promoção + extra, o max devolve esse mesmo valor e só o extra conta
 * contra o limite do papel. Guardar o EXTRA (e não promoção + extra) na
 * linha importa: a promoção muda com a quantidade ("leve 3"), e o extra
 * do operador tem que continuar por cima dela.
 */
export function lineDiscountWithExtra(lineGross: number, promo: number, extra: number): number {
  return Math.min(lineGross, promo + Math.max(0, extra));
}

/**
 * Percentual de desconto que conta contra o limite do papel, na venda
 * INTEIRA -- a mesma conta do checkoutFn (`operatorDiscountPct`). Os
 * diálogos de desconto (cabeçalho e item) checam com isto, não com o
 * percentual só do escopo deles: checar cada um sozinho deixava passar
 * 10% no item + 10% no cabeçalho num limite de 10% (recusado só no F10) e
 * barrava 50% num item barato que mal mexe no total.
 */
export function operatorPctOf(lines: readonly SaleLineLike[], headerDiscount: number): number {
  const s = summarizeSale(lines, headerDiscount);
  const lineManual = s.manual - headerDiscount;
  return operatorDiscountPct({
    subtotal: s.subtotal - lineManual,
    lineDiscount: lineManual,
    headerDiscount,
  });
}

export type PaymentLike = { method: string; amount: string; received: string };

export type PaymentStatus = {
  paid: number;
  /** Positivo = falta; negativo = pagou a mais (o troco sai do dinheiro). */
  remaining: number;
  change: number;
  /** Alguma forma com valor digitado. Sem isso, o F10 registra em dinheiro. */
  informed: boolean;
};

export function paymentStatus(payments: readonly PaymentLike[], total: number): PaymentStatus {
  const paid = payments.reduce((a, p) => a + valorDigitado(p.amount), 0);
  const cash = payments.find((p) => p.method === "dinheiro");
  return {
    paid,
    remaining: Number((total - paid).toFixed(2)),
    change: cash ? Math.max(0, valorDigitado(cash.received) - valorDigitado(cash.amount)) : 0,
    informed: payments.some((p) => valorDigitado(p.amount) > 0),
  };
}

/**
 * Quantidade digitada na linha do cupom. Aceita "3", "1,5" e "1.5";
 * devolve null pro que nao e quantidade valida (vazio, zero, negativo,
 * texto) -- quem chama mantem o valor anterior em vez de gravar lixo.
 */
export function parseQuantity(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * +1/-1 dos botões de quantidade do carrinho (`QtyStepper`/`TouchQtyStepper`).
 * Dois problemas achados testando com quantidade fracionada (produto por
 * peso/metro): (1) `valor - 1`/`valor + 1` direto em ponto flutuante gera
 * lixo visível no campo pra valores comuns (ex. 1,1 - 1 = 0.10000000000000009,
 * 2,2 - 1 = 1.2000000000000002) -- arredondado aqui pras mesmas 3 casas que
 * `parseQuantity` aceita. (2) o piso de "nunca abaixo de 1" (certo pra
 * produto inteiro, errado pra fracionado) trocava o passo sem avisar perto
 * do limite -- de 1,5 o botão "-" ia pra 1 em vez de 0,5. Decide o piso pelo
 * valor ATUAL: só trata como fracionado (piso quase zero) quando o valor já
 * não é inteiro -- quantidade inteira continua travando em 1 via botão
 * (quem quiser menos que 1 unidade inteira digita direto no campo).
 */
export function stepQty(value: number, delta: 1 | -1): number {
  const floor = Number.isInteger(value) ? 1 : 0.001;
  const next = Math.round((value + delta) * 1000) / 1000;
  return Math.max(floor, next);
}
