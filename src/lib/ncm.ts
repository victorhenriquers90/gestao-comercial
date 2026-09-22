/**
 * NCM -- classificacao fiscal do produto.
 *
 * O QUE ESTAVA ERRADO
 *
 * O campo entrava por `sanitizeCode(ncm, 8)`, que so corta em 8 caracteres:
 * "abc", "1", "camiseta" viravam NCM valido no banco. O erro nao aparece no
 * cadastro nem no estoque nem na venda -- aparece na RECUSA do SEFAZ, no
 * balcao, com o cliente esperando a nota. Validar aqui e barato; descobrir
 * la e caro.
 *
 * O QUE ESTE MODULO NAO FAZ
 *
 * Nao sugere, nao adivinha e nao tem tabela de "NCM provavel por nome de
 * produto". A classificacao e responsabilidade do contador, e um NCM errado
 * nao da erro: da nota autorizada com imposto errado, que so aparece numa
 * fiscalizacao. Um palpite plausivel aqui seria pior que campo vazio --
 * campo vazio o sistema cobra, palpite ninguem confere.
 */

/** Oito digitos, do jeito que a NF-e exige. */
const NCM_DIGITS = 8;

/**
 * Normaliza o que o contador mandou.
 *
 * Aceita "6109.10.00", "6109 10 00" e "61091000" porque as tres formas
 * chegam por WhatsApp e planilha; o que vai pro banco e sempre so digito.
 * Retorna null pra vazio (campo opcional ate a hora de emitir) e LANCA pra
 * entrada que nao e NCM -- silenciar seria repetir o bug.
 */
export function parseNcm(raw: unknown): string | null {
  if (raw == null) return null;
  const texto = String(raw).trim();
  if (!texto) return null;
  const digitos = texto.replace(/[.\s-]/g, "");
  if (!/^\d+$/.test(digitos)) {
    throw new Error("NCM deve ter só números (ex.: 6109.10.00).");
  }
  if (digitos.length !== NCM_DIGITS) {
    throw new Error(`NCM tem ${NCM_DIGITS} dígitos; recebi ${digitos.length}.`);
  }
  // Nenhum capitulo da NCM e "00": um campo preenchido com zeros e campo em
  // branco disfarcado, e passaria pela checagem de "tem NCM?" do sistema.
  if (digitos === "00000000") throw new Error("NCM inválido.");
  return digitos;
}

/** Como o contador escreve: 6109.10.00. */
export function formatNcm(ncm: string | null | undefined): string {
  const d = String(ncm ?? "").replace(/\D/g, "");
  if (d.length !== NCM_DIGITS) return String(ncm ?? "");
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

/**
 * A MESMA regra de `hasNcm`, em SQL -- e mora aqui colada nela de proposito.
 *
 * As duas existem porque uma tela pergunta produto a produto (JS) e outra
 * conta em massa (SQL). Medido contra o banco: com "abc" gravado num
 * produto, a pre-checagem fiscal usava `btrim(ncm) <> ''` e dizia "nenhuma
 * pendencia" enquanto o painel de NCM dizia "1 pendente". Duas telas
 * discordando sobre o mesmo conceito e como o sistema comeca a mentir --
 * separar as definicoes em arquivos diferentes e o que garante a divergencia
 * mais tarde.
 *
 * O `coalesce` nao e enfeite -- e a armadilha inteira. Sem ele:
 *
 *   NULL ~ '^[0-9]{8}$'  ->  NULL
 *   NULL and ...         ->  NULL
 *   not NULL             ->  NULL   e `filter (where NULL)` NAO conta a linha
 *
 * Ou seja: produto sem NCM nenhum -- o caso mais comum, 100% da loja hoje --
 * escapava da contagem de pendentes, e a pre-checagem fiscal diria "nenhuma
 * pendencia" com o cadastro inteiro em branco. Medido contra o banco: 1
 * pendente pelo SQL contra 11 pelo JS.
 *
 * Use com o nome da coluna ja qualificado quando houver join (`p.ncm`).
 */
export function ncmValidSql(coluna = "ncm"): string {
  const v = `coalesce(${coluna}, '')`;
  return `(${v} ~ '^[0-9]{8}$' and ${v} <> '00000000')`;
}

/** Tem classificacao fiscal utilizavel. */
export function hasNcm(raw: unknown): boolean {
  try {
    return parseNcm(raw) != null;
  } catch {
    return false;
  }
}
