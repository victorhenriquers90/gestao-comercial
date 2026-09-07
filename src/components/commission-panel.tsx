import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Layers, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { DataTable, EmptyState, KpiCard, Td, Th } from "@/components/shared";
import { TaxBreakdown } from "@/components/tax-breakdown";
import { COMMISSION_KIND_LABELS, PAYMENT_LABELS, TIER_BASIS_LABELS, type PaymentMethod } from "@/lib/constants";
import { formatBRL } from "@/lib/format";
import { listCategoriesFn, listProductsFn } from "@/lib/server/catalog";
import {
  deleteCommissionRuleFn,
  listCommissionRulesFn,
  saveCommissionRuleFn,
  simulateCommissionFn,
  suggestCommissionRulesFn,
} from "@/lib/server/commission";

type SellerOpt = { id: number; name: string; commission_pct: number; month_revenue?: number };
type TierRow = { min: string; percent: string };

const emptyTiers = (): TierRow[] => [
  { min: "0", percent: "5" },
  { min: "8000", percent: "7" },
  { min: "18000", percent: "9" },
];

const emptyForm = {
  id: undefined as number | undefined,
  name: "",
  kind: "percent_sales",
  percent: "6",
  sellerId: "",
  categoryId: "",
  productId: "",
  paymentMethod: "",
  minAmount: "",
  skipPromo: false,
  onlyPromo: false,
  priority: "0",
  isActive: true,
  tierBasis: "none",
  tiers: emptyTiers(),
};

function scopeLabel(r: {
  sellerName: string | null;
  categoryName: string | null;
  productName: string | null;
  paymentMethod: string | null;
}) {
  const bits: string[] = [];
  if (r.productName) bits.push(r.productName);
  if (r.categoryName) bits.push(r.categoryName);
  if (r.sellerName) bits.push(r.sellerName);
  if (r.paymentMethod) bits.push(PAYMENT_LABELS[r.paymentMethod as PaymentMethod] ?? r.paymentMethod);
  return bits.length ? bits.join(" · ") : "Toda a loja";
}

function rateLabel(r: {
  kind: string;
  percent: number;
  tiers: { min: number; percent: number }[];
  tierBasis: string;
}) {
  if (r.kind === "exclude") return "—";
  if (r.kind === "fixed_unit") return `${formatBRL(r.percent)}/un`;
  if (r.tiers?.length && r.tierBasis !== "none") {
    const pcts = r.tiers.map((t) => t.percent);
    const lo = Math.min(...pcts);
    const hi = Math.max(...pcts);
    return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
  }
  return `${r.percent}%`;
}

function lineRate(fixed: boolean, percent: number) {
  if (fixed) return `${formatBRL(percent)}/un`;
  if (percent === 0) return "0%";
  return `${percent}%`;
}

