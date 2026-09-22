/**
 * Classificacao da idade do ultimo backup do banco.
 *
 * A rotina de backup (installer\lib\Backup.ps1) grava um last-backup.json a
 * cada execucao bem-sucedida. Isto existe porque a falha mais perigosa desse
 * tipo de rotina nao e ela quebrar com erro -- e ela parar de rodar e
 * ninguem perceber. "Nao dar erro" e exatamente como o silencio se parece.
 */

export type BackupSeverity = "ok" | "atrasado" | "critico" | "desconhecido";

/**
 * 48h, nao 24h: o backup roda uma vez por dia, mas a maquina da loja fica
 * DESLIGADA fora do horario comercial. Com -StartWhenAvailable a execucao
 * perdida acontece no proximo boot, entao uma loja fechada no domingo
 * legitimamente amanhece a segunda com backup de sabado. Avisar nesse caso
 * seria ensinar o lojista a ignorar o aviso.
 */
export const HORAS_ATE_ATRASADO = 48;

/** Uma semana sem backup nao e mais "a loja ficou fechada" -- e falha. */
export const HORAS_ATE_CRITICO = 24 * 7;

export type BackupStatus = {
  severity: BackupSeverity;
  /** Horas desde o ultimo backup bom, ou null se nunca houve um. */
  ageHours: number | null;
};

export function classifyBackupAge(
  lastBackupAt: string | null | undefined,
  now: Date = new Date(),
): BackupStatus {
  if (!lastBackupAt) return { severity: "desconhecido", ageHours: null };

  const quando = new Date(lastBackupAt);
  if (Number.isNaN(quando.getTime())) {
    return { severity: "desconhecido", ageHours: null };
  }

  const ageHours = (now.getTime() - quando.getTime()) / 3_600_000;

  // Data no futuro: relogio da maquina errado ou arquivo adulterado. Nao da
  // pra afirmar que esta em dia, entao vira "desconhecido" em vez de "ok" --
  // um relogio adiantado nao pode virar um atestado de saude.
  if (ageHours < -1) return { severity: "desconhecido", ageHours: null };

  const idade = Math.max(0, ageHours);
  if (idade >= HORAS_ATE_CRITICO) return { severity: "critico", ageHours: idade };
  if (idade >= HORAS_ATE_ATRASADO) return { severity: "atrasado", ageHours: idade };
  return { severity: "ok", ageHours: idade };
}

/**
 * A copia fora do disco do banco, como a rotina de backup a registrou.
 *
 * `lastOkAt` guarda o ultimo SUCESSO, nao a ultima tentativa: sem essa
 * distincao nao daria pra dizer ha quantos dias a copia nao sai -- e e
 * justamente isso que transforma um aviso em urgencia.
 */
export type SecondaryState = {
  dir: string;
  ok: boolean;
  lastOkAt: string | null;
  error: string | null;
};

export type BackupStateFile = {
  lastBackupAt: string | null;
  file: string | null;
  sizeBytes: number | null;
  /** null = copia externa nao configurada nesta instalacao. */
  secondary: SecondaryState | null;
};

/**
 * Le o last-backup.json. Devolve null quando nao da pra confiar no conteudo.
 *
 * Tirar o BOM nao e paranoia: o PowerShell que grava este arquivo ja
 * gravou com BOM (Set-Content -Encoding UTF8 no PS 5.1 poe BOM), e JSON.parse
 * LANCA com BOM no inicio. O lado que grava foi corrigido, mas instalacoes
 * que ja rodaram tem o arquivo com BOM em disco -- e um arquivo ilegivel
 * viraria "nunca houve backup" numa loja com backup em dia.
 */
export function parseBackupState(bruto: string): BackupStateFile | null {
  try {
    const semBom = bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto;
    const dados = JSON.parse(semBom) as Record<string, unknown>;
    if (!dados || typeof dados !== "object") return null;
    return {
      lastBackupAt: typeof dados.lastBackupAt === "string" ? dados.lastBackupAt : null,
      file: typeof dados.file === "string" ? dados.file : null,
      sizeBytes: typeof dados.sizeBytes === "number" ? dados.sizeBytes : null,
      secondary: parseSecondary(dados.secondary),
    };
  } catch {
    return null;
  }
}

function parseSecondary(bruto: unknown): SecondaryState | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const dir = typeof d.dir === "string" ? d.dir : "";
  if (!dir) return null;
  // PowerShell grava string vazia onde o TypeScript esperaria null: um
  // parametro [string] nao inicializado vira "" no ConvertTo-Json, e "" 
  // aqui significa ausencia de erro, nao um erro sem texto.
  const erro = typeof d.error === "string" && d.error.trim() ? d.error : null;
  return {
    dir,
    ok: d.ok === true,
    lastOkAt: typeof d.lastOkAt === "string" && d.lastOkAt ? d.lastOkAt : null,
    error: erro,
  };
}

export type SecondaryStatus = {
  configurada: boolean;
  dir: string | null;
  severity: BackupSeverity;
  ageHours: number | null;
  error: string | null;
};

/**
 * Saude da copia externa, SEPARADA da do backup local.
 *
 * As duas podem divergir, e e esse o ponto: o backup local roda todo dia
 * e diz OK enquanto o pendrive esta fora da tomada ha duas semanas. Uma
 * severidade so mostraria verde e a loja acharia que tem copia fora da
 * maquina.
 */
export function classifySecondary(
  secondary: SecondaryState | null,
  now: Date = new Date(),
): SecondaryStatus {
  if (!secondary) {
    return { configurada: false, dir: null, severity: "desconhecido", ageHours: null, error: null };
  }
  // Configurada e nunca funcionou e pior que nao configurada: alguem
  // acredita que existe copia.
  if (!secondary.lastOkAt) {
    return {
      configurada: true,
      dir: secondary.dir,
      severity: "critico",
      ageHours: null,
      error: secondary.error,
    };
  }
  const porIdade = classifyBackupAge(secondary.lastOkAt, now);
  // Falha na ULTIMA tentativa vira aviso na hora, sem esperar a idade
  // passar de 48h: a copia esta quebrada agora, e um dia de silencio e um
  // dia a menos pra consertar antes de precisar dela.
  const severity = secondary.error && porIdade.severity === "ok" ? "atrasado" : porIdade.severity;
  return {
    configurada: true,
    dir: secondary.dir,
    severity,
    ageHours: porIdade.ageHours,
    error: secondary.error,
  };
}

/** "há 3 horas", "há 2 dias" -- para o aviso na tela. */
export function formatBackupAge(ageHours: number | null): string {
  if (ageHours == null) return "nunca";
  if (ageHours < 1) return "há menos de uma hora";
  if (ageHours < 24) {
    const h = Math.floor(ageHours);
    return `há ${h} ${h === 1 ? "hora" : "horas"}`;
  }
  const d = Math.floor(ageHours / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}
