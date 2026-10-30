import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { DataTable, EmptyState, KpiCard, PageHeader, Pager, PageSkeleton, QueryError, Td, Th, toggleSort, type SortState } from "@/components/shared";
import { useDebounced } from "@/hooks/use-debounced";
import { PROMO_KIND_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { listCategoriesFn } from "@/lib/server/catalog";
import { listPromotionsAdminFn, savePromotionFn, setPromotionActiveFn } from "@/lib/server/commerce";
import { isPromoLive, type Promo } from "@/lib/promo";
import { ymdLocal } from "@/lib/local-date";

export const Route = createFileRoute("/app/promocoes")({ component: PromocoesPage });

/**
 * "Ativa" aqui mostrava só `isActive` (a flag), nunca o período -- uma
 * promoção com `isActive = true` mas `endsAt` já no passado aparecia
 * "Ativa" (verde) na tela, quando o PDV (`bestPromo`/`isPromoLive`, em
 * promo.ts) já nem considera mais ela. Reaproveita a MESMA `isPromoLive`
 * que decide o preço de verdade, pra não arriscar os dois discordarem.
 */
function promoStatusBadge(p: Promo) {
  if (isPromoLive(p)) return <Badge variant="success">Ativa</Badge>;
  if (!p.isActive) return <Badge variant="muted">Inativa</Badge>;
  const today = ymdLocal();
  if (p.startsAt.slice(0, 10) > today) return <Badge variant="info">Agendada</Badge>;
  return <Badge variant="muted">Expirada</Badge>;
}

const emptyForm = {
  name: "",
  kind: "percent",
  percent: "10",
  minQty: "3",
  amount: "",
  promoPrice: "",
  buyQty: "3",
  payQty: "2",
  scope: "all" as "all" | "category" | "product",
  categoryId: "",
  startsAt: "",
  endsAt: "",
};

function PromocoesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [alternando, setAlternando] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const termo = useDebounced(q.trim(), 250);
  const [sort, setSort] = useState<SortState<"name" | "kind" | "starts" | "ends">>({ key: "name", dir: "asc" });
  function onSort(key: typeof sort.key) {
    setSort((s) => toggleSort(s, key));
    setPage(0);
  }
  const list = useQuery({
    queryKey: ["promos", "admin", termo, page, sort],
    queryFn: () =>
      listPromotionsAdminFn({
        data: { q: termo || undefined, sort: sort.key, dir: sort.dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      }),
    placeholderData: keepPreviousData,
  });
  const promos = list.data?.items ?? [];
  const promosTotal = list.data?.total ?? 0;
  const kpis = list.data?.kpis;
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategoriesFn() });
  const paginaVazia = !list.isPlaceholderData && list.data != null && promos.length === 0 && page > 0;
  useEffect(() => {
    if (paginaVazia) setPage(0);
  }, [paginaVazia]);

  // Antes nao havia como encerrar uma promocao: ela ficava "Ativa" ate o
  // fim do periodo e entrava no preco do PDV via bestPromo sem saida.
  async function alternar(id: number, isActive: boolean) {
    if (alternando !== null) return;
    setAlternando(id);
    try {
      await setPromotionActiveFn({ data: { id, isActive } });
      toast.success(isActive ? "Promoção reativada." : "Promoção desativada.");
      void qc.invalidateQueries({ queryKey: ["promos"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar a promoção.");
    } finally {
      setAlternando(null);
    }
  }

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar promoções." />;

  return (
    <div>
      <PageHeader
        title="Promoções"
        description="Percentual, valor, preço promocional, leve X pague Y e desconto por quantidade."
        actions={<Button onClick={() => setOpen(true)}>Nova promoção</Button>}
      />
      {kpis ? (
        <div className="mb-5 kpi-grid">
          <KpiCard label="Promoções" value={String(kpis.promoCount)} />
          <KpiCard label="Ativas agora" value={String(kpis.liveCount)} tone="success" />
          <KpiCard label="Agendadas" value={String(kpis.scheduledCount)} />
          <KpiCard label="Expiradas" value={String(kpis.expiredCount)} />
          <KpiCard label="Inativas" value={String(kpis.inactiveCount)} />
        </div>
      ) : null}
      <Input
        className="mb-block max-w-sm"
        placeholder="Nome da promoção"
        aria-label="Buscar promoção por nome, produto ou categoria"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
      />
      {!promos.length ? (
        <EmptyState
          title={termo ? `Nenhuma promoção encontrada para “${termo}”.` : "Você ainda não possui promoções cadastradas."}
          description={termo ? undefined : "Crie a primeira promoção para aplicar desconto automático no PDV."}
          action={termo ? undefined : <Button onClick={() => setOpen(true)}>Nova promoção</Button>}
        />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Nome</Th>
              <Th sortKey="kind" sort={sort} onSort={onSort}>Tipo</Th>
              <Th>Aplica a</Th>
              <Th sortKey="starts" sort={sort} onSort={onSort}>Período</Th>
              <Th>Status</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          }
        >
          {promos.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <Td className="font-medium">{p.name}</Td>
              <Td>{PROMO_KIND_LABELS[p.kind] ?? p.kind}</Td>
              <Td>
                {p.productName ?? (p.categoryName ? `Categoria: ${p.categoryName}` : "Todos os produtos")}
              </Td>
              <Td>
                {formatDate(p.startsAt)} – {formatDate(p.endsAt)}
              </Td>
              <Td>{promoStatusBadge(p)}</Td>
              <Td className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={alternando !== null}
                  onClick={() => void alternar(p.id, !p.isActive)}
                >
                  {p.isActive ? "Desativar" : "Ativar"}
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} pageSize={PAGE_SIZE} shown={promos.length} total={promosTotal} onPage={setPage} />
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
          {/* O servidor ja aceitava promocao por produto (e a lista mostra o
              nome dele), mas o formulario so oferecia categoria -- uma promocao
              de UM item so podia ser criada por fora da tela. */}
          <Field label="Aplica a" className="mt-block">
            <Select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}
            >
              <option value="all">Todos os produtos</option>
              <option value="category">Uma categoria</option>
              <option value="product">Um produto</option>
            </Select>
          </Field>
          {form.scope === "category" ? (
            <Field label="Categoria" className="mt-block">
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Escolha a categoria</option>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {form.scope === "product" ? (
            <Field label="Produto" className="mt-block">
              <ProductPicker activeOnly ariaLabel="Produto da promoção" value={product} onChange={setProduct} />
            </Field>
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
              if (form.scope === "category" && !form.categoryId) {
                toast.error("Escolha a categoria da promoção.");
                return;
              }
              if (form.scope === "product" && !product) {
                toast.error("Escolha o produto da promoção.");
                return;
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
                    categoryId: form.scope === "category" ? Number(form.categoryId) : null,
                    productId: form.scope === "product" ? product!.id : null,
                    startsAt: form.startsAt,
                    endsAt: form.endsAt,
                  },
                });
                toast.success("Promoção criada.");
                setOpen(false);
                // Sem isto o formulario reabria com a promocao anterior preenchida.
                setForm(emptyForm);
                setProduct(null);
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
