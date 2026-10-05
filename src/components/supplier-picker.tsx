import { SearchPicker } from "@/components/search-picker";
import { formatBRL, formatDoc } from "@/lib/format";
import { listSuppliersFn } from "@/lib/server/party";

export type PickedSupplier = { id: number; name: string };

type Props = {
  value: PickedSupplier | null;
  onChange: (s: PickedSupplier | null) => void;
  /** Texto do campo vazio — também diz o que "nenhum" significa ("Sem fornecedor"). */
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

type SupplierHit = Awaited<ReturnType<typeof listSuppliersFn>>["items"][number];

/** Escolha de UM fornecedor por busca digitada (razão social, nome fantasia, documento). */
export function SupplierPicker({ value, onChange, placeholder, disabled, ariaLabel }: Props) {
  return (
    <SearchPicker<SupplierHit, PickedSupplier>
      value={value}
      onChange={onChange}
      // Começa por "suppliers": salvar fornecedor invalida ["suppliers"].
      queryKey={["suppliers", "picker"]}
      search={(term, limit) => listSuppliersFn({ data: { q: term || undefined, limit } })}
      toValue={(s) => ({ id: s.id, name: s.tradeName || s.legalName })}
      describe={(s) => ({
        title: s.tradeName || s.legalName,
        subtitle: [s.document ? formatDoc(s.document) : null, s.tradeName ? s.legalName : null].filter(Boolean).join(" · ") || "sem documento",
        aside: s.openBalance > 0 ? `a pagar ${formatBRL(s.openBalance)}` : undefined,
      })}
      placeholder={placeholder ?? "Digite razão social, nome fantasia ou documento"}
      ariaLabel={ariaLabel ?? "Buscar fornecedor por razão social, nome fantasia ou documento"}
      changeLabel="Trocar fornecedor"
      listLabel="Fornecedores encontrados"
      emptyText="Nenhum fornecedor cadastrado."
      noMatchText={(termo) => `Nenhum fornecedor encontrado para “${termo}”.`}
      disabled={disabled}
    />
  );
}
