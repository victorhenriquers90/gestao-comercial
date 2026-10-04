import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useDebounced } from "@/hooks/use-debounced";
import { formatBRL } from "@/lib/format";
import { listProductsFn } from "@/lib/server/catalog";
import { cn } from "@/lib/utils";

export type PickedProduct = { id: number; name: string; price?: number };

type Props = {
  value: PickedProduct | null;
  onChange: (p: PickedProduct | null) => void;
  /** Texto do campo vazio — também diz o que "nenhum" significa ("Todos os produtos"). */
  placeholder?: string;
  activeOnly?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
};

const PAGE = 8;

/**
 * Escolha de UM produto por busca digitada.
 *
 * Substitui o <select> com todos os produtos: a listagem cortava em 200 (em
 * ordem alfabética) sem avisar, então num catálogo maior o produto simplesmente
 * não existia para regra de comissão, simulador ou promoção; e um <select> de
 * centenas de linhas não é navegável de qualquer forma. Aqui o servidor busca
 * por nome/SKU/código e devolve poucos resultados — o catálogo pode crescer.
 *
 * A lista de resultados fica no fluxo da página (não flutuante): dentro de um
 * diálogo com rolagem, um painel absoluto seria cortado na borda.
 */
export function ProductPicker({ value, onChange, placeholder, activeOnly, disabled, ariaLabel }: Props) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const termo = useDebounced(q.trim(), 200);

  const result = useQuery({
    queryKey: ["product-picker", termo, activeOnly ?? false],
    queryFn: () =>
      listProductsFn({ data: { q: termo || undefined, active: activeOnly ? true : undefined, limit: PAGE } }),
    enabled: aberto && !value,
    placeholderData: keepPreviousData,
  });
  const items = result.data?.items ?? [];
  const total = result.data?.total ?? 0;
  // Enquanto o termo digitado ainda não virou consulta (debounce) ou a
  // consulta nova não voltou, o que está na tela é do termo anterior.
  const atualizando = result.isFetching || q.trim() !== termo;

  useEffect(() => {
    setActive(0);
  }, [termo]);

  useEffect(() => {
    if (!value && refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [value]);

  function escolher(p: (typeof items)[number]) {
    onChange({ id: p.id, name: p.name, price: p.price });
    setQ("");
    setAberto(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setAberto(true);
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      // Nunca deixa o Enter enviar/fechar o formulário em volta.
      e.preventDefault();
      const hit = items[active];
      if (hit && !atualizando) escolher(hit);
    }
  }

  // O Radix Dialog escuta Escape na captura do `document`, antes de qualquer
  // handler do React: um stopPropagation no onKeyDown chega tarde e o Escape
  // que só devia fechar a lista fechava o diálogo inteiro (e perdia o
  // formulário). A captura em `window` roda antes da do `document`.
  const escapavel = !value && !disabled && (aberto || q !== "");
  useEffect(() => {
    if (!escapavel) return;
    function onEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape" || document.activeElement !== inputRef.current) return;
      e.stopPropagation();
      setQ("");
      setAberto(false);
    }
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [escapavel]);

  if (value) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg bg-muted px-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium" title={value.name}>
          {value.name}
        </span>
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
          aria-label={`Trocar produto (${value.name})`}
          title="Trocar produto"
          disabled={disabled}
          onClick={() => {
            refocus.current = true;
            onChange(null);
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const mostrarPainel = aberto && !disabled;
  const activeItem = items[active];

  return (
    <div>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={mostrarPainel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={mostrarPainel && activeItem ? `${listId}-${active}` : undefined}
          aria-label={ariaLabel ?? "Buscar produto por nome, SKU ou código"}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={q}
          placeholder={placeholder ?? "Digite nome, SKU ou código"}
          onChange={(e) => {
            setQ(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setAberto(false)}
          onKeyDown={onKeyDown}
        />
        {mostrarPainel && atualizando ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
            <Spinner className="size-4" />
          </span>
        ) : null}
      </div>
      {mostrarPainel ? (
        <div
          className="mt-1 overflow-hidden rounded-lg border border-border bg-card"
          role="presentation"
          onMouseDown={(e) => e.preventDefault()}
        >
          {result.isError ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-destructive" role="alert">
              <TriangleAlert className="size-4 shrink-0" />
              Não foi possível buscar agora. Tente de novo.
            </p>
          ) : result.isPending ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground" role="status">
              Buscando…
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground" role="status">
              {termo ? `Nenhum produto encontrado para “${termo}”.` : "Nenhum produto cadastrado."}
            </p>
          ) : (
            <>
              <ul
                id={listId}
                role="listbox"
                aria-label="Produtos encontrados"
                className={cn("max-h-56 overflow-y-auto", atualizando && "opacity-60")}
              >
                {items.map((p, i) => (
                  <li
                    key={p.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                      i === active ? "bg-muted" : "hover:bg-muted/60",
                    )}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => escolher(p)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.sku ?? p.barcode ?? "sem código"}
                        {p.isActive ? "" : " · inativo"}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">{formatBRL(p.price)}</span>
                  </li>
                ))}
              </ul>
              {total > items.length ? (
                <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                  Mostrando {items.length} de {total} — digite para refinar.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
