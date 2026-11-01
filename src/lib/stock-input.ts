/**
 * Validacao dos numeros que entram no estoque e nas compras.
 *
 * O motivo e especifico e foi medido contra o Postgres real: `NaN` e
 * `Infinity` do JavaScript atravessam o driver e chegam INTACTOS numa coluna
 * `numeric`. Pior, no Postgres `'NaN'::numeric >= 0` e VERDADEIRO (NaN e
 * tratado como maior que qualquer numero), entao a guarda que o
 * applyStockChange ja tinha -- `quantity + delta >= 0` -- deixava um delta
 * NaN passar direto e gravava `quantity = NaN` no inventario. Dali em
 * diante, toda soma, relatorio e alerta de estoque minimo daquele produto
 * vira NaN, e nao ha como reverter pela tela.
 *
 * `data.quantity <= 0` NAO pega esse caso: `NaN <= 0` e `false`.
 *
 * Lembrando o padrao que ja se repetiu nesta base: validacao de tela nao
 * vale pra quem chama o servidor direto.
 */

/** Quantidade movimentada: finita e maior que zero. */
export function parseStockQuantity(value: unknown, label = "quantidade"): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Informe uma ${label} maior que zero.`);
  }
  return n;
}

/**
 * Delta de "Ajuste (define delta)": ao contrario de entrada/saida/perda (cuja
 * direcao ja vem do tipo escolhido, entao so faz sentido pedir magnitude
 * positiva), ajuste existe PRA corrigir contagem pra cima OU pra baixo sem
 * forcar o operador a escolher "perda"/"saida" pra uma diferenca que nao foi
 * venda nem extravio -- so erro de contagem anterior. Antes disto, o valor
 * passava por `parseStockQuantity` (rejeita <=0) igual aos outros tipos, e
 * "define delta" ficava mentiroso: so dava pra ajustar pra cima, igual
 * "Entrada" com outro nome.
 */
export function parseStockDelta(value: unknown, label = "ajuste"): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) {
    throw new Error(`Informe um ${label} diferente de zero.`);
  }
  return n;
}

/**
 * Valor unitario de compra: finito e nao negativo.
 *
 * Zero e legitimo (brinde, bonificacao do fornecedor); negativo nao -- viraria
 * um pedido de compra com total negativo, que o financeiro le como credito.
 */
export function parseUnitCost(value: unknown, label = "custo"): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Informe um ${label} valido (zero ou mais).`);
  }
  return n;
}

/**
 * Frete, imposto e desconto do pedido de compra. Todos entram no total, e
 * um valor nao finito aqui contamina `purchases.total` -- que e o que o
 * financeiro soma depois.
 */
export function parsePurchaseExtra(value: unknown, label: string): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Valor de ${label} invalido.`);
  }
  return n;
}

/**
 * Custo de aterrissagem (landed cost): rateia frete + imposto - desconto do
 * pedido entre os itens recebidos, proporcional ao valor de cada um
 * (quantity * unitCost), e devolve o novo custo unitario de cada item.
 *
 * Antes disto, `receivePurchaseFn` gravava `cost = unit_cost` direto -- o
 * frete entrava certo no que a loja deve ao fornecedor (accounts_payable),
 * mas nunca no custo do produto, entao toda venda futura superestimava a
 * margem ate a proxima compra atualizar o custo. Decisao de metodologia
 * confirmada com o usuario (ver HANDOFF).
 *
 * Rateio por VALOR, nao por quantidade igual: um item de R$500 deveria
 * absorver mais frete que um de R$10 no mesmo pedido. Isto tambem garante
 * matematicamente que nenhum item fica com custo negativo quando ha
 * desconto, desde que o pedido inteiro tenha `total >= 0` (ja garantido por
 * quem grava o pedido): landedCost_i = unitCost_i * (total/subtotal), e
 * total/subtotal nunca e negativo se total nao e.
 *
 * Quando subtotal e zero (pedido so de itens com custo zero -- brinde,
 * bonificacao), nao ha base de valor pra ratear: cai pra rateio igual por
 * quantidade. `Math.max(0, ...)` no final so pega esse caso extremo (extra
 * negativo maior que o que a quantidade suporta) -- custo nunca fica
 * negativo, mesmo invariante que `parseUnitCost` ja cobra na entrada.
 */
export function landedUnitCosts(
  items: readonly { quantity: number; unitCost: number }[],
  extra: number,
): number[] {
  const subtotal = items.reduce((a, i) => a + i.quantity * i.unitCost, 0);
  const totalQty = items.reduce((a, i) => a + i.quantity, 0);
  return items.map((i) => {
    const share = subtotal > 0.009 ? (i.quantity * i.unitCost) / subtotal : totalQty > 0 ? i.quantity / totalQty : 0;
    return Math.max(0, i.unitCost + (extra * share) / i.quantity);
  });
}
