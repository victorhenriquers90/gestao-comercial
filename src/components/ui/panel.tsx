import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Antes do Panel, cada aviso colorido (`<div className="rounded-lg
 * border border-X/40 bg-X/5 p-3">` ou a mesma coisa num `<Card>`) repetia
 * essa combinacao escrita a mao -- e duas vezes a combinacao divergiu
 * sozinha (`bg-warning/10` em vez de `/5`, `border-destructive/50` em vez
 * de `/40`), sem ninguem notar porque nao ha um lugar so pra comparar.
 * `PANEL_TONE_CLASS` e essa fonte unica: tanto o `Panel` (o caso leve,
 * aninhado dentro de outro cartao) quanto um `<Card>` chapado (o caso
 * pesado, aviso de pagina inteira, como em caixa.tsx) leem daqui.
 */
export type PanelTone = "info" | "success" | "warning" | "destructive" | "muted";

const PANEL_TONE_CLASS: Record<PanelTone, string> = {
  info: "border-info/40 bg-info/5",
  success: "border-success/40 bg-success/5",
  warning: "border-warning/40 bg-warning/5",
  destructive: "border-destructive/40 bg-destructive/5",
  // Nao e alarme nenhum -- o lado "quieto" de um aviso condicional (ex.:
  // "ambiente de teste, mas sem token" vs "ambiente de teste, com token e
  // nota nao vale", em nfce-readiness-panel.tsx). `text-muted-foreground`
  // faz parte do tom (nao so cor de borda/fundo) porque e assim que os
  // dois call sites de hoje usam: o texto inteiro vem apagado, nao so um
  // paragrafo escolhido a dedo.
  muted: "border-border bg-muted/40 text-muted-foreground",
};

export function panelToneClass(tone: PanelTone): string {
  return PANEL_TONE_CLASS[tone];
}

/**
 * Aviso/destaque colorido leve, aninhado dentro de outra tela ou cartao
 * (bloco de NFC-e, linha de um fechamento, etc.). Pra um aviso de PAGINA
 * INTEIRA com o peso visual do `Card` (sombra, canto maior), use `Card`
 * direto com `panelToneClass(tone)` no className em vez deste componente
 * -- os dois tamanhos sao de proposito (ver HANDOFF item 171), nao falta
 * de padronizacao.
 */
export function Panel({
  tone,
  className,
  ...props
}: { tone?: PanelTone } & React.ComponentProps<"div">) {
  // `tone` opcional: a borda neutra sem tom nenhum (ex.: a parcela EM DIA
  // de crediario-panel.tsx, ao lado da parcela atrasada com tone=
  // "destructive") e um estado tao comum quanto os coloridos, e forcar um
  // tom pra ele so pra bater com a tipagem teria sido pior que deixar sem.
  return (
    <div className={cn("rounded-lg border p-3", tone ? panelToneClass(tone) : "border-border", className)} {...props} />
  );
}
