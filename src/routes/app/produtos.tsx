import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageField } from "@/components/image-editor";
import { PriceTags, type PriceTagItem } from "@/components/price-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { DataTable, EmptyState, PageHeader, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { useSearchId } from "@/hooks/use-search-id";
import { useSelection } from "@/hooks/use-selection";
import { UNITS } from "@/lib/constants";
import { formatBRL, formatQty, marginPct } from "@/lib/format";
import { getProductFn, listCategoriesFn, listProductsFn, saveProductFn } from "@/lib/server/catalog";
import { parseBarcode } from "@/lib/check-digit";

export const Route = createFileRoute("/app/produtos")({ component: ProdutosPage });

const empty = {
  name: "",
  sku: "",
  barcode: "",
  internalCode: "",
  description: "",
  unit: "UN",
  cost: 0,
  price: 0,
  promoPrice: "" as string | number,
  minStock: 0,
  location: "",
  imageUrl: "",
  isActive: true,
  categoryId: "" as string | number,
  variantsText: "",
  ncm: "",
  cfop: "5102",
};

function ProdutosPage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const searchId = useSearchId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<number | undefined>();
  const openedFor = useRef<number | null>(null);

  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategoriesFn() });
  const list = useQuery({
    queryKey: ["products", q, storeId],
    queryFn: () => listProductsFn({ data: { q: q || undefined, storeId: storeId ?? undefined } }),
  });

  const [tagsFor, setTagsFor] = useState<number | null>(null);
  const tagsProduct = useQuery({
    queryKey: ["product-tags", tagsFor, storeId],
    queryFn: () => getProductFn({ data: { id: tagsFor!, storeId: storeId ?? undefined } }),
    enabled: tagsFor != null,
  });
  const tagItems: PriceTagItem[] = (() => {
    const d = tagsProduct.data;
    if (!d) return [];
    const product = d.product as Record<string, unknown>;
    const variants = d.variants as Record<string, unknown>[];
    const productName = String(product.name ?? "");
    const productPrice = Number(product.price ?? 0);
    const productCode = product.barcode ? String(product.barcode) : product.sku ? String(product.sku) : null;
    if (!variants.length) {
      return [{ key: "base", title: productName, price: productPrice, code: productCode }];
    }
    return variants.map((v) => ({
      key: Number(v.id),
      title: productName,
      subtitle: [v.color, v.size, v.model].filter(Boolean).join(" · ") || null,
      price: v.price != null ? Number(v.price) : productPrice,
      code: v.barcode ? String(v.barcode) : v.sku ? String(v.sku) : productCode,
    }));
  })();

  useEffect(() => {
    if (!searchId || openedFor.current === searchId) return;
    const openFrom = (id: number, fields: Partial<typeof empty>) => {
      openedFor.current = id;
      setEditId(id);
      setForm({ ...empty, ...fields });
      setOpen(true);
    };
    const p = list.data?.find((x) => x.id === searchId);
    if (p) {
      openFrom(p.id, {
        name: p.name,
        sku: p.sku ?? "",
        barcode: p.barcode ?? "",
        internalCode: p.internalCode ?? "",
        unit: p.unit,
        cost: p.cost,
        price: p.price,
        promoPrice: p.promoPrice ?? "",
        minStock: p.minStock,
        location: p.location ?? "",
        imageUrl: p.imageUrl ?? "",
        isActive: p.isActive,
        ncm: p.ncm ?? "",
        cfop: p.cfop ?? "5102",
      });
      return;
    }
    if (list.isPending) return;
    void getProductFn({ data: { id: searchId, storeId: storeId ?? undefined } })
      .then((d) => {
        const pr = d.product as Record<string, unknown>;
        openFrom(searchId, {
          name: String(pr.name ?? ""),
          sku: pr.sku ? String(pr.sku) : "",
          barcode: pr.barcode ? String(pr.barcode) : "",
          internalCode: pr.internal_code ? String(pr.internal_code) : "",
          unit: String(pr.unit ?? "UN"),
          cost: Number(pr.cost ?? 0),
          price: Number(pr.price ?? 0),
          promoPrice: pr.promo_price == null ? "" : Number(pr.promo_price),
          minStock: Number(pr.min_stock ?? 0),
          location: pr.location ? String(pr.location) : "",
          imageUrl: pr.image_url ? String(pr.image_url) : "",
          isActive: Boolean(pr.is_active),
          categoryId: pr.category_id == null ? "" : Number(pr.category_id),
          ncm: pr.ncm ? String(pr.ncm) : "",
          cfop: pr.cfop ? String(pr.cfop) : "5102",
        });
      })
      .catch(() => toast.error("Produto não encontrado."));
  }, [searchId, list.data, list.isPending, storeId]);

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar produtos." />;

  async function save() {
    try {
      const variants = form.variantsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [color, size] = l.split("/").map((s) => s.trim());
          return { color: color || undefined, size: size || undefined };
        });
      parseBarcode(form.barcode || undefined);
      await saveProductFn({
        data: {
          id: editId,
          name: form.name,
          sku: form.sku || undefined,
          barcode: form.barcode || undefined,
          internalCode: form.internalCode || undefined,
          description: form.description || undefined,
          unit: form.unit,
          cost: Number(form.cost),
          price: Number(form.price),
          promoPrice: form.promoPrice === "" ? null : Number(form.promoPrice),
          minStock: Number(form.minStock),
          location: form.location || undefined,
          imageUrl: form.imageUrl || null,
          isActive: form.isActive,
          categoryId: form.categoryId === "" ? null : Number(form.categoryId),
          ncm: form.ncm || undefined,
          cfop: form.cfop || undefined,
          variants: variants.length ? variants : undefined,
        },
      });
      toast.success("Produto salvo.");
      setOpen(false);
      setForm(empty);
      setEditId(undefined);
      void qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  }

  return (
    <div>
      <PageHeader
        title="Produtos"
        description="Cadastro, grades e precificação."
        actions={
          <Button
            onClick={() => {
              setEditId(undefined);
              setForm(empty);
              setOpen(true);
            }}
          >
            Novo produto
          </Button>
        }
      />
      <Input className="mb-4 max-w-sm" placeholder="Buscar nome, SKU ou código" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.data?.length ? (
        <EmptyState title="Você ainda não possui produtos cadastrados." description="Cadastre o primeiro item para vender no PDV." action={<Button onClick={() => setOpen(true)}>Cadastrar primeiro produto</Button>} />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Produto</Th>
              <Th>SKU</Th>
              <Th>Categoria</Th>
              <Th>Custo</Th>
              <Th>Preço</Th>
              <Th>Margem</Th>
              <Th>Estoque</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          }
        >
          {list.data.map((p) => (
            <tr
              key={p.id}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              onClick={() => {
                setEditId(p.id);
                setForm({
                  ...empty,
                  name: p.name,
                  sku: p.sku ?? "",
                  barcode: p.barcode ?? "",
                  internalCode: p.internalCode ?? "",
                  unit: p.unit,
                  cost: p.cost,
                  price: p.price,
                  promoPrice: p.promoPrice ?? "",
                  minStock: p.minStock,
                  location: p.location ?? "",
                  imageUrl: p.imageUrl ?? "",
                  isActive: p.isActive,
                  ncm: p.ncm ?? "",
                  cfop: p.cfop ?? "5102",
                });
                setOpen(true);
              }}
            >
              <Td>
                <div className="flex items-center gap-3">
                  <span className="tile-photo size-10 shrink-0">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="tile-photo-fallback">{p.name.slice(0, 1)}</span>}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.barcode}</p>
                  </div>
                </div>
              </Td>
              <Td>{p.sku ?? "—"}</Td>
              <Td>{p.category ?? "—"}</Td>
              <Td className="tabular">{formatBRL(p.cost)}</Td>
              <Td className="tabular">{formatBRL(p.price)}</Td>
              <Td className="tabular">{marginPct(p.price, p.cost).toFixed(1)}%</Td>
              <Td className="tabular">{formatQty(p.stock)}</Td>
              <Td>
                <Badge variant={p.isActive ? "success" : "muted"}>{p.isActive ? "Ativo" : "Inativo"}</Badge>
              </Td>
              <Td>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Imprimir etiqueta"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagsFor(p.id);
                  }}
                >
                  <Printer className="size-3.5" />
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-block sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ImageField
                value={form.imageUrl}
                onChange={(imageUrl) => setForm({ ...form, imageUrl })}
                label="Foto do produto"
                aspect="1:1"
                maxPx={720}
                suggest={form.name}
                kind="product"
              />
            </div>
            <Field label="Nome" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="SKU">
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </Field>
            <Field label="Código de barras">
              <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </Field>
            <Field label="Código interno">
              <Input value={form.internalCode} onChange={(e) => setForm({ ...form, internalCode: e.target.value })} />
            </Field>
            <Field label="NCM">
              <Input
                value={form.ncm}
                inputMode="numeric"
                placeholder="00000000"
                onChange={(e) => setForm({ ...form, ncm: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Classificação fiscal — exigida pra emitir NFC-e.</p>
            </Field>
            <Field label="CFOP">
              <Input value={form.cfop} onChange={(e) => setForm({ ...form, cfop: e.target.value })} />
            </Field>
            <Field label="Unidade">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">—</option>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Custo">
              <Input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} />
            </Field>
            <Field label="Preço">
              <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
            </Field>
            <Field label="Preço promocional">
              <Input value={form.promoPrice} onChange={(e) => setForm({ ...form, promoPrice: e.target.value })} />
            </Field>
            <Field label="Estoque mínimo">
              <Input type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} />
            </Field>
            <Field label="Localização" className="sm:col-span-2">
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Variações (cor / tamanho, uma por linha)" className="sm:col-span-2">
              <Textarea
                placeholder={"Preta / P\nPreta / M\nBranca / P"}
                value={form.variantsText}
                onChange={(e) => setForm({ ...form, variantsText: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <NativeCheckbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Ativo
            </label>
          </div>
          <Button className="mt-4 w-full" onClick={() => void save()}>
            Salvar
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={tagsFor != null} onOpenChange={(v) => !v && setTagsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Etiquetas</DialogTitle>
          </DialogHeader>
          {tagsProduct.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <PriceTags items={tagItems} onClose={() => setTagsFor(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
