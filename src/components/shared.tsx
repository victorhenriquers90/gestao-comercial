import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { formatPct } from "@/lib/format";
import { pageRangeLabel, type SortDir } from "@/lib/paging";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/card";

export function PageHeader({
  title,
  description,
  subtitle,
  actions,
}: {
  title: string;
  /** Kicker curto (vira `ed-label`, maiúsculo) ACIMA do título -- uma
   * lista de 3-5 palavras ("Empresa, lojas, equipe..."), não frase. */
  description?: string;
  /** Frase normal, com verbo, ABAIXO do título -- pro caso (metas.tsx,
   * promocoes.tsx, compras.tsx) em que `description` virava uma frase
   * inteira espremida em maiúsculo de 11px. Mesmo tratamento do
   * subtítulo do login (tamanho/cor), não uma convenção nova. */
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      {/* max-w-md: sem teto, uma descrição longa (Promoções, Metas) ficava
          numa linha só, ocupando quase toda a largura do cabeçalho -- o
          flex-wrap do container então empurrava o botão de ação pra uma
          linha abaixo do título, mesmo quando sobrava espaço real que só
          não era usado porque o texto não quebrava. Com o teto, o texto
          quebra em 2+ linhas e o botão continua ao lado do título.
          max-w-xl (576px) não bastou: testado ao vivo contra a largura real
          do conteúdo (~678px nesta sessão), sobrava só 677-576=101px pro
          botão -- menos que a largura de "Nova promoção" (129px). md
          (448px) deixa folga de verdade, confirmado contra o mesmo caso. */}
      <div className="min-w-0 max-w-md">
        {description ? <p className="ed-label mb-2">{description}</p> : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{subtitle}</p> : null}
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
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
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
          {formatPct(trend.value)} {trend.label}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Numero grande com rotulo pequeno em cima -- o terceiro jeito (depois do
 * `KpiCard` e de texto solto) que telas como caixa.tsx repetiam a mao pra
 * mostrar "Contado"/"Esperado"/etc. Nao e `KpiCard`: `Stat` nao e um
 * ladrilho de resumo da tela inteira, e um numero dentro de um bloco maior
 * (um resumo de contagem, uma comparacao lado a lado) que so empresta o
 * MESMO par rotulo+valor, em dois tamanhos (`lg` pros tres-numeros-lado-a-
 * lado, `xl` pro numero sozinho de destaque) e dois arranjos (`column`,
 * rotulo em cima; `row`, rotulo e valor na mesma linha, encostados nas
 * pontas -- o resumo "Contado na gaveta: R$ X" no rodape de um formulario).
 */
export function Stat({
  label,
  value,
  size = "lg",
  layout = "column",
  className,
}: {
  label: string;
  value: string;
  size?: "lg" | "xl";
  layout?: "column" | "row";
  className?: string;
}) {
  if (layout === "row") {
    return (
      <div className={cn("flex items-baseline justify-between", className)}>
        <span className="ed-label">{label}</span>
        <span className={cn("tabular font-display font-semibold", size === "xl" ? "text-2xl" : "text-xl")}>
          {value}
        </span>
      </div>
    );
  }
  return (
    <div className={className}>
      <p className="ed-label">{label}</p>
      <p
        className={cn(
          "tabular font-display font-semibold",
          size === "xl" ? "mt-1 text-2xl" : "mt-0.5 text-xl",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Props pra espalhar num elemento que abre um detalhe ao clicar (padrão já
 * usado em clientes/fornecedores/produtos/compras/vendas numa `<tr>`, e em
 * crm.tsx num `<Card>` do quadro — sempre com `className="cursor-pointer"`
 * do lado de fora). Genérico no tipo do elemento (`HTMLElement` por padrão)
 * de propósito: a mesma falta de teclado vale pra qualquer coisa clicável,
 * não só linha de tabela.
 *
 * Sem isto, o elemento só funcionava no mouse: nenhum tinha `tabIndex`,
 * `onKeyDown` ou `role` — quem navega só pelo teclado não alcançava o
 * detalhe nenhum jeito. `role="button"` em vez de deixar a `<tr>` como
 * `row` implícito é de propósito: o elemento JÁ FUNCIONA como botão (um alvo
 * clicável, uma ação), então anunciar ele como tal é mais honesto que
 * fingir que é só uma linha de dado estática — o alternativo (manter
 * `role="row"` e só adicionar foco/tecla) deixaria quem usa leitor de tela
 * focando em algo "clicável" sem o leitor nunca avisar que dá pra ativar.
 * Mesmo botão (Enter e Espaço) que qualquer `<button>` nativo já aceita.
 */
export function clickableRow<T extends HTMLElement = HTMLElement>(onClick: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent<T>) => {
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
    // `max-h-[36rem] overflow-auto`, nao so `overflow-x-auto`: item 175
    // do HANDOFF provou (repro isolado, fora da pagina) que `overflow-x:
    // auto` sozinho sequestra o `sticky top-0` do cabecalho pros DOIS
    // eixos, nao so o horizontal -- nao tem como ter "rolagem horizontal
    // isolada" E "cabecalho grudando no scroll da PAGINA" no mesmo
    // elemento, CSS puro nao permite. Escolhido aqui: a tabela ganha
    // caixa de rolagem PROPRIA (as duas direcoes) com altura maxima, e o
    // cabecalho gruda DENTRO dela -- so entao sticky faz sentido (o
    // scroll que ele vigia e o da propria caixa, nao mais o da pagina).
    // Tabela curta (cabe nos 36rem) nao muda nada -- max-height so pesa
    // quando o conteudo passa do teto, visual identico a antes. So pesa
    // em listas longas, que e justamente onde perder o cabecalho rolando
    // doia de verdade.
    <div className="enter-fade max-h-[36rem] overflow-auto border-y border-border bg-card">
      {children}
    </div>
  );
}

export function DataTable({ headers, children }: { headers: ReactNode; children: ReactNode }) {
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
        <thead className="sticky top-0 z-10 border-b border-border bg-muted">{headers}</thead>
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
        // uppercase + tracking: um <button> nao herda text-transform nem
        // letter-spacing do .ed-label no <th> por padrao (o reset do
        // Tailwind cobre font/color/line-height, nao esses dois) -- sem
        // isto o cabecalho ordenavel ficava em minusculo, destoando dos
        // outros cabecalhos da mesma tabela. Visto ao vivo em producao.
        className="inline-flex items-center gap-1 uppercase tracking-[0.14em] hover:text-foreground"
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
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
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
        {/*
          Mesma forma do KpiCard de verdade (chapado, so um filete embaixo
          -- ver kpi-card em styles.css) e nao uma caixa arredondada: com
          `h-28 rounded-xl` o esqueleto parecia um cartao com sombra/borda
          que nunca existe depois que os dados chegam, e a tela "pulava"
          de forma nesse instante.
        */}
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="kpi-card min-w-0 rounded-none border-0 border-b border-border bg-transparent px-1 py-4 shadow-none"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2.5 h-7 w-24" />
          </div>
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
  /*
    Era um <div> portalizado na mao, sem role nem foco gerenciado: Escape
    nao fechava (todo OUTRO dialogo do app fecha), tab passava por tras
    pro conteudo da pagina, e leitor de tela nao anunciava nada abrindo --
    numa confirmacao de acao perigosa (pagar, cancelar, excluir), e
    justamente onde isso mais falta. AlertDialog do Radix (ja era
    dependencia instalada, sem uso nenhum) da foco preso, Escape e
    role="alertdialog" de graca, com o MESMO visual de antes.
  */
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{title}</AlertDialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancelar</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant={danger ? "destructive" : "default"} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
