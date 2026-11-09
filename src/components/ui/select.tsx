import * as React from "react";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * Seta do `<select>` nativo, embutida via `background-image` em vez de
 * `appearance: auto` -- todo OUTRO campo do app (Input, Button) tem
 * aparência 100% desenhada por CSS; o `<select>` era o único ainda preso
 * ao estilo cru do navegador/SO, destoando mais ainda no tema escuro (a
 * seta do navegador fica clara OU escura por conta própria, sem ligação
 * com `--muted-foreground`). Duas cores pré-calculadas (uma por tema) em
 * vez de uma cor neutra única: `url(data:image/svg+xml,...)` carrega como
 * recurso de imagem isolado, `currentColor` dentro dele não enxerga a
 * cascata da página -- não tem como ler a cor certa de `--muted-foreground`
 * sem decidir em JS qual das duas usar.
 */
function chevronDataUri(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const CHEVRON_LIGHT = chevronDataUri("#5a5650");
const CHEVRON_DARK = chevronDataUri("#a8a399");

export function Select({
  className,
  children,
  style,
  ...props
}: React.ComponentProps<"select">) {
  const { theme } = useTheme();
  return (
    <select
      className={cn(
        "flex h-10 w-full appearance-none rounded-lg border border-transparent bg-muted bg-no-repeat bg-[position:right_0.65rem_center] bg-[length:16px] px-3 pr-9 text-sm text-foreground transition-colors focus-visible:border-input focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{ backgroundImage: theme === "dark" ? CHEVRON_DARK : CHEVRON_LIGHT, ...style }}
      {...props}
    >
      {children}
    </select>
  );
}

export function NativeCheckbox({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 rounded-xs border-input accent-primary",
        className,
      )}
      {...props}
    />
  );
}
