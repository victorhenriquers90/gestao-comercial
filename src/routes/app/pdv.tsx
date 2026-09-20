import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  CreditCard,
  IdCard,
  Minus,
  Pause,
  Percent,
  Play,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { Receipt, type ReceiptCompany, type ReceiptData } from "@/components/receipt";
import { useSelection } from "@/hooks/use-selection";
import { CARD_BRANDS, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/constants";
import { MAX_INSTALLMENTS } from "@/lib/card";
import { parseMoneyInput } from "@/lib/money-input";
import { formatBRL, formatDoc } from "@/lib/format";
import { maskBrDoc, parseBrDocument } from "@/lib/document";
import { bestPromo } from "@/lib/promo";
import { searchPosFn } from "@/lib/server/catalog";
import { checkoutFn, discardHeldFn, holdSaleFn, listHeldFn, listPromotionsFn, resumeHeldFn } from "@/lib/server/commerce";
import { simulateCommissionFn } from "@/lib/server/commission";
import { getRegisterFn, openRegisterFn } from "@/lib/server/finance";
import { listActiveSellerNamesFn, listCustomersFn } from "@/lib/server/party";
import { getSettingsFn, getTenantFn } from "@/lib/server/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/pdv")({ component: PdvPage });

type Hit = Awaited<ReturnType<typeof searchPosFn>>[number];
type Line = Hit & { qty: number; lineDiscount: number; override?: number; promoName?: string | null };
type PayRow = {
  method: PaymentMethod;
  amount: string;
  received: string;
  installments: number;
  brand: string;
  nsu: string;
};

/**
 * Valor digitado, para os calculos DA TELA (falta, troco, soma).
 * Ilegivel conta como zero aqui de proposito: e so previa, e o bloqueio de
 * verdade acontece no finish(), com erro nomeando o campo.
 */
const valorDigitado = (texto: string): number => {
  const n = parseMoneyInput(texto);
  return Number.isFinite(n) ? n : 0;
};

/** Mesma altura, mesmo raio e mesmo alinhamento nos seis botoes de acao. */
const pdvActionClass = "h-11 justify-between rounded-lg px-3";

// Bandeira comeca VAZIA, nao em "Visa". Ela existe pra casar a venda com a
// linha do extrato da adquirente; um padrao silencioso gravaria a bandeira
// errada na maioria das vendas e estragaria justamente a conferencia que ela
// serve pra permitir. Melhor o operador escolher.
const emptyPay = (): PayRow => ({
  method: "dinheiro",
  amount: "",
  received: "",
  installments: 1,
  brand: "",
  nsu: "",
});

