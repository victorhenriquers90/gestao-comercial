import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, EmptyState, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { CustomerPanel } from "@/components/customer-panel";
import { useSearchId } from "@/hooks/use-search-id";
import { CRM_STAGE_LABELS, type CrmStage } from "@/lib/constants";
import { formatBRL, formatDoc } from "@/lib/format";
import { parseBrDocument, maskCnpj, maskCpf } from "@/lib/document";
import { listCustomersFn, saveCustomerFn } from "@/lib/server/party";

export const Route = createFileRoute("/app/clientes")({ component: ClientesPage });

function ClientesPage() {
  const qc = useQueryClient();
  const searchId = useSearchId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState({ kind: "pf", name: "", document: "", phone: "", email: "", city: "", creditLimit: 0, notes: "" });

  const list = useQuery({
    queryKey: ["customers", q],
    queryFn: () => listCustomersFn({ data: { q: q || undefined } }),
  });

  useEffect(() => {
    if (searchId) setDetailId(searchId);
  }, [searchId]);

  if (list.isPending) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Pessoa física, jurídica e histórico comercial."
        actions={<Button onClick={() => setOpen(true)}>Novo cliente</Button>}
      />
      <Input className="mb-4 max-w-sm" placeholder="Nome, documento ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.data?.length ? (
        <EmptyState title="Você ainda não possui clientes cadastrados." description="Cadastre o primeiro cliente para vender a prazo e usar o CRM." action={<Button onClick={() => setOpen(true)}>Cadastrar primeiro cliente</Button>} />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Nome</Th>
              <Th>Documento</Th>
              <Th>Telefone</Th>
              <Th>CRM</Th>
              <Th>Total comprado</Th>
              <Th>Em aberto</Th>
            </tr>
          }
        >
          {(list.data ?? []).map((c) => (
            <tr
              key={c.id}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              onClick={() => setDetailId(c.id)}
            >
              <Td className="font-medium">{c.name}</Td>
              <Td>{formatDoc(c.document)}</Td>
              <Td>{c.phone ?? "—"}</Td>
              <Td>
                <Badge variant={statusBadgeVariant(c.crm_stage)}>
                  {CRM_STAGE_LABELS[c.crm_stage as CrmStage] ?? c.crm_stage}
                </Badge>
              </Td>
              <Td className="tabular">{formatBRL(c.total_bought)}</Td>
              <Td className="tabular">{formatBRL(c.open_balance)}</Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="pf">Pessoa física</option>
              <option value="pj">Pessoa jurídica</option>
            </Select>
            <Field label="Nome / Razão social">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={form.kind === "pj" ? "CNPJ" : "CPF"}>
              <Input
                value={form.document}
                inputMode="numeric"
                placeholder={form.kind === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    document: form.kind === "pj" ? maskCnpj(e.target.value) : maskCpf(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="E-mail">
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Cidade">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Limite de crédito">
              <Input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })} />
            </Field>
            <Textarea placeholder="Observações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <Button
              onClick={async () => {
                try {
                  parseBrDocument(form.document, form.kind === "pj" ? "cnpj" : "cpf");
                  await saveCustomerFn({
                    data: {
                      kind: form.kind,
                      name: form.name,
                      document: form.document,
                      phone: form.phone,
                      whatsapp: form.phone,
                      email: form.email,
                      city: form.city,
                      creditLimit: form.creditLimit,
                      notes: form.notes,
                    },
                  });
                  toast.success("Cliente salvo.");
                  setOpen(false);
                  void qc.invalidateQueries({ queryKey: ["customers"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha");
                }
              }}
            >
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CustomerPanel
        customerId={detailId}
        open={detailId != null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      />
    </div>
  );
}
