import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TARGET_BONUS_KINDS, TARGET_BONUS_LABELS, type TargetBonusKind } from "@/lib/constants";
import { formatBRL, formatPct } from "@/lib/format";
import { listTargetsFn, saveTargetFn } from "@/lib/server/finance";
import { listSellersFn } from "@/lib/server/party";
import { getTenantFn } from "@/lib/server/session";

export const Route = createFileRoute("/app/metas")({ component: MetasPage });

type TargetRow = Awaited<ReturnType<typeof listTargetsFn>>[number];

function monthBounds() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const last = String(new Date(y, n.getMonth() + 1, 0).getDate()).padStart(2, "0");
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${last}` };
}

function emptyForm() {
  const { start, end } = monthBounds();
  return {
    id: undefined as number | undefined,
    name: "",
    amount: "10000",
    periodStart: start,
    periodEnd: end,
    storeId: "",
    sellerId: "",
    bonusKind: "none" as TargetBonusKind,
    bonusValue: "",
  };
}

function bonusBadge(kind: TargetBonusKind, value: number): string | null {
  if (kind === "extra_percent" && value > 0) return `+${value}% ao bater`;
  if (kind === "extra_fixed" && value > 0) return `${formatBRL(value)} no cruzamento`;
  return null;
}

function MetasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const list = useQuery({ queryKey: ["targets"], queryFn: () => listTargetsFn() });
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => listSellersFn() });
  if (list.isPending) return <PageSkeleton />;

  function startCreate() {
    setForm(emptyForm());
    setOpen(true);
  }

  function startEdit(t: TargetRow) {
    setForm({
      id: t.id,
      name: t.name,
      amount: String(t.amount),
      periodStart: String(t.period_start).slice(0, 10),
      periodEnd: String(t.period_end).slice(0, 10),
      storeId: t.store_id != null ? String(t.store_id) : "",
      sellerId: t.seller_id != null ? String(t.seller_id) : "",
      bonusKind: t.bonus_kind,
      bonusValue: t.bonus_value ? String(t.bonus_value) : "",
    });
    setOpen(true);
  }

  async function save() {
    try {
      await saveTargetFn({
        data: {
          id: form.id,
          name: form.name,
          amount: Number(form.amount),
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          storeId: form.storeId ? Number(form.storeId) : null,
          sellerId: form.sellerId ? Number(form.sellerId) : null,
          bonusKind: form.bonusKind,
          bonusValue: form.bonusValue === "" ? 0 : Number(form.bonusValue),
        },
      });
      toast.success(form.id ? "Meta atualizada." : "Meta criada.");
      setOpen(false);
      setForm(emptyForm());
      void qc.invalidateQueries({ queryKey: ["targets"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    }
  }

  const rows = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Metas"
        description="Acompanhe o progresso e ligue um bônus de comissão quando o vendedor bater a meta."
        actions={<Button onClick={startCreate}>Nova meta</Button>}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma meta neste período"
          description="Crie uma meta de loja para acompanhar o faturamento, ou uma meta de vendedor com bônus de comissão."
          action={<Button onClick={startCreate}>Nova meta</Button>}
        />
      ) : (
        <div className="grid gap-block md:grid-cols-2">
          {rows.map((t) => {
            const badge = bonusBadge(t.bonus_kind, t.bonus_value);
            const hit = t.progress + 0.05 >= 100;
            return (
              <Card key={t.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(t.period_start).slice(0, 10)} → {String(t.period_end).slice(0, 10)}
                      {t.store_name ? ` · ${t.store_name}` : ""}
                      {t.seller_name ? ` · ${t.seller_name}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {hit ? <Badge variant="success">Meta batida</Badge> : null}
                      {badge ? <Badge variant={hit ? "default" : "outline"}>{badge}</Badge> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular text-sm">{formatPct(t.progress)}</span>
                    <Button size="icon-sm" variant="ghost" onClick={() => startEdit(t)} aria-label="Editar meta">
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, t.progress)}%` }} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatBRL(t.realized)} de {formatBRL(t.amount)}
                </p>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setForm(emptyForm());
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar meta" : "Nova meta"}</DialogTitle>
          </DialogHeader>
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Valor" className="mt-block">
            <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <div className="mt-block grid grid-cols-2 gap-2">
            <Field label="Início">
              <Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
            </Field>
            <Field label="Fim">
              <Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
            </Field>
          </div>
          <Field label="Loja" className="mt-block">
            <Select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              <option value="">Todas</option>
              {(tenant.data?.stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vendedor" className="mt-block">
            <Select value={form.sellerId} onChange={(e) => setForm({ ...form, sellerId: e.target.value })}>
              <option value="">Todos</option>
              {(sellers.data as { id: number; name: string }[] | undefined)?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bônus de comissão" className="mt-block">
            <Select
              value={form.bonusKind}
              onChange={(e) => setForm({ ...form, bonusKind: e.target.value as TargetBonusKind })}
            >
              {TARGET_BONUS_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TARGET_BONUS_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          {form.bonusKind !== "none" ? (
            <>
              <Field
                label={form.bonusKind === "extra_percent" ? "Percentual de bônus" : "Valor do bônus"}
                className="mt-block"
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.bonusValue}
                  onChange={(e) => setForm({ ...form, bonusValue: e.target.value })}
                  placeholder={form.bonusKind === "extra_percent" ? "2" : "150"}
                />
              </Field>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {form.bonusKind === "extra_percent"
                  ? "Soma um percentual sobre o total de cada venda a partir do momento em que a meta é batida. Exige um vendedor."
                  : "Paga um valor fixo uma vez, na venda que cruzar a meta. Exige um vendedor."}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Metas de loja acompanham o faturamento. Para pagar bônus, escolha um vendedor.
            </p>
          )}
          <Button className="mt-4" onClick={() => void save()}>
            Salvar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
