import { splitInstallments, type Installment } from "./installments.ts";

/**
 * Crediario: o fiado da loja, parcelado.
 *
 * Ate aqui o sistema gravava SEMPRE uma unica parcela vencendo em 30 dias,
 * independente do combinado no balcao. Crediario de loja brasileira e "3x",
 * "5x sem juros" -- e o carne do cliente tem uma linha por mes. Com uma
 * parcela so, o financeiro mostrava um titulo gordo numa data que nunca foi
 * a combinada, e a cobranca mes a mes virava controle no caderno.
 *
 * O sistema ja sabia parcelar -- e o que o cartao faz desde a rodada
 * passada. Faltava justamente onde a loja mais usa.
 */

/** Teto de parcelas do crediario. Acima disto nao e mais fiado de loja. */
export const MAX_CREDIARIO_INSTALLMENTS = 12;

/** Dias ate a primeira parcela. O costume da loja e "pra mes que vem". */
export const CREDIARIO_FIRST_DUE_DAYS = 30;

export function parseCrediarioInstallments(value: unknown): number {
  const n = value == null || value === "" ? 1 : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Número de parcelas do crediário inválido.");
  }
  if (n > MAX_CREDIARIO_INSTALLMENTS) {
    throw new Error(`Crediário aceita no máximo ${MAX_CREDIARIO_INSTALLMENTS} parcelas.`);
  }
  return n;
}

export function splitCrediario(total: number, count: number, from: Date): Installment[] {
  return splitInstallments({
    total,
    count,
    firstDueInDays: CREDIARIO_FIRST_DUE_DAYS,
    stepDays: 30,
    from,
  });
}

export type CreditCheck =
  | { ok: true; limite: number; emAberto: number; disponivel: number }
  | { ok: false; motivo: string; limite: number; emAberto: number; disponivel: number };

/**
 * Confere se o cliente cabe no proprio limite de credito.
 *
 * O campo `credit_limit` existia no cadastro, aparecia na ficha do cliente
 * e NUNCA era olhado numa venda -- dava pra vender 5 mil no crediario pra
 * quem tem limite de 500. Um controle que existe na tela e nao existe no
 * servidor e pior que nao ter: o lojista acredita que esta protegido.
 *
 * `limite = 0` significa "nao configurado", nao "credito zero". E o que a
 * ficha do cliente ja assume (ela so mostra o limite quando ele e maior que
 * zero), e tratar 0 como bloqueio impediria crediario em toda loja que
 * nunca preencheu o campo -- quebrar o que funciona hoje pra estrear um
 * controle seria a troca errada.
 */
export function checkCreditLimit(args: {
  limite: number;
  /** Soma do que o cliente ja deve (titulos pendentes/parciais). */
  emAberto: number;
  /** Valor do crediario desta venda. */
  novo: number;
}): CreditCheck {
  const limite = Number(args.limite) || 0;
  const emAberto = Number(args.emAberto) || 0;
  const novo = Number(args.novo) || 0;
  const disponivel = Math.max(0, limite - emAberto);

  if (limite <= 0) {
    return { ok: true, limite: 0, emAberto, disponivel: 0 };
  }
  // Tolerancia de um centavo: o limite e um numero redondo definido por
  // gente, e reprovar por diferenca de arredondamento seria ruido.
  if (emAberto + novo > limite + 0.009) {
    return {
      ok: false,
      motivo:
        disponivel > 0
          ? `Limite de crédito excedido. Disponível: ${brl(disponivel)} (limite ${brl(limite)}, em aberto ${brl(emAberto)}).`
          : `Cliente sem limite disponível (limite ${brl(limite)}, em aberto ${brl(emAberto)}).`,
      limite,
      emAberto,
      disponivel,
    };
  }
  return { ok: true, limite, emAberto, disponivel };
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
