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
