import { SearchPicker } from "@/components/search-picker";
import { formatBRL } from "@/lib/format";
import { listProductsFn } from "@/lib/server/catalog";

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

type ProductHit = Awaited<ReturnType<typeof listProductsFn>>["items"][number];

/** Escolha de UM produto por busca digitada (nome, SKU ou código). */
export function ProductPicker({ value, onChange, placeholder, activeOnly, disabled, ariaLabel }: Props) {
  return (
    <SearchPicker<ProductHit, PickedProduct>
      value={value}
      onChange={onChange}
      queryKey={["product-picker", activeOnly ?? false]}
      search={(term, limit) =>
        listProductsFn({ data: { q: term || undefined, active: activeOnly ? true : undefined, limit } })
      }
      toValue={(p) => ({ id: p.id, name: p.name, price: p.price })}
      describe={(p) => ({
        title: p.name,
        subtitle: `${p.sku ?? p.barcode ?? "sem código"}${p.isActive ? "" : " · inativo"}`,
        aside: formatBRL(p.price),
      })}
      placeholder={placeholder ?? "Digite nome, SKU ou código"}
      ariaLabel={ariaLabel ?? "Buscar produto por nome, SKU ou código"}
      changeLabel="Trocar produto"
      listLabel="Produtos encontrados"
      emptyText="Nenhum produto cadastrado."
      noMatchText={(termo) => `Nenhum produto encontrado para “${termo}”.`}
      disabled={disabled}
    />
  );
}
