// Extensao explicita porque PAYMENT_METHODS e um valor (nao so tipo): sem ela
// o executor de testes do Node nao resolve o modulo em tempo de execucao.
import { PAYMENT_METHODS, type PaymentMethod } from "./constants.ts";

/**
 * Valida uma forma de pagamento vinda do cliente antes de virar linha em
 * `payments` e `cash_movements`.
 *
 * Isto nao e formalidade: o fechamento de caixa calcula o dinheiro esperado
 * somando os movimentos com `method = 'dinheiro'`. Como method e amount
 * entravam crus, havia dois jeitos de fazer o caixa esperar MENOS dinheiro do
 * que entrou -- e fechar certinho com a diferenca no bolso:
 *
 * 1. Valor negativo. Um `dinheiro` de -500 junto de um `pix` de +600 numa
 *    venda de 100 passa na soma (paySum >= total) e derruba o esperado em 500.
 * 2. Metodo inventado. Registrar dinheiro como "dinheiro " (com espaco) faz a
 *    comparacao com 'dinheiro' falhar, e o valor nao conta como caixa.
 *
 * A conferencia de caixa e o controle que detecta desvio; aceitar esses dois
 * campos sem validar tornava o controle contornavel por quem opera o caixa.
 */
export function parsePaymentMethod(value: string): PaymentMethod {
  const metodo = value.trim().toLowerCase();
  if (!(PAYMENT_METHODS as readonly string[]).includes(metodo)) {
    throw new Error(`Forma de pagamento inválida: ${value}`);
  }
  return metodo as PaymentMethod;
}

/** Valor de um pagamento: finito e positivo. */
export function parsePaymentAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Valor de pagamento inválido.");
  }
  return Number(value.toFixed(2));
}

/**
 * Dinheiro recebido do cliente, para calcular o troco. Nunca menor que o valor
 * pago: recebido a menos nao e troco negativo, e pagamento incompleto.
 */
export function parseReceived(amount: number, received: number | undefined): number {
  if (received == null) return amount;
  if (!Number.isFinite(received)) throw new Error("Valor recebido inválido.");
  if (received + 0.009 < amount) {
    throw new Error("Valor recebido é menor que o valor do pagamento.");
  }
  return Number(received.toFixed(2));
}
