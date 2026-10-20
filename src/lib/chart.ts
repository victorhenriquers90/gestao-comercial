import type { CSSProperties } from "react";

/**
 * Recharts renders its own tooltip chrome (white box, browser default font),
 * which ignores the app's theme — in dark mode it shows up as a white popup.
 * Spread this into every `<Tooltip>` so the charts on Painel and Relatórios
 * stay on the same tokens as the rest of the UI.
 */
const content: CSSProperties = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-pop)",
  fontFamily: "inherit",
  fontSize: "0.75rem",
  padding: "0.5rem 0.75rem",
};

export const chartTooltip = {
  contentStyle: content,
  labelStyle: { color: "var(--muted-foreground)", marginBottom: "0.25rem" } satisfies CSSProperties,
  itemStyle: { color: "var(--popover-foreground)", padding: 0 } satisfies CSSProperties,
};

/**
 * Ciclo de cor por categoria pra grafico de barra de relatorio (Comissoes,
 * Mix de produtos, Aging...), onde cada barra E uma categoria diferente --
 * uma unica cor pintando todas juntas nao ajudava a distinguir nada. NAO usar
 * pra serie temporal (Vendas do periodo, Evolucao mensal): ali toda barra
 * mede a MESMA coisa em instantes diferentes, e colorir cada uma diferente
 * sugeriria uma distincao que nao existe.
 */
export const CHART_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

export function chartColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]!;
}

/**
 * Mesma paleta, mas pra um rotulo livre (nome de categoria, por ex.) em vez
 * de uma posicao conhecida: hash simples do texto escolhe sempre a MESMA cor
 * pro mesmo nome, sem precisar de uma tabela nome->cor mantida a mao (a
 * lista de categorias e criada pelo proprio usuario, cresce sem aviso).
 */
export function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash << 5) - hash + label.charCodeAt(i);
    hash |= 0;
  }
  return chartColor(Math.abs(hash));
}

/**
 * Estilo do "retrato" sem foto (inicial do nome): fundo e um tingimento leve
 * da cor do rotulo (nao a cor solida -- a letra precisa continuar legivel),
 * letra na cor cheia. Mesma ideia do Badge (`bg-X/10 text-X`), pra produto
 * sem foto nao ficar todo cinza igual na lista/busca do PDV.
 */
export function labelTileStyle(label: string): CSSProperties {
  const color = labelColor(label);
  return {
    background: `color-mix(in oklab, ${color} 16%, var(--muted))`,
    color,
  };
}
