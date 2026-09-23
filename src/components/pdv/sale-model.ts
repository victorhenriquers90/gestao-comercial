import type { PaymentMethod } from "@/lib/constants";
import { MAX_CREDIARIO_INSTALLMENTS, splitCrediario } from "@/lib/crediario";
import { formatBRL } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import type { searchPosFn } from "@/lib/server/catalog";

/** A acao principal da tela: mesma peca no cupom e no pagamento. */
export const PDV_FINISH_CLASS =
  "pdv-finish h-14 w-full justify-start gap-3 rounded-sm px-5 text-base font-semibold [&_svg]:size-5 [@media(max-height:760px)]:h-12";

export type Hit =Awaited<ReturnType<typeof searchPosFn>>[number];
export type Line = Hit & { qty: number; lineDiscount: number; override?: number; promoName?: string | null };
export type PricedLine = Line & { sellPrice: number; lineDiscount: number; promoName: string | null };

export type PayRow = {
  method: PaymentMethod;
  amount: string;
  received: string;
  installments: number;
  brand: string;
  nsu: string;
};

// Bandeira comeca VAZIA, nao em "Visa". Ela existe pra casar a venda com a
// linha do extrato da adquirente; um padrao silencioso gravaria a bandeira
// errada na maioria das vendas e estragaria justamente a conferencia que ela
// serve pra permitir. Melhor o operador escolher.
export const emptyPay = (method: PaymentMethod = "dinheiro"): PayRow => ({
  method,
  amount: "",
  received: "",
  installments: 1,
  brand: "",
  nsu: "",
});

/**
 * "3x de R$ 100,00 · 1ª em 21/10/2026" -- o que o operador fala pro cliente.
 * Usa a MESMA divisao do servidor, entao o que aparece na tela e exatamente
 * o que vai virar carne: nao ha um calculo pro balcao e outro pro banco.
 */
export function resumoCrediario(p: PayRow): string | null {
  const valor = parseMoneyInput(p.amount);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const n = Math.trunc(p.installments);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CREDIARIO_INSTALLMENTS) return null;
  const parcelas = splitCrediario(valor, n, new Date());
  const primeira = parcelas[0]!;
  const [ano, mes, dia] = primeira.dueDate.split("-");
  const quando = `${dia}/${mes}/${ano}`;
  if (parcelas.length === 1) return `Parcela única de ${formatBRL(primeira.amount)} em ${quando}`;
  const iguais = parcelas.slice(1).every((x) => x.amount === parcelas[1]!.amount);
  const corpo = iguais
    ? `${parcelas.length}x de ${formatBRL(parcelas[1]!.amount)}`
    : `${parcelas.length} parcelas`;
  const primeiraDiferente = primeira.amount !== parcelas[1]!.amount;
  return `${corpo}${primeiraDiferente ? ` (a 1ª de ${formatBRL(primeira.amount)})` : ""} · 1ª em ${quando}`;
}
