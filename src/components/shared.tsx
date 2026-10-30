import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight, Inbox, type LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { pageRangeLabel, type SortDir } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/card";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {description ? <p className="ed-label mb-2">{description}</p> : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="enter-fade flex flex-col items-start justify-center gap-3 border-y border-border py-16">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
        {description ? (
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  trend,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: { value: number; label: string };
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";
  const up = (trend?.value ?? 0) >= 0;
  return (
    <Card className="kpi-card min-w-0 rounded-none border-0 border-b border-border bg-transparent px-1 py-4 shadow-none">
      <p className="ed-label">{label}</p>
      <p className={cn("kpi-value font-display font-semibold tracking-tight tabular", toneClass)}>
        {value}
      </p>
      {/*
        Sem linha reservada quando nao ha `hint` nem `trend`.

        Antes cada KpiCard imprimia dois paragrafos com espaco nao-separavel
        so para manter os cartoes alinhados -- mas `.kpi-card` ja usa
        `grid-template-rows: subgrid`, que alinha as linhas ENTRE os cartoes
        por conta propria. Os espacadores eram redundantes.

        Medido no navegador com o CSS compilado: o cartao cai de 126px para
        110px e o topo do valor continua identico entre os cartoes da mesma
        faixa (150/150 e 276/276 antes e depois). Sao 16px por cartao --
        numa faixa de 8 KPIs, 32px de vazio empurrando o conteudo pra baixo,
        em toda tela que tem KPI.
      */}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {trend ? (
        <p
          className={cn(
            "inline-flex items-center gap-1 text-xs tabular",
            up ? "text-success" : "text-destructive",
          )}
        >
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {up ? "+" : ""}
          {trend.value.toFixed(1)}% {trend.label}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Props pra espalhar numa `<tr>` que abre um detalhe ao clicar (padrão já
 * usado em clientes/fornecedores/produtos/compras/vendas, sempre com
 * `className="cursor-pointer"` do lado de fora).
 *
 * Sem isto, a linha só funcionava no mouse: nenhuma tinha `tabIndex`,
 * `onKeyDown` ou `role` — quem navega só pelo teclado não alcançava o
 * detalhe nenhum jeito. `role="button"` em vez de deixar a `<tr>` como
 * `row` implícito é de propósito: a linha JÁ FUNCIONA como botão (um alvo
 * clicável, uma ação), então anunciar ela como tal é mais honesto que
 * fingir que é só uma linha de dado estática — o alternativo (manter
 * `role="row"` e só adicionar foco/tecla) deixaria quem usa leitor de tela
 * focando em algo "clicável" sem o leitor nunca avisar que dá pra ativar.
 * Mesmo botão (Enter e Espaço) que qualquer `<button>` nativo já aceita.
 */
export function clickableRow(onClick: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      // So reage quando o Enter/Espaco aconteceu na PROPRIA linha. Linha
      // com botao de acao rapida dentro (ex.: "Receber" em compras.tsx) ja
      // tem seu proprio onClick com stopPropagation — isso cobre cliques
      // de mouse, mas keydown continua borbulhando (evento diferente).
      // Sem este filtro, apertar Enter com foco no botao INTERNO disparava
      // a acao dele E a da linha, em dobro.
      if (e.target !== e.currentTarget) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onClick();
    },
  };
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="enter-fade overflow-x-auto border-y border-border bg-card">
      {children}
    </div>
  );
}

export function DataTable({
  headers,
  children,
}: {
  headers: ReactNode;
  children: ReactNode;
}) {
  return (
    <TableWrap>
      <table className="data-table w-full min-w-[640px] text-left text-sm print:min-w-0">
        {/*
          Sem `backdrop-blur-sm` e com fundo OPACO.

          `backdrop-filter` num `<thead>` fazia o texto do cabecalho sumir --
          reproduzido e isolado no navegador: removendo so o filtro, com o
          mesmo fundo translucido, "DESCRIÇÃO FORNECEDOR VENCIMENTO VALOR"
          volta a aparecer. `backdrop-filter` cria contexto de empilhamento e
          bloco de contencao, e aplicado em secao de tabela o Chromium perde
          a pintura do proprio conteudo.

          Isso valia para TODA tabela do sistema: as telas de lista estavam
          sem cabeçalho de coluna, que e a estrutura de leitura principal de
          um ERP.

          Opaco tambem e melhor de ler: cabecalho fixo translucido por cima
          de linhas rolando embaixo embaralha os dois.
        */}
        <thead className="sticky top-0 z-10 border-b border-border bg-muted">
          {headers}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableWrap>
  );
}

/**
 * O alinhamento padrao do cabecalho vive no CSS (`.data-table thead th`), nao
 * numa utilitaria aqui.
 *
 * Com `text-left` fixo neste componente, uma coluna marcada `col-num` ficava
 * com a celula a direita e o TITULO a esquerda -- pior que nao alinhar nada.
 * No Tailwind v4 a camada `utilities` vem depois de `components`, entao a
 * utilitaria vence a regra do `.data-table` por ordem de camada, mesmo tendo
 * especificidade menor. Tirando a utilitaria daqui, as duas regras passam a
 * conviver na mesma camada e a mais especifica decide.
 */
export type SortState<K extends string> = { key: K; dir: SortDir };

/**
 * Clique na MESMA coluna alterna asc/desc; clique numa coluna DIFERENTE
 * troca de coluna e começa em "asc" -- convenção comum de planilha, só
 * precisa de um lugar pra não repetir essa regra em cada tela que ordena.
 */
export function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/**
 * Cabeçalho de coluna. Sem `sortKey`/`sort`/`onSort` continua uma `<th>`
 * simples (maioria das colunas, ex. "Ações"); com os três, vira botão
 * clicável com seta indicando a direção -- mesmo cabeçalho, affordance a
 * mais só onde faz sentido ordenar.
 *
 * O alinhamento padrao do cabecalho vive no CSS (`.data-table thead th`), nao
 * numa utilitaria aqui.
 *
 * Com `text-left` fixo neste componente, uma coluna marcada `col-num` ficava
 * com a celula a direita e o TITULO a esquerda -- pior que nao alinhar nada.
 * No Tailwind v4 a camada `utilities` vem depois de `components`, entao a
 * utilitaria vence a regra do `.data-table` por ordem de camada, mesmo tendo
 * especificidade menor. Tirando a utilitaria daqui, as duas regras passam a
 * conviver na mesma camada e a mais especifica decide.
 */
export function Th<K extends string>({
  children,
  className,
  sortKey,
  sort,
  onSort,
}: {
  children?: ReactNode;
  className?: string;
  sortKey?: K;
  sort?: SortState<K>;
  onSort?: (key: K) => void;
}) {
  if (sortKey == null || onSort == null) {
    return <th className={cn("ed-label px-4 py-3", className)}>{children}</th>;
  }
  const active = sort?.key === sortKey;
  return (
    <th className={cn("ed-label px-4 py-3", className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(sortKey)}
        aria-label={`Ordenar por ${typeof children === "string" ? children : "esta coluna"}`}
      >
        {children}
        {active ? (
          sort!.dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function QueryError({ error, fallback }: { error: unknown; fallback: string }) {
  return (
    <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error instanceof Error ? error.message : fallback}
    </p>
  );
}

/**
 * Rodape de listagem paginada ("101–200 de 250", Anterior/Próxima). Some
 * quando tudo cabe numa pagina. `offset` e `shown` descrevem a janela atual.
 */
export function Pager({
  page,
  pageSize,
  shown,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  shown: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span aria-live="polite">{pageRangeLabel(page * pageSize, shown, total)}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={(page + 1) * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}

export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-48" />
      <div className="kpi-grid">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

export function ConfirmBar({
  open,
  title,
  onCancel,
  onConfirm,
  confirmLabel = "Confirmar",
  danger,
}: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  // Portal pro body, igual o Dialog do Radix (dialog.tsx) faz. Sem isso o
  // confirm fica preso no contexto de empilhamento de ".page-enter" (a
  // transição de página aplica `transform`, que por spec cria um novo
  // contexto mesmo com a matriz identidade) — nenhum z-index escapa dali.
  // Confirmado ao vivo: com z-[60] mas sem portal, o confirm abria (estado
  // React certo) só que invisível e inclicável atrás do Dialog de detalhe.
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/40 p-4">
      <Card className="w-full max-w-sm rounded-2xl p-6 shadow-pop">
        <p className="font-display text-lg font-medium tracking-tight">{title}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant={danger ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Card>
    </div>,
    document.body,
  );
}
