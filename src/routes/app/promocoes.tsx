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
    amount: "",
    promoPrice: "",
    buyQty: "3",
    payQty: "2",
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
          {/* Cada tipo usa um numero diferente -- "Fixo"/"Preco promocional"/
              "Leve X pague Y" nao usam percentual nenhum, e antes desta
              correcao o formulario so tinha campo pra percentual/quantidade
              minima: escolher qualquer um dos outros tres tipos salvava uma
              promocao "Ativa" que nunca dava desconto nenhum no PDV, porque
              o valor que ela precisa (amount/promoPrice/buyQty+payQty)
              nunca chegava a ser perguntado. */}
          {form.kind === "percent" || form.kind === "qty" ? (
            <Field label="Percentual" className="mt-block">
              <Input
                type="number"
                step="0.1"
                min="0"
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
              />
            </Field>
          ) : null}
          {form.kind === "qty" ? (
            <Field label="Quantidade mínima" className="mt-block">
              <Input
                type="number"
                min="1"
                value={form.minQty}
                onChange={(e) => setForm({ ...form, minQty: e.target.value })}
              />
            </Field>
          ) : null}
          {form.kind === "fixed" ? (
            <Field label="Valor do desconto (R$)" className="mt-block">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
          ) : null}
          {form.kind === "promo_price" ? (
            <Field label="Preço promocional (R$)" className="mt-block">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.promoPrice}
                onChange={(e) => setForm({ ...form, promoPrice: e.target.value })}
              />
            </Field>
          ) : null}
          {form.kind === "bxgy" ? (
            <div className="mt-block grid grid-cols-2 gap-2">
              <Field label="Compre (quantidade)">
                <Input
                  type="number"
                  min="1"
                  value={form.buyQty}
                  onChange={(e) => setForm({ ...form, buyQty: e.target.value })}
                />
              </Field>
              <Field label="Pague (quantidade)">
                <Input
                  type="number"
                  min="1"
                  value={form.payQty}
                  onChange={(e) => setForm({ ...form, payQty: e.target.value })}
                />
              </Field>
            </div>
          ) : null}
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
              // Cada tipo exige o numero que ele realmente usa em
              // computePromo (src/lib/promo.ts) -- sem isto o servidor
              // aceitava o campo vazio/de outro tipo como null e a
              // promocao salvava "Ativa" sem nunca aplicar desconto.
              let percent: number | undefined;
              let minQty: number | undefined;
              let amount: number | undefined;
              let promoPrice: number | undefined;
              let buyQty: number | undefined;
              let payQty: number | undefined;
              if (form.kind === "percent" || form.kind === "qty") {
                percent = Number(form.percent);
                if (!Number.isFinite(percent) || percent <= 0) {
                  toast.error("Informe um percentual maior que zero.");
                  return;
                }
              }
              if (form.kind === "qty") {
                minQty = Number(form.minQty);
                if (!Number.isFinite(minQty) || minQty < 1) {
                  toast.error("Informe uma quantidade mínima de 1 ou mais.");
                  return;
                }
              }
              if (form.kind === "fixed") {
                amount = Number(form.amount);
                if (!Number.isFinite(amount) || amount <= 0) {
                  toast.error("Informe o valor do desconto.");
                  return;
                }
              }
              if (form.kind === "promo_price") {
                promoPrice = Number(form.promoPrice);
                if (!Number.isFinite(promoPrice) || promoPrice <= 0) {
                  toast.error("Informe o preço promocional.");
                  return;
                }
              }
              if (form.kind === "bxgy") {
                buyQty = Number(form.buyQty);
                payQty = Number(form.payQty);
                if (!Number.isFinite(buyQty) || !Number.isFinite(payQty) || buyQty < 2 || payQty < 1 || payQty >= buyQty) {
                  toast.error("Informe quantidades válidas: pague menos do que compre.");
                  return;
                }
              }
              setSalvando(true);
              try {
                await savePromotionFn({
                  data: {
                    name: form.name,
                    kind: form.kind,
                    percent,
                    minQty,
                    amount,
                    promoPrice,
                    buyQty,
                    payQty,
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
