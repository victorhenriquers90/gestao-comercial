/**
 * Leitura de valor em dinheiro DIGITADO por uma pessoa, em pt-BR.
 *
 * Separado de `num()` de proposito, e a diferenca importa: `num()` le valor
 * que veio do BANCO ("1234.56", ponto decimal) e devolve 0 pro que nao
 * entende. Texto de gente e outro idioma -- no balcao se digita "50,00" --
 * e `Number("50,00")` e NaN, que `num()` transforma em ZERO silencioso.
 *
 * Era assim que o PDV trocava a forma de pagamento sozinho: o operador
 * escolhia credito e digitava "50,00", o valor virava 0, o pagamento era
 * descartado por ser zero, e o checkout caia no caminho "sem pagamento
 * informado" -- que registra a venda inteira em DINHEIRO. O caixa passava a
 * esperar um dinheiro que nunca entrou na gaveta, e a diferenca aparecia no
 * fechamento como se fosse falta do operador.
 *
 * Devolve NaN (nao 0) pro que nao da pra ler: quem chama tem que decidir o
 * que fazer com "nao entendi", e zero e uma resposta perigosa demais pra ser
 * o padrao de um campo de dinheiro.
 */
export function parseMoneyInput(texto: unknown): number {
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : Number.NaN;
  if (typeof texto !== "string") return Number.NaN;

  // Tira espacos. A classe de espaco do JS ja inclui o nao-separavel (U+00A0),
  // que e o que vem ao colar de planilha; depois moeda e sinal de positivo.
  const limpo = texto.replace(/[\sR$+]/g, "");
  if (!limpo) return Number.NaN;

  let normalizado: string;
  if (limpo.includes(",")) {
    // Tem virgula: ela e o separador decimal, e o ponto e milhar.
    // "1.234,56" -> "1234.56"
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    // So ponto. Ambiguo entre decimal ("50.00") e milhar ("1.234"), e a
    // desambiguacao pelo formato e a unica disponivel: ponto seguido de
    // exatamente 3 digitos, aparecendo mais de uma vez ou com outro digito
    // depois, so faz sentido como milhar.
    normalizado = /^-?\d{1,3}(\.\d{3})+$/.test(limpo) ? limpo.replace(/\./g, "") : limpo;
  }

  // Nao aceita nada alem de numero: "12abc" viraria 12 num parseFloat.
  if (!/^-?\d*\.?\d+$/.test(normalizado)) return Number.NaN;

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Como `parseMoneyInput`, mas exige valor positivo. Lanca com a mensagem dada. */
export function requireMoneyInput(texto: unknown, mensagem: string): number {
  const n = parseMoneyInput(texto);
  if (!Number.isFinite(n) || n <= 0) throw new Error(mensagem);
  return n;
}
