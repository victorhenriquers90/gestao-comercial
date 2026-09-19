import { createServerFn } from "@tanstack/react-start";
import { readFile, stat } from "node:fs/promises";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { classifyBackupAge, parseBackupState, type BackupSeverity } from "@/lib/backup-status";
import { requireTenant } from "./context";

/**
 * Estado da rotina de backup, lido do arquivo que o
 * Backup-GestaoComercial.ps1 grava a cada execucao bem-sucedida.
 *
 * O app NAO faz backup nem manda fazer -- quem faz e a tarefa agendada do
 * Windows, que roda como SYSTEM e nao depende do app estar de pe. Aqui so
 * se LE o resultado. E de proposito: dar ao app (que fica exposto na rede da
 * loja) o poder de disparar pg_dump seria criar uma porta nova pra uma coisa
 * que ja funciona melhor fora dele.
 */

const STATE_DIR = process.env.GC_STATE_DIR ?? "C:\\ProgramData\\GestaoComercial";
const BACKUP_STATE_FILE = `${STATE_DIR}\\backups\\last-backup.json`;
const INSTALL_STATE_FILE = `${STATE_DIR}\\install-state.json`;

export type BackupStatusPayload = {
  /**
   * false quando isto nao e uma instalacao de loja (desenvolvimento, preview,
   * Vercel). Sem esta distincao, o ambiente de dev mostraria "backup nunca
   * rodou" pra sempre -- e um aviso que aparece quando nao deveria treina
   * todo mundo a ignorar o aviso quando ele importa.
   */
  installed: boolean;
  severity: BackupSeverity;
  ageHours: number | null;
  lastBackupAt: string | null;
  file: string | null;
  sizeBytes: number | null;
  backupDir: string;
};

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

export const getBackupStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BackupStatusPayload> => {
    const { tenant } = await requireTenant(context.userId);
    // Estado de infraestrutura da maquina, nao dado da loja: fica com quem
    // responde pela instalacao.
    assertCan(tenant.role, "settings.write");

    const vazio: BackupStatusPayload = {
      installed: false,
      severity: "desconhecido",
      ageHours: null,
      lastBackupAt: null,
      file: null,
      sizeBytes: null,
      backupDir: `${STATE_DIR}\\backups`,
    };

    if (!(await existe(INSTALL_STATE_FILE))) return vazio;

    // Instalado. A partir daqui, ausencia de backup e um PROBLEMA, nao uma
    // configuracao ausente -- por isso installed vira true antes de tentar
    // ler o arquivo de estado do backup.
    const instalado = { ...vazio, installed: true };

    let bruto: string;
    try {
      bruto = await readFile(BACKUP_STATE_FILE, "utf8");
    } catch {
      return instalado;
    }

    // Arquivo ilegivel/corrompido conta como "nao sei", nunca como "esta
    // tudo bem" -- ver parseBackupState (inclusive o caso do BOM).
    const dados = parseBackupState(bruto);
    if (!dados) return instalado;

    const { severity, ageHours } = classifyBackupAge(dados.lastBackupAt);
    return {
      ...instalado,
      severity,
      ageHours,
      lastBackupAt: dados.lastBackupAt,
      file: dados.file,
      sizeBytes: dados.sizeBytes,
    };
  });
