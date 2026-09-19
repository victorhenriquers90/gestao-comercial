import { cn } from "@/lib/utils";

/**
 * Anel de carregamento, no espirito do indicador do Windows: um trilho
 * discreto com um arco girando por cima.
 *
 * O trilho de fundo nao e enfeite -- sem ele, um arco solto girando no vazio
 * parece um glitch de renderizacao; com ele, le imediatamente como "isto e
 * um indicador de progresso".
 *
 * Sem rotulo e `aria-hidden` de proposito: os dois lugares que usam isto ja
 * dizem "Abrindo a loja…" em texto ao lado. Anunciar "carregando" de novo
 * so faria o leitor de tela repetir a mesma informacao duas vezes.
 */
export function Spinner({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "inverse";
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn(
        "size-8 animate-spin",
        // Movimento reduzido nao desliga o giro, so desacelera: parado, o
        // indicador passaria a mensagem errada (travou) justamente para quem
        // pediu menos animacao.
        "motion-reduce:[animation-duration:3s]",
        tone === "inverse" ? "text-primary-foreground" : "text-primary",
        className,
      )}
    >
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        strokeWidth="3"
        className="stroke-current opacity-20"
      />
      {/* 20,6 de traco para 61,0 de intervalo = pouco mais de um quarto da
          circunferencia (2*pi*13 = 81,7). Arco curto o bastante pra leitura
          de "girando" ser imediata. */}
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="20.6 61"
        className="stroke-current"
      />
    </svg>
  );
}
