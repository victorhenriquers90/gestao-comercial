import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Minus, Pause, Play, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Receipt, type ReceiptCompany, type ReceiptData } from "@/components/receipt";
import { useSelection } from "@/hooks/use-selection";
import { CARD_BRANDS, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/constants";
import { formatBRL, formatDoc } from "@/lib/format";
import { maskBrDoc, parseBrDocument } from "@/lib/document";
import { bestPromo } from "@/lib/promo";
import { searchPosFn } from "@/lib/server/catalog";
import { checkoutFn, discardHeldFn, holdSaleFn, listHeldFn, listPromotionsFn, resumeHeldFn } from "@/lib/server/commerce";
import { simulateCommissionFn } from "@/lib/server/commission";
import { getRegisterFn, openRegisterFn } from "@/lib/server/finance";
import { listActiveSellerNamesFn, listCustomersFn } from "@/lib/server/party";
import { getSettingsFn, getTenantFn } from "@/lib/server/session";
import { cn, num } from "@/lib/utils";

export const Route = createFileRoute("/app/pdv")({ component: PdvPage });

type Hit = Awaited<ReturnType<typeof searchPosFn>>[number];
type Line = Hit & { qty: number; lineDiscount: number; override?: number; promoName?: string | null };
type PayRow = { method: PaymentMethod; amount: string; received: string; installments: number; brand: string };

const emptyPay = (): PayRow => ({
  method: "dinheiro",
  amount: "",
  received: "",
  installments: 1,
  brand: "Visa",
});

function PdvPage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const activeStore = storeId ?? tenant.data?.defaultStoreId ?? 0;
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [cpfNota, setCpfNota] = useState("");
  const [sellerId, setSellerId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [headerDisc, setHeaderDisc] = useState(0);
  const [discMode, setDiscMode] = useState<"value" | "pct">("value");
  const [discInput, setDiscInput] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [payments, setPayments] = useState<PayRow[]>([emptyPay()]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [openAmt, setOpenAmt] = useState("350");

  const [custQ, setCustQ] = useState("");
  const [custKind, setCustKind] = useState<"" | "pf" | "pj">("");
  const [custDebit, setCustDebit] = useState(false);
  const customers = useQuery({
    queryKey: ["customers", custQ, custKind, custDebit],
    queryFn: () =>
      listCustomersFn({
        data: {
          q: custQ.trim() || undefined,
          kind: custKind || undefined,
          debit: custDebit || undefined,
        },
      }),
    enabled: custOpen,
  });
  const sellers = useQuery({ queryKey: ["seller-names"], queryFn: () => listActiveSellerNamesFn() });
  const promos = useQuery({ queryKey: ["promos"], queryFn: () => listPromotionsFn() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });
  const register = useQuery({
    queryKey: ["register", activeStore],
    queryFn: () => getRegisterFn({ data: { storeId: activeStore } }),
    enabled: Boolean(activeStore),
  });
  const held = useQuery({
    queryKey: ["held", activeStore],
    queryFn: () => listHeldFn({ data: { storeId: activeStore } }),
    enabled: Boolean(activeStore),
  });
  const sellerPicked = useRef(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (sellerPicked.current || !sellers.data?.length || tenant.isPending) return;
    sellerPicked.current = true;
    const me = tenant.data?.userName;
    const match = (me ? sellers.data.find((s) => s.name === me) : null) ?? sellers.data[0];
    if (match) setSellerId(match.id);
  }, [sellers.data, tenant.data, tenant.isPending]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim() || !activeStore) {
        setHits([]);
        return;
      }
      const rows = await searchPosFn({ data: { q: q.trim(), storeId: activeStore } });
      setHits(rows);
      if (rows.length === 1 && /^\d{8,}$/.test(q.trim())) {
        add(rows[0]!);
        setQ("");
        setHits([]);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, activeStore]);

  const priced = cart.map((l) => {
    const sellPrice = l.override ?? l.listPrice ?? l.price;
    const hit = bestPromo(
      promos.data ?? [],
      l.productId,
      l.categoryId,
      l.parentCategoryId ?? null,
      l.qty,
      sellPrice,
    );
    return { ...l, sellPrice, lineDiscount: hit?.discount ?? 0, promoName: hit?.name ?? null };
  });
  const subtotal = priced.reduce((a, l) => a + l.sellPrice * l.qty - l.lineDiscount, 0);
  const discount = headerDisc;
  const total = Math.max(0, subtotal - discount);
  const customer = (customers.data ?? []).find((c) => c.id === customerId);
  const paySum = payments.reduce((a, p) => a + num(p.amount), 0);
  const remaining = Number((total - paySum).toFixed(2));
  const primaryPay = payments.reduce(
    (best, p) => (num(p.amount) > num(best.amount) ? p : best),
    payments[0] ?? emptyPay(),
  ).method;
  const comm = useQuery({
    queryKey: [
      "pdv-comm",
      sellerId,
      primaryPay,
      headerDisc,
      priced.map((l) => [l.productId, l.qty, l.sellPrice, l.lineDiscount]),
      activeStore,
    ],
    queryFn: () =>
      simulateCommissionFn({
        data: {
          sellerId: sellerId!,
          paymentMethod: primaryPay,
          headerDiscount: headerDisc,
          storeId: activeStore || undefined,
          items: priced.map((l) => ({
            productId: l.productId,
            quantity: l.qty,
            unitPrice: l.sellPrice,
            discount: l.lineDiscount,
          })),
        },
      }),
    enabled: Boolean(sellerId) && priced.length > 0,
  });

  function openPay() {
    setPayments((prev) => {
      if (prev.some((p) => num(p.amount) > 0)) return prev;
      const first = prev[0] ?? emptyPay();
      const amount = total.toFixed(2);
      return [{ ...first, amount, received: first.method === "dinheiro" ? amount : first.received }];
    });
    setPayOpen(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setCustOpen(true);
      } else if (e.key === "F6") {
        e.preventDefault();
        setDiscOpen(true);
      } else if (e.key === "F8") {
        e.preventDefault();
        openPay();
      } else if (e.key === "F9") {
        e.preventDefault();
        void holdCart();
      } else if (e.key === "F10") {
        e.preventDefault();
        void finish();
      } else if (e.key === "Escape") {
        setPayOpen(false);
        setCustOpen(false);
        setReceiptOpen(false);
        setHeldOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function add(hit: Hit) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.variantId === hit.variantId);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i]!, qty: copy[i]!.qty + 1 };
        return copy;
      }
      return [...prev, { ...hit, qty: 1, lineDiscount: 0 }];
    });
  }

  async function holdCart() {
    if (!cart.length) {
      toast.error("Inclua produtos para guardar a venda.");
      return;
    }
    if (!activeStore) {
      toast.error("Selecione uma loja.");
      return;
    }
    try {
      await holdSaleFn({
        data: {
          storeId: activeStore,
          customerId,
          sellerId,
          notes,
          discount: headerDisc,
          payloadJson: JSON.stringify({ cart, headerDisc, customerId, sellerId, notes, cpfNota }),
        },
      });
      setCart([]);
      setHeaderDisc(0);
      setNotes("");
      setCustomerId(null);
      setCpfNota("");
      toast.success("Venda em espera.");
      void qc.invalidateQueries({ queryKey: ["held"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível guardar.");
    }
  }

  async function resumeHeld(id: number) {
    if (cart.length) {
      toast.error("Guarde ou limpe o carrinho atual antes de recuperar.");
      return;
    }
    try {
      const row = await resumeHeldFn({ data: { id, storeId: activeStore } });
      const payload = JSON.parse(row.payloadJson) as {
        cart?: Line[];
        headerDisc?: number;
        notes?: string;
        cpfNota?: string;
      };
      const next = Array.isArray(payload.cart) ? payload.cart : [];
      setCart(next);
      setHeaderDisc(row.discount || payload.headerDisc || 0);
      setCustomerId(row.customerId);
      setSellerId(row.sellerId ?? sellerId);
      setNotes(row.notes || payload.notes || "");
      setCpfNota(payload.cpfNota || "");
      setHeldOpen(false);
      toast.success("Venda recuperada.");
      void qc.invalidateQueries({ queryKey: ["held"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível recuperar.");
    }
  }

  function applyDisc() {
    const n = Number(discInput.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    const limit = tenant.data?.discountLimit ?? 0;
    const pct = discMode === "pct" ? n : subtotal ? (n / subtotal) * 100 : 0;
    if (pct > limit + 0.05) {
      toast.error(`Desconto acima do limite (${limit}%).`);
      return;
    }
    if (discMode === "pct") setHeaderDisc(Number(((subtotal * n) / 100).toFixed(2)));
    else setHeaderDisc(n);
    setDiscOpen(false);
  }

  async function finish() {
    if (!register.data?.register) {
      toast.error("Abra o caixa da loja para finalizar a venda.");
      return;
    }
    if (!cart.length) {
      toast.error("Inclua produtos no carrinho.");
      return;
    }
    if (!activeStore) {
      toast.error("Selecione uma loja.");
      return;
    }
    let pays = payments
      .map((p) => ({
        method: p.method,
        amount: num(p.amount),
        received: num(p.received || p.amount),
        installments: p.installments,
        brand: p.brand,
      }))
      .filter((p) => p.amount > 0);
    if (!payOpen || pays.length === 0) {
      pays = [{ method: "dinheiro", amount: total, received: total, installments: 1, brand: "" }];
    }
    if (pays.reduce((a, p) => a + p.amount, 0) + 0.05 < total) {
      openPay();
      toast.error("Informe as formas de pagamento.");
      return;
    }
    setBusy(true);
    try {
      const res = await checkoutFn({
        data: {
          storeId: activeStore,
          customerId,
          sellerId,
          notes,
          cpfNaNota: cpfNota || undefined,
          discount,
          items: priced.map((l) => ({
            variantId: l.variantId,
            quantity: l.qty,
            unitPrice: l.sellPrice,
            discount: l.lineDiscount,
          })),
          payments: pays,
        },
      });
      setLastSale(res);
      setReceiptOpen(true);
      setCart([]);
      setHeaderDisc(0);
      setNotes("");
      setCustomerId(null);
      setCpfNota("");
      setPayments([emptyPay()]);
      setPayOpen(false);
      toast.success(
        res.commission
          ? `Venda nº ${res.number} · ${formatBRL(res.total)} · comissão ${formatBRL(res.commission.amount)}${res.commission.net != null && res.commission.net !== res.commission.amount ? ` · líquido ${formatBRL(res.commission.net)}` : ""}${res.commission.bonusNote ? ` · ${res.commission.bonusNote}` : ""}`
          : `Venda nº ${res.number} · ${formatBRL(res.total)}`,
      );
      void qc.invalidateQueries({ queryKey: ["register"] });
      searchRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível finalizar.");
    } finally {
      setBusy(false);
    }
  }

  const cashPay = payments.find((p) => p.method === "dinheiro");
  const change = cashPay ? Math.max(0, num(cashPay.received) - num(cashPay.amount)) : 0;

  return (
    <div className="pdv-stage">
      <section className="pdv-catalog border-b border-border p-6 md:border-r md:border-b-0">
        <p className="ed-label mb-block">Peças</p>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="F2  ·  nome, SKU ou código de barras"
            className="h-12 pl-10 text-base"
          />
        </div>
        {!register.data?.register && activeStore ? (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="min-w-0 flex-1 text-sm">
              Caixa fechado. Abra para registrar as vendas desta loja.
            </p>
            <Input
              className="h-10 w-28"
              value={openAmt}
              onChange={(e) => setOpenAmt(e.target.value)}
              aria-label="Fundo inicial"
            />
            <Button
              type="button"
              onClick={async () => {
                try {
                  await openRegisterFn({ data: { storeId: activeStore, amount: Number(openAmt) || 0 } });
                  toast.success("Caixa aberto.");
                  void qc.invalidateQueries({ queryKey: ["register"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha ao abrir o caixa");
                }
              }}
            >
              Abrir caixa
            </Button>
          </div>
        ) : null}
        <div className="tile-grid mt-4">
          {hits.map((h, i) => (
            <button
              key={h.variantId}
              type="button"
              onClick={() => add(h)}
              className={cn(
                "tile rounded-lg border border-border bg-card p-3 hover:border-primary",
                i === 0 && hits.length > 3 && "tile-wide",
              )}
            >
              <span className="tile-photo">
                {h.imageUrl ? (
                  <img src={h.imageUrl} alt="" />
                ) : (
                  <span className="tile-photo-fallback">{h.label.slice(0, 1)}</span>
                )}
              </span>
              <p className="line-clamp-2 text-sm font-medium">{h.label}</p>
              <p className="text-xs text-muted-foreground">
                {h.sku} · estoque {h.stock}
              </p>
              <p className="font-display text-lg tabular">{formatBRL(h.price)}</p>
            </button>
          ))}
        </div>
        {lastSale ? (
          <button
            type="button"
            className="mt-auto pt-4 text-left text-sm text-primary"
            onClick={() => setReceiptOpen(true)}
          >
            Última venda: nº {lastSale.number} · {formatBRL(lastSale.total)} · ver comprovante
          </button>
        ) : (
          <p className="mt-auto pt-4 ed-label">
            F2 busca · F4 cliente · F6 desconto · F8 pagamento · F9 espera · F10 finaliza
          </p>
        )}
      </section>

      <aside className="pdv-ticket bg-card p-6">
        <p className="ed-label mb-block">Cupom</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setCustOpen(true)}>
            <UserRound className="size-3.5" />
            {customer?.name ?? (cpfNota ? formatDoc(cpfNota) : "Cliente (F4)")}
          </Button>
          <Select
            className="h-8 w-auto min-w-36 text-xs"
            value={sellerId ?? ""}
            onChange={(e) => setSellerId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Vendedor</option>
            {(sellers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-block flex-1 space-y-2 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-medium">Carrinho vazio</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Busque pelo nome, SKU ou código de barras para começar a venda.
              </p>
            </div>
          ) : (
            priced.map((l, idx) => {
              const commLine = comm.data?.lines[idx];
              return (
              <div key={l.variantId} className="rounded-lg border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{l.label}</p>
                    {l.promoName ? (
                      <p className="text-xs text-primary">{l.promoName}</p>
                    ) : null}
                    {commLine ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {commLine.amount <= 0
                          ? `sem comissão · ${commLine.ruleName}`
                          : `${formatBRL(commLine.amount)} · ${commLine.ruleName}`}
                      </p>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => setCart((c) => c.filter((x) => x.variantId !== l.variantId))}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setCart((c) =>
                          c.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)),
                        )
                      }
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-8 text-center tabular">{l.qty}</span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setCart((c) => c.map((x) => (x.variantId === l.variantId ? { ...x, qty: x.qty + 1 } : x)))
                      }
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <p className="tabular text-sm font-medium">
                    {formatBRL(l.sellPrice * l.qty - l.lineDiscount)}
                  </p>
                </div>
              </div>
            );
            })
          )}
        </div>

        <div className="mt-block space-y-1 border-t border-border pt-3 text-sm">
          <Row label="Subtotal" value={formatBRL(subtotal)} />
          <Row label="Desconto" value={formatBRL(discount)} />
          <Row label="Total" value={formatBRL(total)} big />
          {sellerId && priced.length ? (
            <>
              <Row label="Comissão bruta" value={formatBRL(comm.data?.amount ?? 0)} />
              {comm.data?.tax && comm.data.tax.totalTax > 0.009 ? (
                <Row label="Líquido" value={formatBRL(comm.data.tax.net)} />
              ) : null}
            </>
          ) : null}
          {comm.data?.note ? (
            <p className="text-xs text-muted-foreground">{comm.data.note}</p>
          ) : !sellerId && priced.length ? (
            <p className="text-xs text-warning">Sem vendedor — a venda não gera comissão.</p>
          ) : null}
          {comm.data?.volumeNote ? (
            <p className="text-xs text-muted-foreground">{comm.data.volumeNote}</p>
          ) : null}
          {comm.data?.targetHints?.map((h) => (
            <p key={h.id} className="text-xs text-muted-foreground">
              {h.name}: {h.bonusHint}
            </p>
          ))}
          {comm.data?.bonusNote ? (
            <p className="text-xs text-primary">{comm.data.bonusNote}</p>
          ) : null}
        </div>
        <Input
          className="mt-2 h-9"
          placeholder="Observações da venda"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="mt-block grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setDiscOpen(true)}>
            Desconto (F6)
          </Button>
          <Button variant="outline" onClick={openPay}>
            Pagamento (F8)
          </Button>
          <Button variant="outline" onClick={() => void holdCart()} disabled={!cart.length}>
            <Pause className="size-3.5" />
            Esperar (F9)
          </Button>
          <Button variant="outline" onClick={() => setHeldOpen(true)}>
            <Play className="size-3.5" />
            Em espera{held.data?.length ? ` (${held.data.length})` : ""}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCart([]);
              setHeaderDisc(0);
            }}
          >
            Limpar
          </Button>
          <Button onClick={() => void finish()} disabled={busy || !register.data?.register}>
            {busy ? "Salvando…" : "Finalizar (F10)"}
          </Button>
        </div>
      </aside>

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vendas em espera</DialogTitle>
          </DialogHeader>
          {!held.data?.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda guardada nesta loja.</p>
          ) : (
            <ul className="space-y-2">
              {held.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{h.customerName ?? "Consumidor"}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.items} {h.items === 1 ? "item" : "itens"}
                      {h.sellerName ? ` · ${h.sellerName}` : ""}
                      {h.notes ? ` · ${h.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => void resumeHeld(h.id)}>
                      Recuperar
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={async () => {
                        await discardHeldFn({ data: { id: h.id } });
                        void qc.invalidateQueries({ queryKey: ["held"] });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={custOpen} onOpenChange={setCustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Documento na nota</DialogTitle>
          </DialogHeader>
          <Input
            className="mb-2"
            placeholder="Buscar nome, telefone ou documento"
            value={custQ}
            onChange={(e) => setCustQ(e.target.value)}
          />
          <Input
            inputMode="numeric"
            placeholder="CPF ou CNPJ"
            value={cpfNota}
            onChange={(e) => setCpfNota(maskBrDoc(e.target.value))}
            aria-label="Documento na nota"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            CPF ou CNPJ. Se já existir no cadastro, vincula o cliente; senão cria um consumidor.
          </p>
          <div className="mt-block flex flex-wrap gap-1.5">
            {(
              [
                ["", "Todos"],
                ["pf", "PF"],
                ["pj", "PJ"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id || "all"}
                type="button"
                size="sm"
                variant={custKind === id ? "default" : "outline"}
                onClick={() => setCustKind(id)}
              >
                {label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={custDebit ? "default" : "outline"}
              onClick={() => setCustDebit((v) => !v)}
            >
              Com débito
            </Button>
          </div>
          <Select
            className="mt-block"
            value={customerId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setCustomerId(id);
              const pick = (customers.data ?? []).find((c) => c.id === id);
              if (pick?.document) setCpfNota(maskBrDoc(pick.document));
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
          <Button
            className="mt-block"
            onClick={() => {
              if (cpfNota.trim()) {
                try {
                  parseBrDocument(cpfNota, "any");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Documento inválido.");
                  return;
                }
              }
              setCustOpen(false);
            }}
          >
            Confirmar
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={discOpen} onOpenChange={setDiscOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconto</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant={discMode === "value" ? "default" : "outline"} onClick={() => setDiscMode("value")}>
              Valor
            </Button>
            <Button variant={discMode === "pct" ? "default" : "outline"} onClick={() => setDiscMode("pct")}>
              Percentual
            </Button>
          </div>
          <Input
            className="mt-block"
            value={discInput}
            onChange={(e) => setDiscInput(e.target.value)}
            placeholder={discMode === "pct" ? "% " : "R$"}
          />
          <p className="text-xs text-muted-foreground">Limite do seu perfil: {tenant.data?.discountLimit ?? 0}%</p>
          <Button className="mt-block" onClick={applyDisc}>
            Aplicar
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pagamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Total {formatBRL(total)} · restante {formatBRL(Math.max(0, remaining))}
          </p>
          {comm.data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Comissão prevista {formatBRL(comm.data.amount)}
              {comm.data.note ? ` · ${comm.data.note}` : ""}
              {comm.data.volumeNote ? ` · ${comm.data.volumeNote}` : ""}
              {comm.data.bonusNote ? ` · ${comm.data.bonusNote}` : ""}
            </p>
          ) : null}
          <div className="mt-block space-y-block">
            {payments.map((p, idx) => (
              <div key={idx} className="rounded-lg border border-border p-3">
                <div className="flex gap-2">
                  <Select
                    value={p.method}
                    onChange={(e) => {
                      const next = [...payments];
                      next[idx] = { ...p, method: e.target.value as PaymentMethod };
                      setPayments(next);
                    }}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    placeholder="Valor"
                    value={p.amount}
                    onChange={(e) => {
                      const next = [...payments];
                      next[idx] = { ...p, amount: e.target.value };
                      setPayments(next);
                    }}
                  />
                  {payments.length > 1 ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setPayments(payments.filter((_, i) => i !== idx))}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
                {p.method === "dinheiro" ? (
                  <Input
                    className="mt-2"
                    placeholder="Valor recebido"
                    value={p.received}
                    onChange={(e) => {
                      const next = [...payments];
                      next[idx] = { ...p, received: e.target.value };
                      setPayments(next);
                    }}
                  />
                ) : null}
                {p.method === "credito" ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Select
                      value={p.brand}
                      onChange={(e) => {
                        const next = [...payments];
                        next[idx] = { ...p, brand: e.target.value };
                        setPayments(next);
                      }}
                    >
                      {CARD_BRANDS.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      max={18}
                      value={p.installments}
                      onChange={(e) => {
                        const next = [...payments];
                        next[idx] = { ...p, installments: Number(e.target.value) };
                        setPayments(next);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {change > 0 ? <p className="mt-2 text-sm">Troco: {formatBRL(change)}</p> : null}
          <div className="mt-block flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setPayments([
                  ...payments,
                  {
                    method: "pix",
                    amount: remaining > 0 ? String(remaining) : "",
                    received: "",
                    installments: 1,
                    brand: "Visa",
                  },
                ])
              }
            >
              + forma
            </Button>
            <Button className="flex-1" onClick={() => void finish()} disabled={busy}>
              Confirmar e finalizar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={receiptOpen && lastSale != null} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Comprovante</DialogTitle>
          </DialogHeader>
          {lastSale ? (
            <Receipt
              data={lastSale}
              company={receiptCompany(settings.data)}
              onClose={() => setReceiptOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function receiptCompany(settings: Awaited<ReturnType<typeof getSettingsFn>> | undefined): ReceiptCompany {
  const company = (settings?.company ?? {}) as ReceiptCompany;
  const extra = (settings?.settings ?? {}) as Record<string, unknown>;
  return {
    ...company,
    print_header: extra.print_header != null ? String(extra.print_header) : company.print_header,
    print_footer: extra.print_footer != null ? String(extra.print_footer) : company.print_footer,
    receipt_message: extra.receipt_message != null ? String(extra.receipt_message) : company.receipt_message,
  };
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", big && "font-display text-3xl font-semibold tracking-tight")}>{value}</span>
    </div>
  );
}
