import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";
import { CartTable } from "@/components/pdv/cart-table";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { HeldSalesDialog } from "@/components/pdv/held-sales-dialog";
import { PaymentDialog } from "@/components/pdv/payment-dialog";
import { ProductSearch } from "@/components/pdv/product-search";
import { SaleBar } from "@/components/pdv/sale-bar";
import { SalePanel } from "@/components/pdv/sale-panel";
import { emptyPay, type Hit, type Line, type PayRow } from "@/components/pdv/sale-model";
import { Receipt, type ReceiptCompany, type ReceiptData } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useOnline } from "@/hooks/use-online";
import { useSelection } from "@/hooks/use-selection";
import { PAYMENT_LABELS, type PaymentMethod } from "@/lib/constants";
import { formatBRL } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { paymentStatus, summarizeSale, valorDigitado } from "@/lib/pdv-sale";
import { bestPromo } from "@/lib/promo";
import { runAction } from "@/lib/run-action";
import { checkoutFn, discardHeldFn, holdSaleFn, listHeldFn, listPromotionsFn, resumeHeldFn } from "@/lib/server/commerce";
import { simulateCommissionFn } from "@/lib/server/commission";
import { getRegisterFn, openRegisterFn } from "@/lib/server/finance";
import { listActiveSellerNamesFn } from "@/lib/server/party";
import { getSettingsFn, getTenantFn } from "@/lib/server/session";

export const Route = createFileRoute("/app/pdv")({ component: PdvPage });

type CustomerRef = { id: number; name: string };

