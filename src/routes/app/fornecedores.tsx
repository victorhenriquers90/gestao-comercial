import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SupplierPanel } from "@/components/supplier-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { DataTable, EmptyState, PageHeader, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { useSearchId } from "@/hooks/use-search-id";
import { formatBRL, formatDoc } from "@/lib/format";
import { parseCnpj, maskCnpj } from "@/lib/document";
import { listSuppliersFn, saveSupplierFn } from "@/lib/server/party";

export const Route = createFileRoute("/app/fornecedores")({ component: FornecedoresPage });

function FornecedoresPage() {
  const qc = useQueryClient();
  const searchId = useSearchId();
  const [open, setOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    document: "",
    email: "",
    phone: "",
    representative: "",
    notes: "",
  });
  const list = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliersFn({ data: {} }) });

  useEffect(() => {
    if (searchId) setDetailId(searchId);
  }, [searchId]);

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar fornecedores." />;

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        description="Ficha 360, pedidos e contas a pagar vinculadas."
        actions={<Button onClick={() => setOpen(true)}>Novo fornecedor</Button>}
      />
      {!list.data?.length ? (
        <EmptyState title="Você ainda não possui fornecedores cadastrados." description="Cadastre o primeiro fornecedor para emitir pedidos de compra." />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Fornecedor</Th>
              <Th>CNPJ</Th>
              <Th>Contato</Th>
              <Th className="col-num">Comprado</Th>
              <Th>Pedidos</Th>
              <Th className="col-num">A pagar</Th>
            </tr>
          }
        >
          {list.data.map((s) => (
            <tr
              key={s.id}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              onClick={() => setDetailId(s.id)}
            >
              <Td>
                <p className="font-medium">{s.tradeName || s.legalName}</p>
                <p className="text-xs text-muted-foreground">{s.legalName}</p>
              </Td>
              <Td>{formatDoc(s.document)}</Td>
              <Td>{s.phone ?? s.email ?? "—"}</Td>
              <Td className="tabular col-num">{formatBRL(s.totalBought)}</Td>
              <Td>{s.orders}</Td>
              <Td className="tabular col-num">{formatBRL(s.openBalance)}</Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo fornecedor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-block">
            <Field label="Razão social">
              <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            </Field>
            <Field label="Nome fantasia">
              <Input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
            </Field>
            <Field label="CNPJ">
              <Input
                value={form.document}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                onChange={(e) => setForm({ ...form, document: maskCnpj(e.target.value) })}
              />
            </Field>
            <Field label="E-mail">
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Telefone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Representante">
              <Input
                value={form.representative}
                onChange={(e) => setForm({ ...form, representative: e.target.value })}
              />
            </Field>
            <Textarea
              placeholder="Observações"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <Button
              disabled={salvando}
              onClick={async () => {
                if (salvando) return;
                setSalvando(true);
                try {
                  parseCnpj(form.document);
                  await saveSupplierFn({ data: form });
                  toast.success("Fornecedor salvo.");
                  setOpen(false);
                  void qc.invalidateQueries({ queryKey: ["suppliers"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha");
                } finally {
                  setSalvando(false);
                }
              }}
            >
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SupplierPanel
        supplierId={detailId}
        open={detailId != null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      />
    </div>
  );
}
