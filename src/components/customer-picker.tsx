import { SearchPicker } from "@/components/search-picker";
import { formatBRL, formatDoc } from "@/lib/format";
import { listCustomersFn } from "@/lib/server/party";

export type PickedCustomer = { id: number; name: string };

type Props = {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  /** Texto do campo vazio — também diz o que "nenhum" significa ("Sem cliente"). */
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

type CustomerHit = Awaited<ReturnType<typeof listCustomersFn>>["items"][number];

/** Escolha de UM cliente por busca digitada (nome, documento ou telefone). */
export function CustomerPicker({ value, onChange, placeholder, disabled, ariaLabel }: Props) {
  return (
    <SearchPicker<CustomerHit, PickedCustomer>
      value={value}
      onChange={onChange}
      // Começa por "customers": salvar/editar cliente invalida ["customers"].
      queryKey={["customers", "picker"]}
      search={(term, limit) => listCustomersFn({ data: { q: term || undefined, limit } })}
      toValue={(c) => ({ id: c.id, name: c.name })}
      describe={(c) => ({
        title: c.name,
        subtitle: [c.document ? formatDoc(c.document) : null, c.phone].filter(Boolean).join(" · ") || "sem documento",
        aside: c.open_balance > 0 ? `débito ${formatBRL(c.open_balance)}` : undefined,
      })}
      placeholder={placeholder ?? "Digite nome, documento ou telefone"}
      ariaLabel={ariaLabel ?? "Buscar cliente por nome, documento ou telefone"}
      changeLabel="Trocar cliente"
      listLabel="Clientes encontrados"
      emptyText="Nenhum cliente cadastrado."
      noMatchText={(termo) => `Nenhum cliente encontrado para “${termo}”.`}
      disabled={disabled}
    />
  );
}
