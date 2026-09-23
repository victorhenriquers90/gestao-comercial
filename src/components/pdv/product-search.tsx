import { PackageSearch, Search, TriangleAlert } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { formatBRL } from "@/lib/format";
import { searchPosFn } from "@/lib/server/catalog";
import { cn } from "@/lib/utils";
import type { Hit } from "./sale-model";

type Status = "idle" | "loading" | "done" | "error";

type Props = {
  storeId: number;
  onPick: (hit: Hit) => void;
  /**
   * Teclas com o campo VAZIO vao pro cupom (setas, +, -, Delete). Com texto,
   * o campo e da busca -- SKU tem hifen ("CAM-001-PRE-P"), entao "-" nunca
   * pode ser atalho enquanto se digita.
   */
  onEmptyKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
};

/**
 * Busca de produto do PDV: o campo mais usado da tela.
 *
 * Resultados num painel suspenso sobre o cupom, nao numa coluna fixa: a
 * lista de resultados e transitoria (vive enquanto se digita), e antes ela
 * ocupava 70% da tela enquanto a VENDA -- o que o operador precisa ver a
 * tarde inteira -- ficava espremida num canto com um item visivel.
 */
export const ProductSearch = forwardRef<HTMLInputElement, Props>(function ProductSearch(
  { storeId, onPick, onEmptyKeyDown, disabled },
  ref,
) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(0);
  const [aberto, setAberto] = useState(false);
  const listId = useId();
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const termo = q.trim();
    if (!termo || !storeId) {
      seq.current++;
      setHits([]);
      setStatus("idle");
      return;
    }
    const minha = ++seq.current;
    setStatus("loading");
    const t = setTimeout(async () => {
      try {
        const rows = await searchPosFn({ data: { q: termo, storeId } });
        // Resposta velha (o operador ja digitou outra coisa) nao pinta a
        // lista de agora -- antes a ultima a CHEGAR ganhava, nao a ultima
        // digitada.
        if (minha !== seq.current) return;
        // Leitor de codigo de barras: um resultado exato entra direto.
        if (rows.length === 1 && /^\d{8,}$/.test(termo)) {
          onPickRef.current(rows[0]!);
          setQ("");
          setHits([]);
          setStatus("idle");
          return;
        }
        setHits(rows);
        setActive(0);
        setStatus("done");
      } catch {
        if (minha !== seq.current) return;
        setHits([]);
        setStatus("error");
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, storeId]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function escolher(hit: Hit) {
    onPick(hit);
    setQ("");
    setHits([]);
    setStatus("idle");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!q) {
      onEmptyKeyDown?.(e);
      return;
    }
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setAberto(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit && status === "done") escolher(hit);
    } else if (e.key === "Escape") {
      // Esc aqui limpa a busca e para: sem isto ele subia pro atalho global
      // e fechava junto qualquer outra coisa aberta.
      e.stopPropagation();
      setQ("");
    }
  }

  const termo = q.trim();
  const mostrarPainel = aberto && termo.length > 0 && status !== "idle";

  return (
    <div className="pdv-search">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          type="text"
          role="combobox"
          aria-expanded={mostrarPainel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={mostrarPainel && hits[active] ? `${listId}-${active}` : undefined}
          aria-label="Buscar produto por nome, código ou código de barras"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={q}
          placeholder="Código de barras, SKU ou nome do produto"
          className="pdv-search-input"
          onChange={(e) => {
            setQ(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setAberto(false)}
          onKeyDown={onKeyDown}
        />
        <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
          {status === "loading" ? <Spinner className="size-4" /> : null}
          <Kbd>F2</Kbd>
        </span>
      </div>

      {mostrarPainel ? (
        <div className="pdv-search-panel" role="presentation" onMouseDown={(e) => e.preventDefault()}>
          {status === "error" ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-destructive" role="alert">
              <TriangleAlert className="size-4 shrink-0" />
              Não foi possível buscar agora. Verifique a conexão e tente de novo.
            </p>
          ) : status === "done" && hits.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-3 text-sm" role="status">
              <PackageSearch className="size-5 shrink-0 text-warning" />
              <div>
                <p className="font-medium">Nenhum produto encontrado para “{termo}”</p>
                <p className="text-xs text-muted-foreground">Confira o código ou busque pelo nome.</p>
              </div>
            </div>
          ) : status === "loading" && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
              Buscando…
            </p>
          ) : (
            <>
              <ul ref={listRef} id={listId} role="listbox" aria-label="Produtos encontrados" className="pdv-search-list">
                {hits.map((h, i) => (
                  <li
                    key={h.variantId}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className={cn("pdv-search-option", i === active && "is-active")}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => escolher(h)}
                  >
                    <span className="tile-photo size-9 shrink-0">
                      {h.imageUrl ? (
                        <img src={h.imageUrl} alt="" />
                      ) : (
                        <span className="tile-photo-fallback text-sm">{h.label.slice(0, 1)}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {h.sku ?? "sem SKU"}
                        {" · "}
                        <span className={cn(h.stock <= 0 && "font-medium text-warning")}>
                          {h.stock <= 0 ? "sem estoque" : `estoque ${h.stock}`}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular">{formatBRL(h.price)}</span>
                      {h.listPrice > h.price ? (
                        <span className="block text-xs text-muted-foreground tabular line-through">
                          {formatBRL(h.listPrice)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="pdv-search-hint">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navegar <Kbd>Enter</Kbd> adicionar <Kbd>Esc</Kbd> limpar
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
});
