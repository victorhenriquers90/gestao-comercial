import { CircleCheck, ExternalLink, Hourglass, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type NfceState =
  | { fase: "emitindo" }
  | { fase: "ok"; status: string; numero: string | null; danfeUrl: string | null; teste: boolean }
  | { fase: "erro"; mensagens: string[] };

/**
 * Situacao da NFC-e da venda que acabou de fechar, no topo do comprovante.
 * A venda ja esta gravada em qualquer caso -- o que muda e se a nota saiu.
 */
export function NfceStatus({
  state,
  onRefresh,
  refreshing,
}: {
  state: NfceState;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (state.fase === "emitindo") {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-md border border-border bg-muted px-4 py-3 text-sm" role="status">
        <Spinner className="size-5" />
        Emitindo NFC-e…
      </div>
    );
  }

  if (state.fase === "erro") {
    return (
      <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="alert">
        <p className="flex items-center gap-2 font-medium text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          NFC-e não emitida
        </p>
        <ul className="mt-1 list-disc pl-6">
          {state.mensagens.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">
          A venda está registrada. A nota fica pendente e pode ser emitida de novo na tela de Vendas.
        </p>
      </div>
    );
  }

  const autorizada = state.status === "autorizado";
  return (
    <div
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${
        autorizada ? "border-success/40 bg-success/10" : "border-border bg-muted"
      }`}
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`flex items-center gap-2 font-medium ${autorizada ? "text-success" : ""}`}>
          {autorizada ? <CircleCheck className="size-4" /> : <Hourglass className="size-4" />}
          {autorizada
            ? `NFC-e autorizada${state.numero ? ` · nº ${state.numero}` : ""}`
            : "NFC-e em processamento na SEFAZ"}
        </p>
        <div className="flex gap-2">
          {autorizada && state.danfeUrl ? (
            <Button asChild size="sm" variant="outline" className="rounded-sm">
              <a href={state.danfeUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Abrir DANFE
              </a>
            </Button>
          ) : null}
          {!autorizada ? (
            <Button size="sm" variant="outline" className="rounded-sm" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className="size-4" />
              {refreshing ? "Consultando…" : "Atualizar"}
            </Button>
          ) : null}
        </div>
      </div>
      {state.teste ? (
        <p className="mt-1 text-xs text-muted-foreground">Ambiente de homologação: nota de teste, sem valor fiscal.</p>
      ) : null}
    </div>
  );
}