function PdvPage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const activeStore = storeId ?? tenant.data?.defaultStoreId ?? 0;
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  /** Venda em espera aguardando confirmacao de descarte (acao irreversivel). */
  const [descartarId, setDescartarId] = useState<number | null>(null);
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
  const [openingCaixa, setOpeningCaixa] = useState(false);

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
  const custPrompted = useRef(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cart.length === 0) {
      // Nova venda: o próximo primeiro item deve pedir o documento de novo.
      custPrompted.current = false;
      return;
    }
    if (cart.length === 1 && !custPrompted.current) {
      custPrompted.current = true;
      setCustOpen(true);
    }
  }, [cart.length]);

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
  const paySum = payments.reduce((a, p) => a + valorDigitado(p.amount), 0);
  const remaining = Number((total - paySum).toFixed(2));
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
    ...(comm.data?.targetHints ?? []).map((h) => ({
      key: `target-${h.id}`,
      text: `${h.name}: ${h.bonusHint}`,
    })),
    ...(comm.data?.bonusNote ? [{ key: "bonus", text: comm.data.bonusNote, tone: "bonus" as const }] : []),
  ];

  function openPay() {
    setPayments((prev) => {
      if (prev.some((p) => valorDigitado(p.amount) > 0)) return prev;
      const first = prev[0] ?? emptyPay();
      const amount = total.toFixed(2);
      return [{ ...first, amount, received: first.method === "dinheiro" ? amount : first.received }];
    });
    setPayOpen(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape continua passando (fecha o que estiver aberto), mas os atalhos
      // de acao ficam suspensos enquanto houver dialogo aberto. Sem isto o
      // handler escuta no window inteiro e dispara POR TRAS do modal: com o
      // pedido de CPF aberto (que o proprio PDV abre ao iniciar a venda), um
      // F10 por reflexo FINALIZAVA a venda -- gravando, baixando estoque e
      // perdendo o CPF que estava sendo pedido naquele instante.
      const dialogoAberto = document.querySelector('[role="dialog"][data-state="open"]') !== null;
      if (dialogoAberto && e.key !== "Escape") return;
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
    const vendaRapida = !payOpen || payments.every((p) => !p.amount.trim());
    if (vendaRapida) {
      pays = [{ method: "dinheiro", amount: total, received: total, installments: 1, brand: "", nsu: "" }];
    } else {
      pays = [];
      for (const p of payments) {
        if (!p.amount.trim()) continue;
        const amount = parseMoneyInput(p.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          openPay();
          toast.error(`Valor inválido em ${PAYMENT_LABELS[p.method]}: "${p.amount}".`);
          return;
        }
        const recebidoTexto = p.received.trim();
        const received = recebidoTexto ? parseMoneyInput(recebidoTexto) : amount;
        if (!Number.isFinite(received)) {
          openPay();
          toast.error(`Valor recebido inválido: "${p.received}".`);
          return;
        }
        pays.push({
          method: p.method,
          amount,
          received,
          installments: p.installments,
          brand: p.brand,
          nsu: p.nsu,
        });
      }
      if (pays.length === 0) {
        openPay();
        toast.error("Informe o valor de pelo menos uma forma de pagamento.");
        return;
      }
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
  const change = cashPay ? Math.max(0, valorDigitado(cashPay.received) - valorDigitado(cashPay.amount)) : 0;

  return (
    <div className="pdv-stage">
      <section className="pdv-catalog border-b border-border p-6 md:border-r md:border-b-0">
        <p className="ed-label mb-block">Peças</p>
        {/* F2 como tecla a direita, nao dentro do placeholder: no placeholder
            ela sumia junto com o texto assim que o operador comecava a digitar
            -- justo quando ainda esta aprendendo o atalho. Como chip, fica. */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, SKU ou código de barras"
            className="h-12 pr-14 pl-10 text-base"
          />
          <Kbd className="absolute top-1/2 right-3 -translate-y-1/2">F2</Kbd>
        </div>
        {!register.data?.register && activeStore ? (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="min-w-0 flex-1 text-sm">
              Caixa fechado. Abra para registrar as vendas desta loja.
            </p>
            <Field label="Fundo inicial" className="w-32">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  className="h-10 pl-9"
                  value={openAmt}
                  onChange={(e) => setOpenAmt(e.target.value)}
                />
              </div>
            </Field>
            <Button
              type="button"
              disabled={openingCaixa}
              onClick={async () => {
                if (openingCaixa) return;
                setOpeningCaixa(true);
                try {
                  await openRegisterFn({ data: { storeId: activeStore, amount: Number(openAmt) || 0 } });
                  toast.success("Caixa aberto.");
                  void qc.invalidateQueries({ queryKey: ["register"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha ao abrir o caixa");
                } finally {
                  setOpeningCaixa(false);
                }
              }}
            >
              {openingCaixa ? "Abrindo…" : "Abrir caixa"}
            </Button>
          </div>
        ) : null}
        <div className="mt-4 flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {hits.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-medium">{q ? "Nenhum resultado" : "Busque uma peça"}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                {q
                  ? "Confira o nome, SKU ou código de barras digitado."
                  : "Digite o nome, SKU ou código de barras para começar a venda."}
              </p>
            </div>
          ) : (
          hits.map((h) => (
            <button
              key={h.variantId}
              type="button"
              onClick={() => add(h)}
              className="flex items-center gap-3 bg-card p-3 text-left hover:bg-muted"
            >
              <span className="tile-photo size-12 shrink-0">
                {h.imageUrl ? (
                  <img src={h.imageUrl} alt="" />
                ) : (
                  <span className="tile-photo-fallback">{h.label.slice(0, 1)}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{h.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {h.sku} · estoque {h.stock}
                </p>
              </span>
              <p className="font-display text-lg tabular shrink-0">{formatBRL(h.price)}</p>
            </button>
          ))
          )}
        </div>
        {/* A legenda "F2 busca · F4 cliente · …" saiu daqui: cada uma dessas
            teclas agora aparece no proprio controle (busca, cliente e os
            botoes de acao), entao a lista virava uma segunda definicao da
            mesma coisa -- e ocupava altura numa tela que precisa caber
            inteira. Sem ela, a lista de resultados ganha o espaco. */}
        {lastSale ? (
          <button
            type="button"
            className="mt-auto pt-4 text-left text-sm text-primary"
            onClick={() => setReceiptOpen(true)}
          >
            Última venda: nº {lastSale.number} · {formatBRL(lastSale.total)} · ver comprovante
          </button>
        ) : null}
      </section>

      <aside className="pdv-ticket bg-card p-6">
        <p className="ed-label mb-block">Cupom</p>
        <div className="flex flex-wrap gap-2">
          {/* A tecla fica sempre visivel: antes o "(F4)" so aparecia enquanto
              nenhum cliente estava escolhido, sumindo junto com o rotulo
              assim que virava o nome do cliente. */}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setCustOpen(true)}>
            <UserRound className="size-3.5" />
            <span className="max-w-40 truncate">
              {customer?.name ?? (cpfNota ? formatDoc(cpfNota) : "Cliente")}
            </span>
            <Kbd>F4</Kbd>
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

        {/* min-h-32, nao min-h-0: com min-h-0 o carrinho era o unico bloco
            elastico do painel, entao levava todo o aperto -- com 2 itens ele
            colapsava pra 28px de altura para 200px de conteudo, e o operador
            via menos de um item da venda que estava fazendo. O piso garante
            que a VENDA e o ultimo bloco a ceder espaco, nao o primeiro. */}
        <div className="mt-block min-h-32 flex-1 space-y-2 overflow-y-auto">
          {/* Estado vazio com h-full + padding curto, nao flex-1 + py-16:
              128px de padding fixo faziam ele ficar MAIOR que o painel (192px
              de conteudo em 117px de espaco), criando barra de rolagem num
              carrinho vazio -- justamente na tela que precisa caber inteira
              sem scroll. Mesma correcao no estado vazio do catalogo. */}
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
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
                  {/* Era um <button> cru, sem classe: alvo de toque do tamanho
                      do icone (~14px), sem hover, sem anel de foco e sem nome
                      acessivel -- num balcao com touch isso erra o clique. */}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="-mt-1 -mr-1 shrink-0"
                    aria-label={`Remover ${l.label} do cupom`}
                    onClick={() => setCart((c) => c.filter((x) => x.variantId !== l.variantId))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={`Diminuir quantidade de ${l.label}`}
                      onClick={() =>
                        setCart((c) =>
                          c.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)),
                        )
                      }
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-8 text-center tabular" aria-live="polite">
                      {l.qty}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={`Aumentar quantidade de ${l.label}`}
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
          {/* O aviso de "sem vendedor" fica sempre visivel -- e uma condicao
              que muda o resultado da venda. Ja as dicas de faixa/meta sao
              acompanhamento, nao operacao: ficavam ate 4 linhas fixas
              roubando altura do carrinho, entao vao pra um detalhe que abre
              sob demanda. */}
          {!comm.data?.note && !sellerId && priced.length ? (
            <p className="text-xs text-warning">Sem vendedor — a venda não gera comissão.</p>
          ) : null}
          {commissionHints.length ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground underline-offset-2 hover:underline">
                Detalhes da comissão ({commissionHints.length})
              </summary>
              <div className="mt-1 space-y-1">
                {commissionHints.map((h) => (
                  <p key={h.key} className={cn("text-xs", h.tone === "bonus" ? "text-primary" : "text-muted-foreground")}>
                    {h.text}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <Input
          className="mt-2 h-9"
          placeholder="Observações da venda"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {/* Duas faixas, nao uma grade de seis iguais: em cima as acoes que
            MUDAM a venda (desconto, pagamento, espera), embaixo as que a
            ENCERRAM (limpar, finalizar). Antes os seis botoes tinham o mesmo
            peso visual e o olho do operador nao tinha ancora nenhuma. */}
        {/* Altura e raio IGUAIS nos seis (h-11/rounded-lg): antes a linha de
            baixo misturava h-10 com h-12 e rounded-md com rounded-lg, e o
            desencontro era o que fazia o bloco parecer inacabado. A hierarquia
            vem da cor e da largura, nao de tamanhos desalinhados. */}
        <div className="mt-block space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className={pdvActionClass} onClick={() => setDiscOpen(true)}>
              <span className="flex items-center gap-2">
                <Percent className="size-4" />
                Desconto
              </span>
              <Kbd>F6</Kbd>
            </Button>
            <Button variant="outline" className={pdvActionClass} onClick={openPay}>
              <span className="flex items-center gap-2">
                <CreditCard className="size-4" />
                Pagamento
              </span>
              <Kbd>F8</Kbd>
            </Button>
            <Button
              variant="outline"
              className={pdvActionClass}
              onClick={() => void holdCart()}
              disabled={!cart.length}
            >
              <span className="flex items-center gap-2">
                <Pause className="size-4" />
                Esperar
              </span>
              <Kbd>F9</Kbd>
            </Button>
            <Button variant="outline" className={pdvActionClass} onClick={() => setHeldOpen(true)}>
              <span className="flex items-center gap-2">
                <Play className="size-4" />
                Em espera
              </span>
              {held.data?.length ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground/8 px-1.5 text-[0.625rem] leading-none font-semibold tabular text-muted-foreground">
                  {held.data.length}
                </span>
              ) : null}
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            {/* Limpar em ghost: descarta a venda inteira, entao nao deve
                disputar atencao com Finalizar -- so precisa estar ao alcance. */}
            <Button
              variant="ghost"
              className={pdvActionClass}
              onClick={() => {
                setCart([]);
                setHeaderDisc(0);
              }}
            >
              <span className="flex items-center gap-2">
                <Trash2 className="size-4" />
                Limpar
              </span>
            </Button>
            <Button
              className={pdvActionClass}
              onClick={() => void finish()}
              disabled={busy || !register.data?.register}
            >
              <span className="flex items-center gap-2">
                <Check className="size-4" />
                {busy ? "Salvando…" : "Finalizar"}
              </span>
              <Kbd tone="on-primary">F10</Kbd>
            </Button>
          </div>
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
                  {/* Descarte em duas etapas: apagar uma venda em espera e
                      irreversivel (e o carrinho guardado de um cliente), e o
                      botao ficava a um clique do "Recuperar", sem confirmar e
                      sem nome acessivel -- um erro de clique perdia a venda. */}
                  {descartarId === h.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-muted-foreground">Descartar?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          setDescartarId(null);
                          await discardHeldFn({ data: { id: h.id } });
                          void qc.invalidateQueries({ queryKey: ["held"] });
                        }}
                      >
                        Sim
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDescartarId(null)}>
                        Não
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => void resumeHeld(h.id)}>
                        Recuperar
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Descartar venda em espera de ${h.customerName ?? "Consumidor"}`}
                        onClick={() => setDescartarId(h.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={custOpen} onOpenChange={setCustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Documento do cliente</DialogTitle>
            <DialogDescription>
              Vai no comprovante. Não é obrigatório — pode pular se o cliente não quiser informar.
            </DialogDescription>
          </DialogHeader>

          <Field label="CPF ou CNPJ na nota">
            <div className="relative">
              <IdCard className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              {/* Sem aria-label aqui: o Field ja da o nome acessivel ("CPF ou
                  CNPJ na nota"), e um aria-label sobrepoe o rotulo visivel --
                  o operador leria uma coisa e o leitor de tela anunciaria
                  outra. */}
              <Input
                inputMode="numeric"
                placeholder="Só números"
                value={cpfNota}
                onChange={(e) => setCpfNota(maskBrDoc(e.target.value))}
                className="pl-9"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Se já existir no cadastro, vincula o cliente; senão cria um consumidor.
            </p>
          </Field>

          <Field label="Buscar cliente cadastrado" className="mt-block">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Nome, telefone ou documento"
                value={custQ}
                onChange={(e) => setCustQ(e.target.value)}
              />
            </div>
          </Field>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
          <div className="mt-block flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setCpfNota("");
                setCustomerId(null);
                setCustOpen(false);
              }}
            >
              Pular
            </Button>
            <Button
              className="flex-1"
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
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={discOpen} onOpenChange={setDiscOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconto</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              variant={discMode === "value" ? "default" : "outline"}
              aria-pressed={discMode === "value"}
              onClick={() => setDiscMode("value")}
            >
              Valor
            </Button>
            <Button
              variant={discMode === "pct" ? "default" : "outline"}
              aria-pressed={discMode === "pct"}
              onClick={() => setDiscMode("pct")}
            >
              Percentual
            </Button>
          </div>
          {/* A unidade (R$ ou %) era o placeholder, entao sumia no primeiro
              digito -- e aqui ela decide o valor: "10" pode ser R$ 10 ou 10%.
              Como prefixo fixo, a referencia fica na tela enquanto digita. */}
          <Field label={discMode === "pct" ? "Desconto em percentual" : "Desconto em reais"} className="mt-block">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                {discMode === "pct" ? "%" : "R$"}
              </span>
              <Input
                className="pl-9"
                inputMode="decimal"
                value={discInput}
                onChange={(e) => setDiscInput(e.target.value)}
              />
            </div>
          </Field>
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
                {/* Campos rotulados, nao so placeholder: placeholder some no
                    primeiro digito -- num campo de DINHEIRO isso deixa o
                    operador sem saber se aquele numero e o valor cobrado ou o
                    valor recebido. Prefixo R$ pelo mesmo motivo do "Fundo
                    inicial" la no caixa. */}
                <div className="flex items-end gap-2">
                  <Field label="Forma" className="min-w-0 flex-1">
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
                  </Field>
                  <Field label="Valor" className="min-w-0 flex-1">
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                        R$
                      </span>
                      <Input
                        className="pl-9"
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) => {
                          const next = [...payments];
                          next[idx] = { ...p, amount: e.target.value };
                          setPayments(next);
                        }}
                      />
                    </div>
                  </Field>
                  {payments.length > 1 ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="mb-1 shrink-0"
                      aria-label={`Remover forma de pagamento ${PAYMENT_LABELS[p.method]}`}
                      onClick={() => setPayments(payments.filter((_, i) => i !== idx))}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
                {p.method === "dinheiro" ? (
                  <Field label="Valor recebido" className="mt-2">
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                        R$
                      </span>
                      <Input
                        className="pl-9"
                        inputMode="decimal"
                        value={p.received}
                        onChange={(e) => {
                          const next = [...payments];
                          next[idx] = { ...p, received: e.target.value };
                          setPayments(next);
                        }}
                      />
                    </div>
                  </Field>
                ) : null}
                {/* Bandeira vale pros DOIS cartoes: antes so o credito pedia,
                    entao toda venda no debito ficava sem a informacao que casa
                    a venda com o extrato da adquirente. Parcelas continuam so
                    no credito, porque debito nao parcela. */}
                {p.method === "credito" || p.method === "debito" ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="Bandeira">
                      <Select
                        value={p.brand}
                        onChange={(e) => {
                          const next = [...payments];
                          next[idx] = { ...p, brand: e.target.value };
                          setPayments(next);
                        }}
                      >
                        <option value="">Selecione…</option>
                        {CARD_BRANDS.map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </Select>
                    </Field>
                    {p.method === "credito" ? (
                      <Field label="Parcelas">
                        <Input
                          type="number"
                          min={1}
                          max={MAX_INSTALLMENTS}
                          value={p.installments}
                          onChange={(e) => {
                            const next = [...payments];
                            next[idx] = { ...p, installments: Number(e.target.value) };
                            setPayments(next);
                          }}
                        />
                      </Field>
                    ) : null}
                    <Field label="NSU / autorização" className="col-span-2">
                      <Input
                        value={p.nsu}
                        placeholder="Opcional — número do comprovante"
                        onChange={(e) => {
                          const next = [...payments];
                          next[idx] = { ...p, nsu: e.target.value };
                          setPayments(next);
                        }}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {/* Troco em destaque: e o numero que o operador le em voz alta e
              conta da gaveta. Como <p> pequeno, do mesmo peso de todo o resto,
              era a informacao mais facil de errar no fim da venda. */}
          {change > 0 ? (
            <div className="mt-block flex items-baseline justify-between rounded-lg border border-success/40 bg-success/10 px-4 py-3">
              <span className="ed-label text-success">Troco</span>
              <span className="font-display text-2xl font-semibold tabular text-success">
                {formatBRL(change)}
              </span>
            </div>
          ) : null}
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
                    brand: "",
                    nsu: "",
                  },
                ])
              }
            >
              <Plus className="size-4" />
              Forma
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
