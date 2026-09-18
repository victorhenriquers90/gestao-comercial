/**
 * Percentual de desconto que conta contra o limite do papel.
 *
 * Vive fora do checkout para poder ser testado sozinho: a regra e sutil e ja
 * tinha um furo. A conta antiga era `descontoCabecalho / subtotal`, mas os
 * descontos de linha ja estao DENTRO do subtotal -- entao bastava mandar o
 * desconto no item em vez do cabecalho para o percentual dar zero e o teto
 * nunca disparar.
 *
 * Duas separacoes importam:
 *
 * 1. Promocao nao consome limite. Ela e regra do sistema, nao escolha de quem
 *    esta no caixa; so a parte que o operador concedeu por cima conta.
 * 2. A base e o preco DEPOIS das promocoes -- e sobre ele que o operador
 *    decide dar desconto.
 */
export function operatorDiscountPct(input: {
  /** Soma das linhas ja liquidas de todo desconto. */
  subtotal: number;
  /** Desconto concedido pelo operador nas linhas (fora o da promocao). */
  lineDiscount: number;
  /** Desconto que o operador aplicou no total da venda. */
  headerDiscount: number;
}): number {
  const concedido = input.lineDiscount + input.headerDiscount;
  const base = input.subtotal + input.lineDiscount;
  if (base <= 0) return concedido > 0 ? Infinity : 0;
  return (concedido / base) * 100;
}
