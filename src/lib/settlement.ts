import { formatBRL } from "./format.ts";

/** Folga de centavos: um titulo com R$ 0,03 em aberto conta como quitado. */
export const SETTLEMENT_TOLERANCE = 0.05;

const r2 = (n: number) => Number(n.toFixed(2));

export type SettlementPlan = {
  /** Total ja baixado depois desta baixa. */
  paid: number;
  /** O que o titulo vale a quitar: valor + juros - desconto. */
  target: number;
  /** Saldo em aberto ANTES desta baixa. */
  open: number;
  status: "pago" | "parcial";
};

/**
 * Valida e calcula uma baixa (pagamento ou recebimento) sobre um titulo.
 *
 * Roda dentro da transacao que trava a linha: a validacao do saldo so vale se
 * lida depois do `for update`. Sem ela o servidor aceitava baixar um titulo
 * ja quitado, ou um valor acima do saldo (digitar 1000 em vez de 100), e cada
 * aceite lancava de novo o dinheiro na gaveta.
 */
export function planSettlement(i: {
  amount: number;
  paid: number;
  interest: number;
  discount: number;
  payment: number;
  status: string;
}): SettlementPlan {
  const target = r2(i.amount + i.interest - i.discount);
  const open = r2(target - i.paid);
  if (i.status === "pago") throw new Error("Este título já está quitado.");
  if (target <= 0.009) {
    throw new Error("O desconto cobre o valor inteiro do título. Cancele a conta em vez de dar baixa.");
  }
  if (open <= 0.009) throw new Error("Este título já está quitado.");
  if (i.payment > open + SETTLEMENT_TOLERANCE) {
    throw new Error(`Valor maior que o saldo do título (${formatBRL(open)}).`);
  }
  const paid = r2(i.paid + i.payment);
  return { paid, target, open, status: paid + SETTLEMENT_TOLERANCE >= target ? "pago" : "parcial" };
}

/** Estado do titulo depois de desfazer uma baixa: o total baixado cai e a situacao volta a ser calculada. */
export function planReversal(i: { paid: number; amount: number }): { paid: number; status: "pendente" | "parcial" } {
  const paid = r2(Math.max(0, i.paid - i.amount));
  return { paid, status: paid > 0.009 ? "parcial" : "pendente" };
}
