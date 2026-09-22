/**
 * Cancelamento de NFC-e e a divergencia que sobra quando ele nao e possivel.
 *
 * O QUE ESTAVA ERRADO
 *
 * Cancelar a venda estornava estoque, comissao e recebivel -- e nao tocava
 * na nota. Devolucao parcial, idem. Resultado: nota fiscal AUTORIZADA para
 * uma venda que nao existe mais, valendo para o SEFAZ, com imposto apurado
 * em cima dela. O lado do dinheiro fechava e o lado fiscal ficava mentindo,
 * em silencio.
 *
 * O QUE ESTE MODULO NAO RESOLVE, E DIZ QUE NAO RESOLVE
 *
 * Passada a janela de cancelamento, o conserto nao e cancelar: e emitir uma
 * NF-e DE DEVOLUCAO (modelo 55, entrada, referenciando a chave original) --
 * outro documento, que este sistema nao emite. Devolucao PARCIAL tambem nao
 * se resolve com cancelamento, porque a venda aconteceu de verdade, so que
 * menor.
 *
 * Nos dois casos o sistema registra uma PENDENCIA FISCAL explicita em vez de
 * fingir que resolveu. Uma divergencia que aparece na tela e um problema; a
 * mesma divergencia invisivel e um problema que so aparece na fiscalizacao.
 */

/**
 * Prazo de cancelamento da NFC-e, em minutos.
 *
 * 30 minutos e o que a documentacao da Focus NFe declara ("A NFC-e pode ser
 * cancelada em ate 30 minutos apos a emissao"). Alguns estados sao mais
 * restritos que o teto nacional, entao este numero serve pra AVISAR, nunca
 * pra bloquear: quem decide se ainda da tempo e o SEFAZ, e uma recusa dele
 * com motivo e mais util que uma recusa nossa baseada num prazo que pode nao
 * valer aqui.
 */
export const NFCE_CANCEL_WINDOW_MINUTES = 30;

/** Minimo e maximo que o SEFAZ aceita na justificativa de cancelamento. */
export const CANCEL_REASON_MIN = 15;
export const CANCEL_REASON_MAX = 255;

/**
 * Justificativa do cancelamento.
 *
 * O minimo de 15 caracteres e regra do SEFAZ, nao capricho nosso -- e por
 * isso nao da pra reaproveitar o motivo do cancelamento da venda ("desistiu"
 * tem 8). Completar com espacos ou repetir texto pra alcancar o tamanho
 * passaria na validacao e produziria uma justificativa fiscal vazia de
 * conteudo, que e exatamente o que a regra existe pra impedir.
 */
export function parseCancelReason(raw: unknown): string {
  const texto = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (texto.length < CANCEL_REASON_MIN) {
    throw new Error(
      `A justificativa vai para o SEFAZ e precisa de pelo menos ${CANCEL_REASON_MIN} caracteres (tem ${texto.length}).`,
    );
  }
  return texto.slice(0, CANCEL_REASON_MAX);
}

export type CancelWindow = {
  minutosDecorridos: number;
  minutosRestantes: number;
  /** Provavelmente fora do prazo -- aviso, nao bloqueio. */
  provavelmenteExpirado: boolean;
};

export function cancelWindow(authorizedAt: string | null, now: Date = new Date()): CancelWindow {
  if (!authorizedAt) {
    return { minutosDecorridos: 0, minutosRestantes: NFCE_CANCEL_WINDOW_MINUTES, provavelmenteExpirado: false };
  }
  const t = new Date(authorizedAt).getTime();
  if (!Number.isFinite(t)) {
    // Data ilegivel nao pode virar "expirado" nem "no prazo" por acidente:
    // no prazo e o lado que deixa o usuario TENTAR, e quem decide e o SEFAZ.
    return { minutosDecorridos: 0, minutosRestantes: NFCE_CANCEL_WINDOW_MINUTES, provavelmenteExpirado: false };
  }
  const decorridos = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  return {
    minutosDecorridos: decorridos,
    minutosRestantes: Math.max(0, NFCE_CANCEL_WINDOW_MINUTES - decorridos),
    provavelmenteExpirado: decorridos >= NFCE_CANCEL_WINDOW_MINUTES,
  };
}

export type PendenciaKind =
  | "cancelamento_falhou"
  | "devolucao_parcial"
  | "fora_do_prazo"
  | "cancelar_nota";

/**
 * Qual pendência uma devolução deixa.
 *
 * Devolução TOTAL dentro do prazo é o único caso com conserto simples:
 * a venda inteira voltou, então cancelar a nota é exatamente certo.
 * Parcial não -- a venda aconteceu, só que por um valor menor, e
 * cancelar apagaria uma operação que existiu. Fora do prazo, nem uma
 * nem outra: só NF-e de devolução.
 */
export function pendenciaForReturn(
  kind: "total" | "parcial" | "troca",
  expirado: boolean,
): PendenciaKind {
  if (kind !== "total") return "devolucao_parcial";
  return expirado ? "fora_do_prazo" : "cancelar_nota";
}

/**
 * Texto da pendencia fiscal -- o que ficou torto e o que fazer.
 *
 * Escrito pra quem vai levar isso ao contador, nao pra quem escreveu o
 * codigo: "nota valida para venda cancelada" e o fato, e o proximo passo
 * vem junto porque sem ele a pendencia vira so um alerta que ninguem sabe
 * resolver.
 */
export function pendenciaText(kind: PendenciaKind, detalhe?: string): string {
  const base = {
    cancelamento_falhou:
      "A venda foi cancelada, mas a NFC-e continua autorizada: o cancelamento no SEFAZ falhou.",
    fora_do_prazo:
      "A venda foi cancelada fora do prazo de cancelamento da NFC-e, então a nota continua autorizada.",
    cancelar_nota:
      // Serve pro cancelamento e pra devolucao total: nos dois a venda deixou
      // de existir e a nota nao.
      "A venda não existe mais e a NFC-e continua autorizada.",
    devolucao_parcial:
      "Houve devolução parcial de uma venda com NFC-e autorizada. Cancelar a nota não serve: a venda aconteceu, só que por um valor menor.",
  }[kind];
  if (kind === "cancelar_nota") {
    return detalhe
      ? `${base} Cancele a nota — ainda está no prazo. ${detalhe}`
      : `${base} Cancele a nota — ainda está no prazo.`;
  }
  const saida =
    kind === "devolucao_parcial" || kind === "fora_do_prazo"
      ? " O acerto é uma NF-e de devolução (modelo 55, entrada, referenciando a chave original), que este sistema não emite — leve ao contador."
      : " Tente cancelar de novo; se o prazo já tiver passado, o acerto é uma NF-e de devolução, que este sistema não emite.";
  return detalhe ? `${base}${saida} Retorno do SEFAZ: ${detalhe}` : `${base}${saida}`;
}
