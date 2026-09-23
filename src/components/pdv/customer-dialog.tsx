import { useQuery } from "@tanstack/react-query";
import { IdCard, Search } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { maskBrDoc, parseBrDocument } from "@/lib/document";
import { formatBRL, formatDoc } from "@/lib/format";
import { listCustomersFn } from "@/lib/server/party";
import { cn } from "@/lib/utils";

type Customer = Awaited<ReturnType<typeof listCustomersFn>>[number];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cpf: string;
  onCpf: (v: string) => void;
  customerId: number | null;
  onCustomer: (c: Customer | null) => void;
  onSkip: () => void;
};

/** F4: documento na nota e/ou cliente do cadastro. */
export function CustomerDialog(p: Props) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "pf" | "pj">("");
  const [debit, setDebit] = useState(false);
  const customers = useQuery({
    queryKey: ["customers", q, kind, debit],
    queryFn: () =>
      listCustomersFn({ data: { q: q.trim() || undefined, kind: kind || undefined, debit: debit || undefined } }),
    enabled: p.open,
  });

  function confirmar(e?: FormEvent) {
    e?.preventDefault();
    if (p.cpf.trim()) {
      try {
        parseBrDocument(p.cpf, "any");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Documento inválido.");
        return;
      }
    }
    p.onOpenChange(false);
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cliente da venda</DialogTitle>
          <DialogDescription>
            O documento vai no comprovante. Não é obrigatório: pule se o cliente não quiser informar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={confirmar}>
          <Field label="CPF ou CNPJ na nota">
            <div className="relative">
              <IdCard className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                inputMode="numeric"
                placeholder="Só números"
                value={p.cpf}
                onChange={(e) => p.onCpf(maskBrDoc(e.target.value))}
                className="h-11 rounded-sm pl-9 text-base tabular"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Se já existir no cadastro, vincula o cliente; senão cria um consumidor.
            </p>
          </Field>

          <Field label="Ou busque no cadastro" className="mt-block">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="rounded-sm pl-9"
                placeholder="Nome, telefone ou documento"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(
              [
                ["", "Todos"],
                ["pf", "PF"],
                ["pj", "PJ"],
              ] as const
            ).map(([id, label]) => (
              <Chip key={id || "all"} active={kind === id} onClick={() => setKind(id)}>
                {label}
              </Chip>
            ))}
            <Chip active={debit} onClick={() => setDebit((v) => !v)}>
              Com débito
            </Chip>
          </div>
          <Select
            className="mt-block rounded-sm"
            aria-label="Cliente cadastrado"
            value={p.customerId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const pick = (customers.data ?? []).find((c) => c.id === id) ?? null;
              p.onCustomer(pick);
              if (pick?.document) p.onCpf(maskBrDoc(pick.document));
            }}
          >
            <option value="">Consumidor (só o documento acima)</option>
            {(customers.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.document ? ` · ${formatDoc(c.document)}` : ""}
                {c.open_balance > 0 ? ` · débito ${formatBRL(c.open_balance)}` : ""}
              </option>
            ))}
          </Select>

          <div className="mt-6 flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-sm" onClick={p.onSkip}>
              Pular
            </Button>
            <Button type="submit" className="h-11 flex-1 rounded-sm">
              Confirmar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 rounded-sm border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