export function CommissionRulesTab({ sellers }: { sellers: SellerOpt[] }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => listCommissionRulesFn() });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategoriesFn() });
  const products = useQuery({
    queryKey: ["products", "rules"],
    queryFn: () => listProductsFn({ data: { active: true } }),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  function startNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  function startEdit(r: NonNullable<typeof rules.data>[number]) {
    setForm({
      id: r.id,
      name: r.name,
      kind: r.kind,
      percent: String(r.percent),
      sellerId: r.sellerId != null ? String(r.sellerId) : "",
      categoryId: r.categoryId != null ? String(r.categoryId) : "",
      productId: r.productId != null ? String(r.productId) : "",
      paymentMethod: r.paymentMethod ?? "",
      minAmount: r.minAmount ? String(r.minAmount) : "",
      skipPromo: r.skipPromo,
      onlyPromo: r.onlyPromo,
      priority: String(r.priority ?? 0),
      isActive: r.isActive,
      tierBasis: r.tierBasis ?? "none",
      tiers: r.tiers?.length
        ? r.tiers.map((t) => ({ min: String(t.min), percent: String(t.percent) }))
        : emptyTiers(),
    });
    setOpen(true);
  }

  function payload() {
    return {
      id: form.id,
      name: form.name,
      kind: form.kind,
      percent: Number(form.percent) || 0,
      sellerId: form.sellerId ? Number(form.sellerId) : null,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      productId: form.productId ? Number(form.productId) : null,
      paymentMethod: form.paymentMethod || null,
      minAmount: form.minAmount ? Number(form.minAmount) : 0,
      skipPromo: form.skipPromo,
      onlyPromo: form.onlyPromo,
      priority: Number(form.priority) || 0,
      isActive: form.isActive,
      tierBasis: form.kind === "percent_sales" || form.kind === "percent_profit" ? form.tierBasis : "none",
      tiers:
        form.tierBasis !== "none" && (form.kind === "percent_sales" || form.kind === "percent_profit")
          ? form.tiers
              .map((t) => ({ min: Number(t.min) || 0, percent: Number(t.percent) || 0 }))
              .filter((t) => t.percent >= 0)
          : [],
    };
  }

  async function save() {
    try {
      await saveCommissionRuleFn({ data: payload() });
      toast.success(form.id ? "Regra atualizada." : "Regra criada.");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["commission-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  }

  async function toggleActive(r: NonNullable<typeof rules.data>[number]) {
    try {
      await saveCommissionRuleFn({
        data: {
          id: r.id,
          name: r.name,
          kind: r.kind,
          percent: r.percent,
          sellerId: r.sellerId,
          categoryId: r.categoryId,
          productId: r.productId,
          paymentMethod: r.paymentMethod,
          minAmount: r.minAmount,
          skipPromo: r.skipPromo,
          onlyPromo: r.onlyPromo,
          priority: r.priority,
          isActive: !r.isActive,
          tiers: r.tiers,
          tierBasis: r.tierBasis,
        },
      });
      toast.success(r.isActive ? "Regra pausada." : "Regra reativada.");
      void qc.invalidateQueries({ queryKey: ["commission-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  async function remove(id: number) {
    try {
      const res = await deleteCommissionRuleFn({ data: { id } });
      toast.success(res.deactivated ? "Regra desativada — já havia pagamentos ligados a ela." : "Regra excluída.");
      void qc.invalidateQueries({ queryKey: ["commission-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  async function suggest() {
    try {
      const res = await suggestCommissionRulesFn();
      toast.success(`${res.inserted} regras sugeridas aplicadas.`);
      void qc.invalidateQueries({ queryKey: ["commission-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  const rows = rules.data ?? [];
  const showTiers = (form.kind === "percent_sales" || form.kind === "percent_profit") && form.tierBasis !== "none";

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex items-start gap-3">
          <Layers className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">A regra mais específica vence</p>
            <p className="mt-1">
              Produto → categoria → vendedor → forma de pagamento → faixa de volume → percentual padrão.
              Faixas olham o total da venda ou o faturamento do vendedor no mês. Valor fixo paga por peça, não
              por percentual.
            </p>
          </div>
        </div>
      </Card>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => void suggest()}>
          Pacote sugerido
        </Button>
        <Button onClick={startNew}>
          <Plus className="size-4" />
          Nova regra
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma regra ainda"
          description="Sem regras, cada venda usa só o percentual padrão do vendedor. Crie uma ou aplique o pacote sugerido (categorias, crédito, promoção, faixa mensal e valor por peça)."
          action={
            <Button className="mt-2" onClick={() => void suggest()}>
              Aplicar pacote sugerido
            </Button>
          }
        />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Regra</Th>
              <Th>Tipo</Th>
              <Th>Aplica em</Th>
              <Th>%</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <Td className="font-medium">
                {r.name || "Sem nome"}
                {r.onlyPromo ? (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Só itens em promoção</span>
                ) : null}
                {r.skipPromo ? (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Ignora promoção</span>
                ) : null}
                {r.tiers?.length && r.tierBasis !== "none" ? (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {TIER_BASIS_LABELS[r.tierBasis] ?? r.tierBasis}
                    {": "}
                    {r.tiers.map((t) => `${formatBRL(t.min)} → ${t.percent}%`).join(" · ")}
                  </span>
                ) : null}
              </Td>
              <Td>{COMMISSION_KIND_LABELS[r.kind] ?? r.kind}</Td>
              <Td>{scopeLabel(r)}</Td>
              <Td className="tabular">{rateLabel(r)}</Td>
              <Td>
                <Badge variant={r.isActive ? "success" : "muted"}>{r.isActive ? "Ativa" : "Pausada"}</Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleActive(r)}>
                    {r.isActive ? "Pausar" : "Ativar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                    Excluir
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar regra" : "Nova regra de comissão"}</DialogTitle>
          </DialogHeader>
          <Field label="Nome">
            <Input
              value={form.name}
              placeholder="Ex.: Camisetas 7%"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  setForm({
                    ...form,
                    kind,
                    tierBasis: kind === "percent_sales" || kind === "percent_profit" ? form.tierBasis : "none",
                  });
                }}
              >
                {Object.entries(COMMISSION_KIND_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            {form.kind === "exclude" ? (
              <Field label="Percentual">
                <Input value="0" disabled />
              </Field>
            ) : form.kind === "fixed_unit" ? (
              <Field label="R$ por unidade">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.percent}
                  onChange={(e) => setForm({ ...form, percent: e.target.value })}
                />
              </Field>
            ) : showTiers ? (
              <Field label="% comissão">
                <Input value="Nas faixas" disabled />
              </Field>
            ) : (
              <Field label="% comissão">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.percent}
                  onChange={(e) => setForm({ ...form, percent: e.target.value })}
                />
              </Field>
            )}
          </div>
          {form.kind === "percent_sales" || form.kind === "percent_profit" ? (
            <Field label="Faixa de volume" className="mt-3">
              <Select
                value={form.tierBasis}
                onChange={(e) => {
                  const tierBasis = e.target.value;
                  setForm({
                    ...form,
                    tierBasis,
                    tiers: tierBasis === "none" ? form.tiers : form.tiers.length ? form.tiers : emptyTiers(),
                  });
                }}
              >
                {Object.entries(TIER_BASIS_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {showTiers ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                A faixa mais alta que o volume atingir vale para a venda inteira. Abaixo do menor mínimo, a regra
                não se aplica.
              </p>
              {form.tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label={i === 0 ? "A partir de (R$)" : " "}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={t.min}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tiers: form.tiers.map((row, idx) => (idx === i ? { ...row, min: e.target.value } : row)),
                        })
                      }
                    />
                  </Field>
                  <Field label={i === 0 ? "%" : " "}>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={t.percent}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tiers: form.tiers.map((row, idx) =>
                            idx === i ? { ...row, percent: e.target.value } : row,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="mb-0.5"
                    onClick={() => setForm({ ...form, tiers: form.tiers.filter((_, idx) => idx !== i) })}
                    disabled={form.tiers.length <= 1}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm({ ...form, tiers: [...form.tiers, { min: "", percent: "" }] })}
              >
                Adicionar faixa
              </Button>
            </div>
          ) : null}
          <Field label="Vendedor" className="mt-3">
            <Select value={form.sellerId} onChange={(e) => setForm({ ...form, sellerId: e.target.value })}>
              <option value="">Todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Todas</option>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Produto">
              <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">Todos</option>
                {(products.data ?? []).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Forma de pagamento">
              <Select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              >
                <option value="">Qualquer</option>
                {Object.entries(PAYMENT_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valor mínimo do item">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.minAmount}
                placeholder="0"
                onChange={(e) => setForm({ ...form, minAmount: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Prioridade (desempate)" className="mt-3">
            <Input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            />
          </Field>
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <NativeCheckbox
                checked={form.skipPromo}
                onChange={(e) =>
                  setForm({
                    ...form,
                    skipPromo: e.target.checked,
                    onlyPromo: e.target.checked ? false : form.onlyPromo,
                  })
                }
              />
              Ignorar itens com desconto
            </label>
            <label className="flex items-center gap-2">
              <NativeCheckbox
                checked={form.onlyPromo}
                onChange={(e) =>
                  setForm({
                    ...form,
                    onlyPromo: e.target.checked,
                    skipPromo: e.target.checked ? false : form.skipPromo,
                  })
                }
              />
              Somente itens em promoção
            </label>
            <label className="flex items-center gap-2">
              <NativeCheckbox
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Regra ativa
            </label>
          </div>
          <Button className="mt-4" onClick={() => void save()}>
            Salvar regra
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CommissionSimTab({ sellers }: { sellers: SellerOpt[] }) {
  const [sellerId, setSellerId] = useState(sellers[0] ? String(sellers[0].id) : "");
  const [payment, setPayment] = useState("pix");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [discount, setDiscount] = useState("");
  const [monthOverride, setMonthOverride] = useState("");
  const [items, setItems] = useState<{ productId: number; name: string; quantity: number; discount: number }[]>([]);

  const products = useQuery({
    queryKey: ["products", "sim"],
    queryFn: () => listProductsFn({ data: { active: true } }),
  });

  const seller = sellers.find((s) => String(s.id) === sellerId);
  const monthRevenue = monthOverride === "" ? seller?.month_revenue : Number(monthOverride) || 0;

  const sim = useQuery({
    queryKey: ["commission-sim", sellerId, payment, items, monthOverride],
    queryFn: () =>
      simulateCommissionFn({
        data: {
          sellerId: Number(sellerId),
          paymentMethod: payment,
          monthRevenue: monthOverride === "" ? undefined : Number(monthOverride) || 0,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            discount: i.discount,
          })),
        },
      }),
    enabled: Boolean(sellerId) && items.length > 0,
  });

  const productMap = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  function addItem() {
    const id = Number(productId);
    const p = productMap.get(id);
    if (!p) {
      toast.error("Escolha um produto.");
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        productId: id,
        name: p.name,
        quantity: Math.max(1, Number(qty) || 1),
        discount: Math.max(0, Number(discount) || 0),
      },
    ]);
    setDiscount("");
  }

  const result = sim.data;

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            Monte uma venda fictícia para ver qual regra pega cada item — inclusive faixas do mês, valor por peça e bônus de meta.
            Nada é registrado no caixa.
          </p>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Vendedor">
          <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
            {sellers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} · {s.commission_pct}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pagamento">
          <Select value={payment} onChange={(e) => setPayment(e.target.value)}>
            {Object.entries(PAYMENT_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Já vendido no mês">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder={seller?.month_revenue != null ? formatBRL(seller.month_revenue) : "0"}
            value={monthOverride}
            onChange={(e) => setMonthOverride(e.target.value)}
          />
        </Field>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Faturamento considerado: {formatBRL(monthRevenue ?? 0)}. Deixe em branco para usar o real do mês.
      </p>
      <Field label="Produto" className="mt-3 min-w-0">
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="max-w-full">
          <option value="">Selecione</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name} · {formatBRL(p.price)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Quantidade" className="w-28">
          <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Desconto" className="w-32">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
        <Button variant="outline" onClick={addItem}>
          Adicionar item
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="Monte o carrinho"
            description="Adicione camisetas, um acessório ou um item genérico para ver faixa mensal versus regra de categoria."
          />
        </div>
      ) : (
        <>
          <div className="mt-5 kpi-grid">
            <KpiCard label="Comissão bruta" value={formatBRL(result?.amount ?? 0)} />
            <KpiCard
              label={`Só o padrão (${seller?.commission_pct ?? 0}%)`}
              value={formatBRL(result?.defaultAmount ?? 0)}
            />
            <KpiCard
              label="Retenções"
              value={formatBRL(result?.tax?.totalTax ?? 0)}
              tone={(result?.tax?.totalTax ?? 0) > 0.009 ? "warning" : "default"}
            />
            <KpiCard
              label="Líquido"
              value={formatBRL(result?.tax?.net ?? result?.amount ?? 0)}
              tone="success"
              hint={result?.tax?.note}
            />
          </div>
          {result?.tax && result.amount > 0.009 ? (
            <div className="mt-4">
              <TaxBreakdown tax={result.tax} compact />
            </div>
          ) : null}
          {result?.volumeNote ? (
            <p className="mt-3 text-sm text-muted-foreground">{result.volumeNote}</p>
          ) : null}
          {result?.bonusNote ? (
            <p className="mt-1 text-sm text-primary">{result.bonusNote}</p>
          ) : null}
          {result?.targetHints?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {result.targetHints.map((h) => (
                <li key={h.id}>
                  {h.name}: {h.bonusHint}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4">
            <DataTable
              headers={
                <tr>
                  <Th>Item</Th>
                  <Th>Qtd</Th>
                  <Th>Regra aplicada</Th>
                  <Th>Base</Th>
                  <Th>%</Th>
                  <Th>Comissão</Th>
                  <Th></Th>
                </tr>
              }
            >
              {items.map((item, idx) => {
                const line = result?.lines[idx];
                const fixed = Boolean(line?.reason.includes("por peça") || line?.reason.includes("por unidade"));
                return (
                  <tr key={`${item.productId}-${idx}`} className="border-b border-border last:border-0">
                    <Td className="font-medium">
                      {item.name}
                      {item.discount > 0 ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          desconto {formatBRL(item.discount)}
                        </span>
                      ) : null}
                      {line?.reason ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{line.reason}</span>
                      ) : null}
                    </Td>
                    <Td className="tabular">{item.quantity}</Td>
                    <Td>{line?.ruleName ?? "…"}</Td>
                    <Td className="tabular">{line ? (fixed ? line.base : formatBRL(line.base)) : "—"}</Td>
                    <Td className="tabular">{line ? lineRate(fixed, line.percent) : "—"}</Td>
                    <Td className="tabular">{line ? formatBRL(line.amount) : "—"}</Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Tirar
                      </Button>
                    </Td>
                  </tr>
                );
              })}
              {(result?.lines ?? []).slice(items.length).map((line, i) => (
                <tr key={`bonus-${i}`} className="border-b border-border last:border-0">
                  <Td className="font-medium">
                    {line.productName}
                    {line.reason ? (
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{line.reason}</span>
                    ) : null}
                  </Td>
                  <Td className="tabular">—</Td>
                  <Td>{line.ruleName}</Td>
                  <Td className="tabular">{formatBRL(line.base)}</Td>
                  <Td className="tabular">{line.percent ? `${line.percent}%` : "—"}</Td>
                  <Td className="tabular">{formatBRL(line.amount)}</Td>
                  <Td></Td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
