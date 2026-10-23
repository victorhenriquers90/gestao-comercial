import type { ReceiptCompany, ReceiptData } from "@/components/receipt";
import type { PaymentMethod } from "@/lib/constants";
import { MAX_CREDIARIO_INSTALLMENTS, splitCrediario } from "@/lib/crediario";
import { formatBRL } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import type { searchPosFn } from "@/lib/server/catalog";
import type { getSettingsFn } from "@/lib/server/session";

/**
 * A acao principal da tela: mesma peca no cupom e no pagamento. Hover usa o
 * mesmo levantar+shadow-pop+brilho que todo botao primario ganhou (Button) --
 * um anel proprio so neste botao foi cogitado e descartado: a camada
 * `utilities` do Tailwind (onde `hover:shadow-pop` mora) nao deixa uma regra
 * solta de CSS se somar a ela de forma confiavel, e um tratamento igual ao
 * resto dos botoes primarios e mais consistente mesmo.
 */
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

/**
 * Monta os dados da empresa do recibo a partir das configuracoes — mesma
 * funcao pro PDV desktop e tablet.
 *
 * `sale` e o retrato CONGELADO que `checkoutFn` devolve (ver `ReceiptData`
 * em receipt.tsx) -- preferido sempre que existir, mesma regra de
 * `receiptCompany` em vendas.tsx (migration 0035). Sem isto, reabrir "ver
 * ultima venda" no PDV depois que alguem editou cabecalho/rodape/mensagem
 * em Configuracoes mostrava o texto NOVO, nao o que foi impresso de
 * verdade na hora da venda.
 */
export function receiptCompany(
  settings: Awaited<ReturnType<typeof getSettingsFn>> | undefined,
  sale?: ReceiptData | null,
): ReceiptCompany {
  const company = (settings?.company ?? {}) as ReceiptCompany;
  const extra = (settings?.settings ?? {}) as Record<string, unknown>;
  const live = {
    print_header: extra.print_header != null ? String(extra.print_header) : company.print_header,
    print_footer: extra.print_footer != null ? String(extra.print_footer) : company.print_footer,
    receipt_message:
      extra.receipt_message != null ? String(extra.receipt_message) : company.receipt_message,
  };
  return {
    ...company,
    print_header: sale?.print_header != null ? sale.print_header : live.print_header,
    print_footer: sale?.print_footer != null ? sale.print_footer : live.print_footer,
    receipt_message: sale?.receipt_message != null ? sale.receipt_message : live.receipt_message,
  };
}
