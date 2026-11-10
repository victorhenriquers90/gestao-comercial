/**
 * Rota TEMPORARIA -- so pra visualizar o relatorio de dba-audit.ts no
 * navegador. Remover junto com aquele arquivo depois da auditoria.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { dbaAuditFn } from "@/lib/server/dba-audit";

export const Route = createFileRoute("/app/dba-audit")({ component: DbaAuditPage });

function DbaAuditPage() {
  const q = useQuery({ queryKey: ["dba-audit"], queryFn: () => dbaAuditFn() });
  if (q.isPending) return <p style={{ padding: 20 }}>Carregando…</p>;
  if (q.error) return <pre style={{ padding: 20 }}>{String(q.error)}</pre>;
  return (
    <pre style={{ padding: 20, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {JSON.stringify(q.data, null, 2)}
    </pre>
  );
}
