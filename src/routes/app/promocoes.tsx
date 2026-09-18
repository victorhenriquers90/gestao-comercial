import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { PROMO_KIND_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { listPromotionsFn, savePromotionFn } from "@/lib/server/commerce";

export const Route = createFileRoute("/app/promocoes")({ component: PromocoesPage });

function PromocoesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    kind: "percent",
    percent: "10",
    minQty: "3",
    startsAt: "",
    endsAt: "",
  });
  const [salvando, setSalvando] = useState(false);
  const list = useQuery({ queryKey: ["promos"], queryFn: () => listPromotionsFn() });
  if (list.isPending) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Promoções"
        description="Percentual, valor, preço promocional, leve X pague Y e desconto por quantidade."
        actions={<Button onClick={() => setOpen(true)}>Nova promoção</Button>}
      />
      <DataTable
        headers={
          <tr>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>Período</Th>
            <Th>Status</Th>
          </tr>
        }
      >
        {(list.data ?? []).map((p) => (
          <tr key={p.id} className="border-b border-border last:border-0">
            <Td className="font-medium">{p.name}</Td>
            <Td>{PROMO_KIND_LABELS[p.kind] ?? p.kind}</Td>
            <Td>
              {formatDate(p.startsAt)} – {formatDate(p.endsAt)}
            </Td>
            <Td>
              <Badge variant={p.isActive ? "success" : "muted"}>{p.isActive ? "Ativa" : "Inativa"}</Badge>
            </Td>
          </tr>
        ))}
      </DataTable>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova promoção</DialogTitle>
          </DialogHeader>
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Tipo" className="mt-block">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(PROMO_KIND_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Percentual" className="mt-block">
            <Input value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          </Field>
          <Field label="Quantidade mínima" className="mt-block">
            <Input value={form.minQty} onChange={(e) => setForm({ ...form, minQty: e.target.value })} />
          </Field>
          <div className="mt-block grid grid-cols-2 gap-2">
            <Field label="Início">
              <Input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </Field>
            <Field label="Fim">
              <Input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </Field>
          </div>
          {/* Sem try/catch, uma recusa do servidor nao mostrava NADA: nao vinha
              o toast de sucesso (o throw pula ele), o dialogo nao fechava e
              nenhum erro aparecia -- o usuario clicava de novo achando que o
              botao nao pegou. Sem trava, esses cliques repetidos criavam
              promocoes duplicadas, que entram no preco do PDV via bestPromo. */}
          <Button
            className="mt-4"
            disabled={salvando}
            onClick={async () => {
              if (salvando) return;
              if (!form.name.trim()) {
                toast.error("Dê um nome à promoção.");
                return;
              }
              setSalvando(true);
              try {
                await savePromotionFn({
                  data: {
                    name: form.name,
                    kind: form.kind,
                    percent: Number(form.percent),
                    minQty: Number(form.minQty),
                    startsAt: form.startsAt,
                    endsAt: form.endsAt,
                  },
                });
                toast.success("Promoção criada.");
                setOpen(false);
                void qc.invalidateQueries({ queryKey: ["promos"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha ao criar a promoção.");
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
