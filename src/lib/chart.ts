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
