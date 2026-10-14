/**
 * Desfazer o recebimento de uma compra -- versao estreita, de proposito.
 *
 * O QUE ESTE MODULO RESOLVE
 *
 * O erro mais comum: clicou "Receber" errado (pedido duplicado, botao
 * errado, confirmou sem olhar) e percebeu na hora. Pra esse caso, uma
 * janela curta -- mesma logica dos 30 minutos de cancelamento de NFC-e
 * (`nfce-cancel.ts`): quanto mais tempo passa, maior a chance de o
 * estoque recebido ja ter sido vendido ou de alguem ja ter pago a conta
 * gerada. Passada a janela, ou se qualquer uma dessas duas coisas ja
 * aconteceu, o desfazer e recusado, nunca forcado -- a trava de estoque
 * e a de pagamento (ver `undoReceivePurchaseFn`, src/lib/server/catalog.ts)
 * sao a garantia de verdade; esta janela e so o primeiro filtro, mais
 * barato de checar.
 *
 * O QUE ESTE MODULO NAO RESOLVE, E DIZ QUE NAO RESOLVE
 *
 * Nao reverte `products.cost`/`product_variants.cost`. Nao existe
 * historico de custo gravado em lugar nenhum -- "reverter" seria inventar
 * um valor, nao recuperar o antigo. O custo fica como o recebimento
 * deixou; se estiver errado, corrija direto em Produtos.
 *
 * Nao resolve pedido recebido ha mais tempo, com a conta a pagar ja paga
 * (nem que seja parcial), ou com o estoque ja mexido por outro motivo --
 * esses casos precisam de ajuste manual (Estoque) e estorno de pagamento
 * (Financeiro), nao de um botao em Compras.
 */

export const PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES = 30;

export type UndoReceiveWindow = {
  ok: boolean;
  motivo?: string;
  minutosDecorridos: number;
  minutosRestantes: number;
};

export function checkUndoReceiveWindow(
  receivedAt: string | null | undefined,
  now: Date = new Date(),
): UndoReceiveWindow {
  if (!receivedAt) {
    return {
      ok: false,
      motivo: "Este pedido não foi recebido.",
      minutosDecorridos: 0,
      minutosRestantes: 0,
    };
  }
  const t = new Date(receivedAt).getTime();
  if (!Number.isFinite(t)) {
    return {
      ok: false,
      motivo: "Data de recebimento inválida.",
      minutosDecorridos: 0,
      minutosRestantes: 0,
    };
  }
  const decorridos = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  const restantes = Math.max(0, PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES - decorridos);
  if (decorridos >= PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES) {
    return {
      ok: false,
      motivo:
        `O prazo de ${PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES} minutos para desfazer o recebimento já passou. ` +
        "Ajuste o estoque manualmente em Estoque.",
      minutosDecorridos: decorridos,
      minutosRestantes: 0,
    };
  }
  return { ok: true, minutosDecorridos: decorridos, minutosRestantes: restantes };
}
