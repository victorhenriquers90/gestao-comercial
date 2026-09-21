/**
 * Sugestao de compra: o que repor, quanto, e pra quem pedir.
 *
 * O estoque minimo ja estava cadastrado e o painel ja apontava "Estoque
 * baixo" -- mas ninguem transformava isso em pedido. A lista de alerta
 * respondia "o que esta acabando"; faltava responder "quanto comprar".
 *
 * A conta nao e `minimo - saldo`. Repor ate o minimo deixa a loja NO
 * minimo, e o alerta dispara de novo na semana seguinte: e comprar sempre
 * correndo atras. A sugestao cobre um periodo de venda -- quanto essa peca
 * sai por dia, vezes os dias que se quer ter na prateleira.
 */

export type SuggestionInput = {
  /** Saldo atual na loja. */
  saldo: number;
  /** Maior entre o minimo da loja e o do produto. */
  minimo: number;
  /** Media de saida por dia, calculada na janela de historico. */
  consumoDiario: number;
  /** Dias de venda que se quer ter em estoque. */
  coberturaDias: number;
};

export type Suggestion = {
  /** Quanto comprar. Zero significa que nao precisa. */
  quantidade: number;
  /** Nivel que a compra pretende atingir. */
  alvo: number;
  /** Em quantos dias o saldo ATUAL acaba no ritmo de venda. */
  diasDeCobertura: number | null;
  /** Por que entrou na lista. */
  motivo: "abaixo-do-minimo" | "cobertura-curta" | null;
};

export function suggestQuantity(input: SuggestionInput): Suggestion {
  const saldo = finito(input.saldo);
  const minimo = Math.max(0, finito(input.minimo));
  const consumo = Math.max(0, finito(input.consumoDiario));
  const dias = Math.max(0, finito(input.coberturaDias));

  /*
    O alvo e o MAIOR entre o minimo cadastrado e o consumo do periodo.

    Os dois sao necessarios: sem o minimo, uma peca de giro baixissimo (uma
    venda por trimestre) nunca seria reposta e sumiria da loja; sem o
    consumo, uma peca campea de venda seria reposta so ate o minimo e
    acabaria antes do proximo pedido.
  */
  const alvo = Math.max(minimo, consumo * dias);
  const faltando = alvo - saldo;

  // Arredonda pra CIMA: sugerir menos do que falta e nao resolver o
  // problema que motivou a sugestao. Comprar uma peca a mais e barato;
  // faltar de novo em duas semanas, nao.
  const quantidade = faltando > 0 ? Math.ceil(round3(faltando)) : 0;

  const diasDeCobertura = consumo > 0 ? round1(saldo / consumo) : null;
  const motivo =
    quantidade <= 0
      ? null
      : saldo <= minimo && minimo > 0
        ? "abaixo-do-minimo"
        : "cobertura-curta";

  return { quantidade, alvo: round3(alvo), diasDeCobertura, motivo };
}

/**
 * Media de saida por dia.
 *
 * Divide pela JANELA inteira, nao pelos dias em que houve venda: uma peca
 * que vendeu 3 unidades num unico dia do mes nao sai 3 por dia, sai 0,1.
 * Dividir so pelos dias com movimento transformaria qualquer item de giro
 * irregular num campeao de venda e encheria a loja de estoque parado.
 */
export function dailyRate(totalVendido: number, janelaDias: number): number {
  const total = Math.max(0, finito(totalVendido));
  const dias = Math.max(1, Math.trunc(finito(janelaDias)) || 1);
  return round3(total / dias);
}

export function parsePositiveDays(value: unknown, label: string, max = 365): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`Informe ${label} entre 1 e ${max} dias.`);
  }
  return n;
}

function finito(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}

function round1(v: number): number {
  return Math.round((v + Number.EPSILON) * 10) / 10;
}
