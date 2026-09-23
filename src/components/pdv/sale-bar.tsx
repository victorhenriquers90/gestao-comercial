import { Receipt as ReceiptIcon, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  itemCount: number;
  registerOpen: boolean | null;
  online: boolean;
  lastSale: { number: number; total: number } | null;
  onLastSale: () => void;
};

/**
 * Identificacao da venda. Discreta de proposito: e contexto, nao conteudo
 * -- nao pode disputar o olho com o cupom e o total. Operador e loja ja
 * estao na barra do topo do sistema; aqui nao se repete.
 */
export function SaleBar({ itemCount, registerOpen, online, lastSale, onLastSale }: Props) {
  const agora = useRelogio();
  return (
    <div className="pdv-bar">
      <span className="pdv-status">
        <span className={cn("pdv-dot", itemCount ? "bg-primary" : "bg-muted-foreground/50")} />
        {itemCount ? "Venda em andamento" : "Nova venda"}
      </span>
      {registerOpen != null ? (
        <span className="pdv-status">
          <span className={cn("pdv-dot", registerOpen ? "bg-success" : "bg-warning")} />
          {registerOpen ? "Caixa aberto" : "Caixa fechado"}
        </span>
      ) : null}
      {!online ? (
        <span className="pdv-status font-medium text-destructive" role="status">
          <WifiOff className="size-3.5" />
          Sem conexão
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-4">
        {lastSale ? (
          <button type="button" className="pdv-status hover:text-foreground" onClick={onLastSale}>
            <ReceiptIcon className="size-3.5" />
            Última: nº {lastSale.number} · <span className="tabular">{formatBRL(lastSale.total)}</span>
          </button>
        ) : null}
        <time className="pdv-status tabular" dateTime={agora.toISOString()} suppressHydrationWarning>
          {agora.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
          {" · "}
          {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </time>
      </span>
    </div>
  );
}

function useRelogio(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    // Acorda na virada do minuto, nao a cada segundo: a tela mostra HH:MM.
    let t: ReturnType<typeof setTimeout>;
    const agenda = () => {
      const d = new Date();
      t = setTimeout(() => {
        setAgora(new Date());
        agenda();
      }, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()));
    };
    agenda();
    return () => clearTimeout(t);
  }, []);
  return agora;
}
