/**
 * Pre-checagem de emissao de NFC-e.
 *
 * O QUE ESTAVA ERRADO
 *
 * A unica validacao fiscal que existia (`validateNfceReadiness`) roda POR
 * VENDA, na hora de emitir. Quer dizer: o lojista descobre que falta o NCM
 * de um produto com o cliente na frente do balcao, uma venda de cada vez, 48
 * vezes. E os bloqueios que nao sao por venda -- CNPJ, Inscricao Estadual,
 * token, certificado -- ele so descobre depois de passar por todos os
 * outros.
 *
 * Aqui a pergunta e outra: "hoje, a loja consegue emitir?" -- respondida uma
 * vez, antes da primeira venda, com a lista inteira do que falta.
 *
 * DENTRO E FORA
 *
 * Cada bloqueio diz de quem e. `sistema` se resolve nesta tela ou em
 * Produtos; `fora` depende de contratar a Focus NFe, comprar certificado
 * digital A1 e cadastrar o CNPJ no painel deles. Misturar os dois faria a
 * lista parecer uma fila de tarefas do lojista quando metade dela nao esta
 * no sistema -- e ele ficaria preenchendo campo achando que ia emitir no fim.
 */

export type BlockerScope = "sistema" | "fora";

export type Blocker = {
  id: string;
  label: string;
  detail: string;
  scope: BlockerScope;
};

export type ReadinessInput = {
  /** FOCUS_NFE_TOKEN presente no servidor. */
  tokenPresent: boolean;
  env: "homologacao" | "producao";
  /** Emissao ligada nas configuracoes da empresa. */
  enabled: boolean;
  hasCnpj: boolean;
  hasIe: boolean;
  produtosTotal: number;
  produtosSemNcm: number;
};

export function nfceBlockers(input: ReadinessInput): Blocker[] {
  const out: Blocker[] = [];

  if (!input.tokenPresent) {
    out.push({
      id: "token",
      label: "Credencial da Focus NFe não configurada no servidor",
      detail:
        "Depende de contratar a Focus NFe, ter certificado digital A1 do CNPJ e cadastrar o CNPJ no painel deles. " +
        "Com o token em mãos, ele entra como variável de ambiente FOCUS_NFE_TOKEN na máquina do servidor.",
      scope: "fora",
    });
  }

  if (!input.hasCnpj) {
    out.push({
      id: "cnpj",
      label: "CNPJ da empresa não cadastrado",
      detail: "Configurações → Empresa. É o emitente da nota; sem ele nenhuma nota sai.",
      scope: "sistema",
    });
  }

  if (!input.hasIe) {
    out.push({
      id: "ie",
      label: "Inscrição Estadual não cadastrada",
      detail: "Configurações → Empresa. A NFC-e é um documento estadual e a IE é obrigatória.",
      scope: "sistema",
    });
  }

  if (input.produtosSemNcm > 0) {
    const todos = input.produtosSemNcm === input.produtosTotal;
    out.push({
      id: "ncm",
      label: `${input.produtosSemNcm} produto(s) sem NCM`,
      detail:
        (todos
          ? "Nenhum produto tem classificação fiscal cadastrada. "
          : "Vendas que incluírem esses produtos serão recusadas na emissão. ") +
        "O NCM certo de cada peça é o contador quem diz — não há default seguro para inventar aqui.",
      scope: "sistema",
    });
  }

  if (!input.enabled) {
    out.push({
      id: "enabled",
      label: "Emissão desligada nas configurações",
      detail: "Com isto desligado, a ação de emitir nem aparece na tela de vendas.",
      scope: "sistema",
    });
  }

  return out;
}

/**
 * Ambiente de homologacao NAO e um bloqueio -- e o lugar certo pra testar
 * antes de valer. Mas e um AVISO que precisa sobreviver a lista de
 * pendencias: com tudo verde e o ambiente em homologacao, o sistema emite,
 * responde "autorizado", gera chave e DANFE, e nada daquilo tem valor
 * fiscal. E o unico estado em que a tela parece certa e esta errada.
 */
export function homologationWarning(input: ReadinessInput): string | null {
  if (input.env !== "homologacao") return null;
  return input.tokenPresent
    ? "As notas emitidas agora são de TESTE: saem autorizadas, com chave e DANFE, e não valem nada. " +
        "Para valer, o servidor precisa de FOCUS_NFE_ENV=producao com um token de produção."
    : "Quando a credencial for configurada, o ambiente padrão é homologação (teste). " +
        "Produção só entra com FOCUS_NFE_ENV=producao definido explicitamente.";
}

/** Pronto pra emitir nota com valor fiscal. */
export function canEmitForReal(input: ReadinessInput): boolean {
  return nfceBlockers(input).length === 0 && input.env === "producao";
}
