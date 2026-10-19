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

export type SaleLineLike = { qty: number; sellPrice: number; lineDiscount: number };

export type SaleSummary = {
  /** Preco cheio x quantidade, antes de qualquer desconto. */
  gross: number;
  /** Descontos de promocao, somados das linhas. */
  promo: number;
  /** Bruto menos promocoes -- o "subtotal" que o desconto manual abate. */
  subtotal: number;
  /** Desconto manual (F6) sobre a venda. */
  manual: number;
  total: number;
  /** Quantidade de pecas (soma das quantidades). */
  pieces: number;
  /** Quantidade de linhas (produtos distintos). */
  lines: number;
};

export function summarizeSale(lines: readonly SaleLineLike[], manualDiscount: number): SaleSummary {
  let gross = 0;
  let promo = 0;
  let pieces = 0;
  for (const l of lines) {
    gross += l.sellPrice * l.qty;
    promo += l.lineDiscount;
    pieces += l.qty;
  }
  const subtotal = gross - promo;
  return {
    gross,
    promo,
    subtotal,
    manual: manualDiscount,
    total: Math.max(0, subtotal - manualDiscount),
    pieces,
    lines: lines.length,
  };
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
