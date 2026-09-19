import { useQuery } from "@tanstack/react-query";
import { DatabaseBackup, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBackupAge } from "@/lib/backup-status";
import { formatDateTime } from "@/lib/format";
import { getBackupStatusFn } from "@/lib/server/backup";

/**
 * Aviso sobre a saude do backup do banco.
 *
 * Existe por uma razao so: a rotina de backup pode parar de rodar e ninguem
 * perceber. Ela roda de madrugada, como servico, sem interface -- "nao deu
 * erro" e exatamente como o silencio se parece. Este cartao e o unico lugar
 * do sistema onde alguem descobre isso ANTES de precisar restaurar.
 *
 * Quando esta tudo em dia ele fica discreto de proposito: um aviso que grita
 * todo dia vira decoracao, e ai nao serve mais quando importa.
 */
export function BackupStatusCard() {
  const status = useQuery({
    queryKey: ["backup-status"],
    queryFn: () => getBackupStatusFn(),
    // O arquivo so muda uma vez por dia; nao ha por que reconsultar a cada
    // foco de janela.
    staleTime: 5 * 60_000,
  });

  const dados = status.data;
  // Fora de uma instalacao de loja (desenvolvimento, preview) nao ha backup
  // pra cobrar -- e o aviso que aparece onde nao deveria e o que treina as
  // pessoas a ignorar o aviso.
  if (!dados?.installed) return null;

  if (dados.severity === "ok") {
    return (
      <p className="mb-block flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
        Backup do banco {formatBackupAge(dados.ageHours)}
        {dados.lastBackupAt ? ` (${formatDateTime(dados.lastBackupAt)})` : ""}.
      </p>
    );
  }

  const critico = dados.severity === "critico";
  const desconhecido = dados.severity === "desconhecido";
  const Icone = desconhecido ? ShieldQuestion : critico ? ShieldAlert : DatabaseBackup;

  const titulo = desconhecido
    ? "Não há registro de nenhum backup"
    : critico
      ? "O backup do banco não roda há mais de uma semana"
      : `Último backup ${formatBackupAge(dados.ageHours)}`;

  const explicacao = desconhecido
    ? "O sistema está instalado, mas nunca gravou um backup bem-sucedido. Enquanto isso não for resolvido, não existe cópia das vendas, clientes e financeiro desta loja."
    : critico
      ? "Uma semana sem backup não é a loja ter ficado fechada — é a rotina ter parado. Tudo que foi lançado desde o último backup está sem cópia."
      : "O backup diário parece ter falhado. A loja continua funcionando normalmente, mas o que foi lançado desde então ainda não tem cópia.";

  return (
    <Card
      role="status"
      className={`mb-block flex items-start gap-3 p-4 ${
        critico || desconhecido ? "border-destructive/50 bg-destructive/5" : "border-primary/40"
      }`}
    >
      <Icone
        className={`mt-0.5 size-5 shrink-0 ${critico || desconhecido ? "text-destructive" : "text-primary"}`}
        aria-hidden
      />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{titulo}</p>
        <p className="text-sm text-muted-foreground">{explicacao}</p>
        <p className="text-xs text-muted-foreground">
          Verifique o log em {dados.backupDir.replace(/backups$/, "logs")}\backup.log e a tarefa
          &ldquo;GestaoComercial-Backup&rdquo; no Agendador de Tarefas do Windows.
        </p>
      </div>
    </Card>
  );
}