function PdvPage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const online = useOnline();
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const activeStore = storeId ?? tenant.data?.defaultStoreId ?? 0;
  const searchRef = useRef<HTMLInputElement>(null);

  const [cart, setCart] = useState<Line[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ id: number; n: number } | null>(null);
  const [customer, setCustomer] = useState<CustomerRef | null>(null);
  const [cpfNota, setCpfNota] = useState("");
  /** Operador ja respondeu "sem documento" nesta venda: para de lembrar. */
  const [docDispensado, setDocDispensado] = useState(false);
  const [sellerId, setSellerId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [headerDisc, setHeaderDisc] = useState(0);
  const [payments, setPayments] = useState<PayRow[]>([emptyPay()]);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // `busy` e estado: dois disparos no mesmo tick (atalho + clique, duas
  // teclas rapidas) ainda leem false. A ref trava na hora, sincrona.
  const acaoEmCurso = useRef(false);
  /** Valor que o F8 preencheu sozinho; enquanto ninguem mexer, acompanha o total. */
  const preenchido = useRef<string | null>(null);
  const [lastSale, setLastSale] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [openAmt, setOpenAmt] = useState("");
  const [openingCaixa, setOpeningCaixa] = useState(false);

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
  const registerOpen = register.data ? Boolean(register.data.register) : null;
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

  const priced = cart.map((l) => {
    const sellPrice = l.override ?? l.listPrice ?? l.price;
    const hit = bestPromo(promos.data ?? [], l.productId, l.categoryId, l.parentCategoryId ?? null, l.qty, sellPrice);
    return { ...l, sellPrice, lineDiscount: hit?.discount ?? 0, promoName: hit?.name ?? null };
  });
  const summary = summarizeSale(priced, headerDisc);
  const { subtotal, total } = summary;
  const discount = headerDisc;
  const pay = paymentStatus(payments, total);
  const primaryPay = payments.reduce(
    (best, p) => (valorDigitado(p.amount) > valorDigitado(best.amount) ? p : best),
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

  /** Dicas de comissao (faixa, volume, metas, bonus) agrupadas numa lista so. */
  const commissionHints: { key: string; text: string; tone?: "bonus" }[] = [
    ...(comm.data?.note ? [{ key: "note", text: comm.data.note }] : []),
    ...(comm.data?.volumeNote ? [{ key: "volume", text: comm.data.volumeNote }] : []),
    ...(comm.data?.targetHints ?? []).map((h) => ({ key: `target-${h.id}`, text: `${h.name}: ${h.bonusHint}` })),
    ...(comm.data?.bonusNote ? [{ key: "bonus", text: comm.data.bonusNote, tone: "bonus" as const }] : []),
  ];
  const commissionPerLine = priced.map((_, idx) => {
    const c = comm.data?.lines[idx];
    if (!c) return null;
    return c.amount <= 0 ? `sem comissão · ${c.ruleName}` : `comissão ${formatBRL(c.amount)} · ${c.ruleName}`;
  });

  function novaVenda() {
    setCart([]);
    setSelectedId(null);
    setFlash(null);
    setHeaderDisc(0);
    setNotes("");
    setCustomer(null);
    setCpfNota("");
    setDocDispensado(false);
    setPayments([emptyPay()]);
    preenchido.current = null;
  }

  function openPay() {
    if (!cart.length) {
      toast.error("Inclua produtos antes de informar o pagamento.");
      return;
    }
    if (!payments.some((p) => valorDigitado(p.amount) > 0)) {
      const first = payments[0] ?? emptyPay();
      const amount = total.toFixed(2).replace(".", ",");
      preenchido.current = amount;
      setPayments([{ ...first, amount, received: first.method === "dinheiro" ? amount : first.received }]);
    }
    setPayOpen(true);
  }

  // Abriu o F8, fechou, bipou mais uma peca: o valor preenchido sozinho
  // ficaria velho e o F10 acusaria "falta". Se o operador nao mexeu nele,
  // ele segue o total; se mexeu, o que ele digitou manda.
  useEffect(() => {
    const alvo = total.toFixed(2).replace(".", ",");
    const antes = preenchido.current;
    if (antes == null || antes === alvo) return;
    preenchido.current = alvo;
    setPayments((prev) => {
      const r = prev[0];
      if (prev.length !== 1 || !r || r.amount !== antes) return prev;
      return [{ ...r, amount: alvo, received: r.method === "dinheiro" && r.received === antes ? alvo : r.received }];
    });
  }, [total]);

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
    setSelectedId(hit.variantId);
    setFlash((f) => ({ id: hit.variantId, n: (f?.n ?? 0) + 1 }));
  }

  function setQty(variantId: number, qty: number) {
    setCart((c) => c.map((x) => (x.variantId === variantId ? { ...x, qty } : x)));
  }

  function remove(variantId: number) {
    setCart((c) => {
      const i = c.findIndex((x) => x.variantId === variantId);
      const next = c.filter((x) => x.variantId !== variantId);
      // A selecao pula pra vizinha, pra Delete em sequencia continuar
      // funcionando sem voltar ao mouse.
      setSelectedId(next[Math.min(i, next.length - 1)]?.variantId ?? null);
      return next;
    });
  }

  /** Teclas com a busca vazia: o cupom responde ao teclado. */
  function onCartKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!cart.length) return;
    const i = Math.max(0, cart.findIndex((l) => l.variantId === selectedId));
    const sel = cart[i];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const j = e.key === "ArrowDown" ? Math.min(cart.length - 1, i + 1) : Math.max(0, i - 1);
      setSelectedId(cart[j]!.variantId);
    } else if ((e.key === "+" || e.key === "=") && sel) {
      e.preventDefault();
      setQty(sel.variantId, sel.qty + 1);
    } else if (e.key === "-" && sel) {
      e.preventDefault();
      setQty(sel.variantId, Math.max(1, sel.qty - 1));
    } else if (e.key === "Delete" && sel) {
      e.preventDefault();
      remove(sel.variantId);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape continua passando (fecha o que estiver aberto), mas os atalhos
      // de acao ficam suspensos enquanto houver dialogo aberto. Sem isto o
      // handler escuta no window inteiro e dispara POR TRAS do modal: um F10
      // por reflexo FINALIZAVA a venda com o pedido de CPF aberto.
      const dialogoAberto = document.querySelector('[role="dialog"][data-state="open"]') !== null;
      if (dialogoAberto && e.key !== "Escape") return;
      // Tecla segurada repete a cada ~30ms: F10 um pouco mais longo
      // finalizava a mesma venda varias vezes antes da primeira voltar.
      if (e.repeat && /^F\d{1,2}$/.test(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setCustOpen(true);
      } else if (e.key === "F6") {
        e.preventDefault();
        if (cart.length) setDiscOpen(true);
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

  async function holdCart() {
    if (!cart.length) {
      toast.error("Inclua produtos para guardar a venda.");
      return;
    }
    if (!activeStore) {
      toast.error("Selecione uma loja.");
      return;
    }
    if (acaoEmCurso.current) return;
    acaoEmCurso.current = true;
    try {
      await holdSaleFn({
        data: {
          storeId: activeStore,
          customerId: customer?.id ?? null,
          sellerId,
          notes,
          discount: headerDisc,
          payloadJson: JSON.stringify({ cart, headerDisc, customerId: customer?.id ?? null, sellerId, notes, cpfNota }),
        },
      });
      const sellerMantido = sellerId;
      novaVenda();
      setSellerId(sellerMantido);
      toast.success("Venda guardada. Recupere quando o cliente voltar.");
      void qc.invalidateQueries({ queryKey: ["held"] });
      searchRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível guardar a venda.");
    } finally {
      acaoEmCurso.current = false;
    }
  }

  async function resumeHeld(id: number) {
    if (cart.length) {
      toast.error("Guarde ou cancele a venda atual antes de recuperar outra.");
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
      const guardado = Array.isArray(payload.cart) ? payload.cart : [];
      // Preco e estoque de agora, nao os da hora em que foi guardada.
      const atual = new Map(row.current.map((c) => [c.variantId, c]));
      let mudaram = 0;
      let sairam = 0;
      const next = guardado.flatMap((l) => {
        const c = atual.get(l.variantId);
        if (!c) {
          sairam++;
          return [];
        }
        if (Math.abs(c.price - l.price) > 0.004 || Math.abs(c.listPrice - l.listPrice) > 0.004) mudaram++;
        return [{ ...l, price: c.price, listPrice: c.listPrice, stock: c.stock }];
      });
      const nome = held.data?.find((h) => h.id === id)?.customerName ?? null;
      setCart(next);
      setSelectedId(next[next.length - 1]?.variantId ?? null);
      setHeaderDisc(row.discount || payload.headerDisc || 0);
      setCustomer(row.customerId ? { id: row.customerId, name: nome ?? "Cliente" } : null);
      setSellerId(row.sellerId ?? sellerId);
      setNotes(row.notes || payload.notes || "");
      setCpfNota(payload.cpfNota || "");
      setDocDispensado(Boolean(row.customerId || payload.cpfNota));
      setHeldOpen(false);
      const avisos = [
        mudaram ? `${mudaram} ${mudaram === 1 ? "item mudou" : "itens mudaram"} de preço desde que a venda foi guardada` : null,
        sairam ? `${sairam} ${sairam === 1 ? "item saiu" : "itens saíram"} do catálogo e ${sairam === 1 ? "foi removido" : "foram removidos"}` : null,
      ].filter(Boolean);
      if (avisos.length) toast.warning(`Venda recuperada. ${avisos.join("; ")}. Confira o total.`);
      else toast.success("Venda recuperada.");
      void qc.invalidateQueries({ queryKey: ["held"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível recuperar a venda.");
    }
  }

  async function finish() {
    if (!register.data?.register) {
      toast.error("Abra o caixa da loja para finalizar a venda.");
      return;
    }
    if (!cart.length) {
      toast.error("Inclua produtos na venda.");
      return;
    }
    if (!activeStore) {
      toast.error("Selecione uma loja.");
      return;
    }
    /*
      Se o operador ABRIU o pagamento, o que ele digitou manda -- nada aqui
      pode "consertar" sozinho o que nao entendeu.

      Antes, o valor passava por num(), que devolve 0 pro que nao consegue
      ler. Como "50,00" (o jeito que se digita no balcao) vira 0, o pagamento
      era descartado por ser zero, a lista ficava vazia e o codigo caia no
      caminho de baixo, que registra a venda inteira em DINHEIRO. O operador
      escolhia credito e a venda era gravada como especie: o caixa passava a
      esperar um dinheiro que nunca entrou na gaveta, e a diferenca aparecia
      no fechamento como se fosse falta dele.

      Agora valor ilegivel e ERRO na cara do operador, e o caminho automatico
      de dinheiro so vale pra venda rapida, em que ninguem informou nada.
    */
    let pays: {
      method: PaymentMethod;
      amount: number;
      received: number;
      installments: number;
      brand: string;
      nsu: string;
    }[];
    const vendaRapida = payments.every((p) => !p.amount.trim());
    if (vendaRapida) {
      pays = [{ method: "dinheiro", amount: total, received: total, installments: 1, brand: "", nsu: "" }];
    } else {
      pays = [];
      for (const p of payments) {
        if (!p.amount.trim()) continue;
        const amount = parseMoneyInput(p.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          setPayOpen(true);
          toast.error(`Valor inválido em ${PAYMENT_LABELS[p.method]}: "${p.amount}".`);
          return;
        }
        const recebidoTexto = p.received.trim();
        const received = recebidoTexto ? parseMoneyInput(recebidoTexto) : amount;
        if (!Number.isFinite(received)) {
          setPayOpen(true);
          toast.error(`Valor recebido inválido: "${p.received}".`);
          return;
        }
        pays.push({ method: p.method, amount, received, installments: p.installments, brand: p.brand, nsu: p.nsu });
      }
      if (pays.length === 0) {
        setPayOpen(true);
        toast.error("Informe o valor de pelo menos uma forma de pagamento.");
        return;
      }
    }
    if (pays.reduce((a, p) => a + p.amount, 0) + 0.05 < total) {
      setPayOpen(true);
      toast.error(`Pagamento incompleto: faltam ${formatBRL(total - pays.reduce((a, p) => a + p.amount, 0))}.`);
      return;
    }
    if (acaoEmCurso.current) return;
    acaoEmCurso.current = true;
    setBusy(true);
    try {
      const res = await checkoutFn({
        data: {
          storeId: activeStore,
          customerId: customer?.id ?? null,
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
      const sellerMantido = sellerId;
      novaVenda();
      setSellerId(sellerMantido);
      setPayOpen(false);
      toast.success(
        res.commission
          ? `Venda nº ${res.number} concluída · ${formatBRL(res.total)} · comissão ${formatBRL(res.commission.amount)}${res.commission.net != null && res.commission.net !== res.commission.amount ? ` · líquido ${formatBRL(res.commission.net)}` : ""}${res.commission.bonusNote ? ` · ${res.commission.bonusNote}` : ""}`
          : `Venda nº ${res.number} concluída · ${formatBRL(res.total)}`,
      );
      void qc.invalidateQueries({ queryKey: ["register"] });
      searchRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível finalizar a venda.");
    } finally {
      acaoEmCurso.current = false;
      setBusy(false);
    }
  }

  async function abrirCaixa() {
    if (openingCaixa) return;
    const valor = openAmt.trim() ? parseMoneyInput(openAmt) : 0;
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error(`Fundo inicial inválido: "${openAmt}".`);
      return;
    }
    setOpeningCaixa(true);
    try {
      await openRegisterFn({ data: { storeId: activeStore, amount: valor } });
      toast.success("Caixa aberto. Pode vender.");
      void qc.invalidateQueries({ queryKey: ["register"] });
      searchRef.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o caixa.");
    } finally {
      setOpeningCaixa(false);
    }
  }

  return (
    <div className="pdv-stage">
      <section className="pdv-main" aria-label="Produtos da venda">
        <SaleBar
          itemCount={cart.length}
          registerOpen={activeStore ? registerOpen : null}
          online={online}
          lastSale={lastSale ? { number: lastSale.number, total: lastSale.total } : null}
          onLastSale={() => setReceiptOpen(true)}
        />

        {registerOpen === false && activeStore ? (
          <form
            className="pdv-register-closed"
            onSubmit={(e) => {
              e.preventDefault();
              void abrirCaixa();
            }}
          >
            <LockKeyhole className="size-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Caixa fechado</p>
              <p className="text-xs text-muted-foreground">Abra o caixa para registrar vendas nesta loja.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Fundo inicial</span>
              <span className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  className="h-9 w-32 rounded-sm pl-9 tabular"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={openAmt}
                  onChange={(e) => setOpenAmt(e.target.value)}
                />
              </span>
            </label>
            <Button type="submit" className="h-9 rounded-sm" disabled={openingCaixa}>
              {openingCaixa ? "Abrindo…" : "Abrir caixa"}
            </Button>
          </form>
        ) : null}

        <ProductSearch ref={searchRef} storeId={activeStore} onPick={add} onEmptyKeyDown={onCartKey} />

        <CartTable
          lines={priced}
          commission={commissionPerLine}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onQty={setQty}
          onRemove={remove}
          flash={flash}
        />

        <p className="pdv-keys" aria-hidden>
          Busca vazia: <kbd>↑</kbd>
          <kbd>↓</kbd> escolhe o item · <kbd>+</kbd>
          <kbd>−</kbd> quantidade · <kbd>Del</kbd> remove
        </p>
      </section>

      <SalePanel
        summary={summary}
        customerName={customer?.name ?? null}
        customerDoc={cpfNota}
        askDoc={cart.length > 0 && !cpfNota && !customer && !docDispensado}
        onCustomer={() => setCustOpen(true)}
        sellers={sellers.data ?? []}
        sellerId={sellerId}
        onSeller={setSellerId}
        payments={payments}
        pay={pay}
        onPay={openPay}
        onDiscount={() => setDiscOpen(true)}
        onClearDiscount={() => setHeaderDisc(0)}
        commission={{
          show: Boolean(sellerId) && priced.length > 0 && comm.data != null,
          amount: comm.data?.amount ?? 0,
          net: comm.data?.tax && comm.data.tax.totalTax > 0.009 ? comm.data.tax.net : null,
          warnNoSeller: !sellerId && priced.length > 0,
          hints: commissionHints,
        }}
        notes={notes}
        onNotes={setNotes}
        heldCount={held.data?.length ?? 0}
        onHold={() => void holdCart()}
        onHeld={() => setHeldOpen(true)}
        onCancel={() => {
          novaVenda();
          toast("Venda cancelada.");
          searchRef.current?.focus();
        }}
        onFinish={() => void finish()}
        busy={busy}
        registerOpen={registerOpen === true}
      />

      <HeldSalesDialog
        open={heldOpen}
        onOpenChange={setHeldOpen}
        held={held.data ?? []}
        onResume={(id) => void resumeHeld(id)}
        onDiscard={async (id) => {
          // Sem o runAction, uma recusa do servidor nao dizia nada: o
          // "Descartar?" sumia e a venda continuava na lista.
          await runAction(() => discardHeldFn({ data: { id } }), {
            erro: "Não foi possível descartar a venda guardada.",
          });
          void qc.invalidateQueries({ queryKey: ["held"] });
        }}
      />

      <CustomerDialog
        open={custOpen}
        onOpenChange={setCustOpen}
        cpf={cpfNota}
        onCpf={setCpfNota}
        customerId={customer?.id ?? null}
        onCustomer={(c) => setCustomer(c ? { id: c.id, name: c.name } : null)}
        onSkip={() => {
          setCpfNota("");
          setCustomer(null);
          setDocDispensado(true);
          setCustOpen(false);
        }}
      />

      <DiscountDialog
        open={discOpen}
        onOpenChange={setDiscOpen}
        subtotal={subtotal}
        limitPct={tenant.data?.discountLimit ?? 0}
        onApply={setHeaderDisc}
      />

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        total={total}
        payments={payments}
        onPayments={setPayments}
        pay={pay}
        hasCustomer={Boolean(customer || cpfNota)}
        commissionNote={
          comm.data
            ? [`Comissão prevista ${formatBRL(comm.data.amount)}`, comm.data.note, comm.data.volumeNote, comm.data.bonusNote]
                .filter(Boolean)
                .join(" · ")
            : null
        }
        busy={busy}
        onConfirm={() => void finish()}
      />

      <Dialog open={receiptOpen && lastSale != null} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Venda nº {lastSale?.number} concluída</DialogTitle>
          </DialogHeader>
          {lastSale ? (
            <Receipt data={lastSale} company={receiptCompany(settings.data)} onClose={() => setReceiptOpen(false)} />
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
