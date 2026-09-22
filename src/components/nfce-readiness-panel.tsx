import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { nfceReadinessFn } from "@/lib/server/nfce";

/**
 * Pre-checagem fiscal, numa tela so.
 *
 * A validacao que existia rodava por venda, no clique de emitir: o lojista
 * descobria que faltava NCM com o cliente no balcao, um produto por vez, e
 * so via o bloqueio seguinte depois de resolver esse. Aqui a lista sai
 * inteira, antes da primeira venda.
 */
export function NfceReadinessPanel() {
  const r = useQuery({ queryKey: ["nfce-readiness"], queryFn: () => nfceReadinessFn() });

  if (r.isPending) return null;
  if (!r.data) return null;
  const d = r.data;
  const dentro = d.blockers.filter((b) => b.scope === "sistema");
  const fora = d.blockers.filter((b) => b.scope === "fora");

  return (
    <Card className="mt-4 max-w-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="ed-title">Pronto para emitir?</p>
        <Badge
          variant={d.prontoParaValer ? "success" : d.blockers.length === 0 ? "warning" : "danger"}
        >
          {d.prontoParaValer
            ? "Sim — emitindo em produção"
            : d.blockers.length === 0
              ? "Só falta sair do teste"
              : `${d.blockers.length} pendência(s)`}
        </Badge>
      </div>

      {/* O estado perigoso e o do meio: sem pendencia nenhuma, emitindo, e
          nada valendo. A lista vazia nao pode parecer aprovacao. */}
      {d.aviso ? (
        <div
          className={`mt-block rounded-lg border p-3 text-sm ${
            d.tokenPresent
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          {d.tokenPresent ? <p className="font-medium">Ambiente de teste (homologação)</p> : null}
          <p className={d.tokenPresent ? "mt-1" : ""}>{d.aviso}</p>
        </div>
      ) : null}

      {d.blockers.length === 0 ? (
        <p className="mt-block text-sm text-muted-foreground">
          Nenhuma pendência de cadastro. {d.vendasComNota} de {d.vendasFinalizadas} venda(s)
          finalizada(s) têm nota fiscal válida.
        </p>
      ) : null}

      {dentro.length ? (
        <div className="mt-block">
          <p className="ed-label">Resolve aqui no sistema</p>
          <ul className="mt-2 space-y-3">
            {dentro.map((b) => (
              <li key={b.id}>
                <p className="text-sm font-medium">{b.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{b.detail}</p>
                {b.id === "ncm" && d.exemplosSemNcm.length ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ex.: {d.exemplosSemNcm.map((p) => p.name).join(", ")}
                    {d.produtosSemNcm > d.exemplosSemNcm.length
                      ? ` e mais ${d.produtosSemNcm - d.exemplosSemNcm.length}`
                      : ""}
                    .{" "}
                    <Link to="/app/produtos" className="underline">
                      Abrir Produtos
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Separado do resto porque nao adianta o lojista ficar preenchendo
          campo: sem contrato e certificado, nada disto emite. */}
      {fora.length ? (
        <div className="mt-block">
          <p className="ed-label">Depende de contrato e certificado</p>
          <ul className="mt-2 space-y-3">
            {fora.map((b) => (
              <li key={b.id}>
                <p className="text-sm font-medium">{b.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{b.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
