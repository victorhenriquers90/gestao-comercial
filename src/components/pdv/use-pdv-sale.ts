import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { NfceState } from "@/components/pdv/nfce-status";
import { emptyPay, type Hit, type Line, type PayRow } from "@/components/pdv/sale-model";
import type { ReceiptData } from "@/components/receipt";
import { useOnline } from "@/hooks/use-online";
import { useSelection } from "@/hooks/use-selection";
import { PAYMENT_LABELS, type PaymentMethod } from "@/lib/constants";
import { formatBRL } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { paymentStatus, summarizeSale, valorDigitado } from "@/lib/pdv-sale";
import { bestPromo } from "@/lib/promo";
import { runAction } from "@/lib/run-action";
import {
  checkoutFn,
  discardHeldFn,
  holdSaleFn,
  listHeldFn,
  listPromotionsFn,
  resumeHeldFn,
} from "@/lib/server/commerce";
import { simulateCommissionFn } from "@/lib/server/commission";
import { getRegisterFn, openRegisterFn } from "@/lib/server/finance";
import { emitNfceAfterCheckoutFn, refreshNfceStatusFn } from "@/lib/server/nfce";
import { listActiveSellerNamesFn } from "@/lib/server/party";
import { getSettingsFn, getTenantFn } from "@/lib/server/session";

export type CustomerRef = { id: number; name: string };

/**
 * Toda a logica de uma venda no PDV — estado, queries e as acoes de
 * servidor — sem nada de teclado. Usada pela tela desktop (`/app/pdv`) e
 * pela tela tablet (`/app/pdv-tablet`): o que diverge entre as duas e so
 * layout, a logica de venda e exatamente a mesma, pro mesmo banco.
 *
 * Atalho de teclado (F2/F4/F6/F8/F9/F10/Escape) e navegacao do carrinho com
 * a busca vazia (setas/+/-/Delete) ficam de FORA de proposito — cada tela
 * decide se faz sentido pra ela (o tablet nao tem teclado fisico).
 */
export function usePdvSale() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const online = useOnline();
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const activeStore = storeId ?? tenant.data?.defaultStoreId ?? 0;
  const searchRef = useRef<HTMLInputElement>(null);
  /** Ultima loja vista pelo efeito abaixo — `null` so antes da primeira loja real carregar. */
  const lojaRef = useRef<number | null>(null);

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
  /**
   * Uma chave por TENTATIVA de fechamento, reenviada igual em cada retry.
   *
   * Sem isto, uma falha de rede bem no instante em que o servidor ja
   * comitou a venda deixava a tela sem confirmacao -- e um reenvio natural
   * (recarregar, nova aba, clicar de novo) duplicava a venda inteira, com
   * baixa de estoque em dobro. Reproduzido ao vivo. So zera numa venda nova
   * de verdade (ver `novaVenda`); um retry da MESMA tentativa reusa a
   * mesma chave de proposito.
   */
  const checkoutKey = useRef<string | null>(null);
  const [lastSale, setLastSale] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [nfce, setNfce] = useState<NfceState | null>(null);
  const [nfceConsultando, setNfceConsultando] = useState(false);
  /** Venda dona do status de NFC-e na tela: resposta atrasada de outra nao pinta esta. */
  const nfceDaVenda = useRef<number | null>(null);
  const [openAmt, setOpenAmt] = useState("");
  const [openingCaixa, setOpeningCaixa] = useState(false);

  const sellers = useQuery({
    queryKey: ["seller-names"],
    queryFn: () => listActiveSellerNamesFn(),
  });
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

  /**
   * Trocar a loja no seletor do topo com uma venda em andamento NAO podia
   * deixar o carrinho como estava.
   *
   * Preco e estoque sao lidos da loja no momento em que cada item e
   * adicionado (`add()` grava `stock` e preco ali, uma vez so) -- trocar a
   * loja depois nao atualiza nada no carrinho, e `Finalizar venda` manda
   * `storeId: activeStore`, ou seja, a loja ATUAL no seletor, nao a loja em
   * que o item foi escolhido. Reproduzido ao vivo: produto escolhido com a
   * Loja Centro selecionada, troca pra Loja Shopping sem tocar no
   * carrinho, Finalizar -- a venda e a baixa de estoque saem inteiras na
   * Shopping, a Centro (onde o operador viu o produto) nunca e tocada. Sem
   * aviso, sem erro: parece uma venda normal. So nao deu pra reproduzir
   * ainda pior (loja nova sem aquele produto) porque falta de estoque
   * acusa erro -- mas com estoque suficiente nos dois lados, o engano
   * passa batido.
   *
   * `lojaRef` so para de ser `null` na primeira loja de verdade (o valor
   * nasce 0 enquanto o tenant ainda carrega); a partir dai, qualquer
   * mudanca com carrinho não-vazio cancela a venda em vez de deixar o
   * carrinho seguir pra loja errada.
   */
  useEffect(() => {
    if (!activeStore) return;
    if (lojaRef.current != null && lojaRef.current !== activeStore && cart.length > 0) {
      novaVenda();
      toast.error("Loja trocada: a venda em andamento foi cancelada — preço e estoque são por loja.");
    }
    lojaRef.current = activeStore;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- so deve disparar quando a LOJA muda; cart/novaVenda sao lidos no instante, nao devem re-rodar o efeito sozinhos
  }, [activeStore]);

  const priced = cart.map((l) => {
    /*
      `l.price` ja e o preco promocional do produto quando ha um
      (searchPosFn/resumeHeldFn: promo_price se > 0 e < preco cheio, senao
      o preco cheio mesmo -- ver effectivePrice em lib/promo.ts). `l.listPrice`
      e SEMPRE o preco cheio, nunca null -- por isso `l.listPrice ?? l.price`
      nunca chegava a olhar pra `l.price`: o fallback nunca disparava, e um
      produto com preco promocional aparecia com o preco certo na busca e
      cobrava o preco CHEIO no carrinho, sem aviso nenhum (nem pro operador,
      nem pro cliente). `override` e o unico caso de verdade que deve pisar
      no preco promocional (ninguem ainda seta isto na UI, mas o campo existe
      pra quando pdv.price_override ganhar um controle de verdade).
    */
    const sellPrice = l.override ?? l.price;
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
    ...(comm.data?.targetHints ?? []).map((h) => ({
      key: `target-${h.id}`,
      text: `${h.name}: ${h.bonusHint}`,
    })),
    ...(comm.data?.bonusNote
      ? [{ key: "bonus", text: comm.data.bonusNote, tone: "bonus" as const }]
      : []),
  ];
  const commissionPerLine = priced.map((_, idx) => {
    const c = comm.data?.lines[idx];
    if (!c) return null;
    return c.amount <= 0
      ? `sem comissão · ${c.ruleName}`
      : `comissão ${formatBRL(c.amount)} · ${c.ruleName}`;
  });
  /** Resumo de comissao pro cupom (`SalePanel`) — mesmo texto no desktop e no tablet. */
  const commissionSummary = {
    show: Boolean(sellerId) && priced.length > 0 && comm.data != null,
    amount: comm.data?.amount ?? 0,
    net: comm.data?.tax && comm.data.tax.totalTax > 0.009 ? comm.data.tax.net : null,
    warnNoSeller: !sellerId && priced.length > 0,
    hints: commissionHints,
  };
  /** Mesmo aviso de comissao repetido no dialogo de pagamento. */
  const commissionNote = comm.data
    ? [
        `Comissão prevista ${formatBRL(comm.data.amount)}`,
        comm.data.note,
        comm.data.volumeNote,
        comm.data.bonusNote,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

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
    checkoutKey.current = null;
  }

  /** Cancelar a venda atual — mesmo texto e mesmo refoco nas duas telas. */
  function cancelarVenda() {
    novaVenda();
    toast("Venda cancelada.");
    searchRef.current?.focus();
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
      setPayments([
        { ...first, amount, received: first.method === "dinheiro" ? amount : first.received },
      ]);
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
      return [
        {
          ...r,
          amount: alvo,
          received: r.method === "dinheiro" && r.received === antes ? alvo : r.received,
        },
      ];
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
          payloadJson: JSON.stringify({
            cart,
            headerDisc,
            customerId: customer?.id ?? null,
            sellerId,
            notes,
            cpfNota,
          }),
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
        if (Math.abs(c.price - l.price) > 0.004 || Math.abs(c.listPrice - l.listPrice) > 0.004)
          mudaram++;
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
        mudaram
          ? `${mudaram} ${mudaram === 1 ? "item mudou" : "itens mudaram"} de preço desde que a venda foi guardada`
          : null,
        sairam
          ? `${sairam} ${sairam === 1 ? "item saiu" : "itens saíram"} do catálogo e ${sairam === 1 ? "foi removido" : "foram removidos"}`
          : null,
      ].filter(Boolean);
      if (avisos.length) toast.warning(`Venda recuperada. ${avisos.join("; ")}. Confira o total.`);
      else toast.success("Venda recuperada.");
      void qc.invalidateQueries({ queryKey: ["held"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível recuperar a venda.");
    }
  }

  /** Descartar venda guardada — mesmo aviso de erro nas duas telas. */
  async function discardHeld(id: number) {
    // Sem o runAction, uma recusa do servidor nao dizia nada: o
    // "Descartar?" sumia e a venda continuava na lista.
    await runAction(() => discardHeldFn({ data: { id } }), {
      erro: "Não foi possível descartar a venda guardada.",
    });
    void qc.invalidateQueries({ queryKey: ["held"] });
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
      pays = [
        { method: "dinheiro", amount: total, received: total, installments: 1, brand: "", nsu: "" },
      ];
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
        setPayOpen(true);
        toast.error("Informe o valor de pelo menos uma forma de pagamento.");
        return;
      }
    }
    if (pays.reduce((a, p) => a + p.amount, 0) + 0.05 < total) {
      setPayOpen(true);
      toast.error(
        `Pagamento incompleto: faltam ${formatBRL(total - pays.reduce((a, p) => a + p.amount, 0))}.`,
      );
      return;
    }
    if (acaoEmCurso.current) return;
    acaoEmCurso.current = true;
    setBusy(true);
    checkoutKey.current ??= crypto.randomUUID();
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
          idempotencyKey: checkoutKey.current,
        },
      });
      setLastSale(res);
      setReceiptOpen(true);
      nfceDaVenda.current = res.id;
      if (res.nfce) {
        setNfce({ fase: "emitindo" });
        void emitirNota(res.id);
      } else {
        setNfce(null);
      }
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

  function aplicarStatusNota(
    saleId: number,
    s: {
      status: string;
      numero: string | null;
      danfeUrl: string | null;
      error: string | null;
      env: string;
    },
  ) {
    if (nfceDaVenda.current !== saleId) return;
    if (s.status.startsWith("erro")) {
      setNfce({ fase: "erro", mensagens: [s.error ?? "A SEFAZ recusou a nota."] });
      toast.error(`NFC-e recusada: ${s.error ?? "veja o comprovante."}`);
      return;
    }
    setNfce({
      fase: "ok",
      status: s.status,
      numero: s.numero,
      danfeUrl: s.danfeUrl,
      teste: s.env === "homologacao",
    });
  }

  /** Fora do checkout de proposito: a venda ja esta gravada, a nota nao a segura. */
  async function emitirNota(saleId: number) {
    try {
      const r = await emitNfceAfterCheckoutFn({ data: { saleId } });
      if (nfceDaVenda.current !== saleId) return;
      if (r.skipped) {
        setNfce(null);
        return;
      }
      if (!r.ok) {
        setNfce({ fase: "erro", mensagens: r.errors });
        toast.error(`NFC-e não emitida: ${r.errors[0] ?? "erro desconhecido"}`);
        return;
      }
      aplicarStatusNota(saleId, r);
    } catch (e) {
      if (nfceDaVenda.current !== saleId) return;
      const msg = e instanceof Error ? e.message : "Falha ao emitir a nota fiscal.";
      setNfce({ fase: "erro", mensagens: [msg] });
      toast.error(`NFC-e não emitida: ${msg}`);
    }
  }

  async function consultarNota() {
    const saleId = nfceDaVenda.current;
    if (saleId == null || nfceConsultando) return;
    setNfceConsultando(true);
    try {
      aplicarStatusNota(saleId, await refreshNfceStatusFn({ data: { saleId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível consultar a nota.");
    } finally {
      setNfceConsultando(false);
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

  return {
    activeStore,
    searchRef,
    online,
    tenant,

    cart,
    priced,
    selectedId,
    setSelectedId,
    flash,
    setQty,
    remove,
    add,

    customer,
    setCustomer,
    cpfNota,
    setCpfNota,
    docDispensado,
    setDocDispensado,

    sellers,
    sellerId,
    setSellerId,

    notes,
    setNotes,

    summary,
    subtotal,
    total,
    discount,
    headerDisc,
    setHeaderDisc,

    payments,
    setPayments,
    pay,
    payOpen,
    setPayOpen,
    openPay,

    custOpen,
    setCustOpen,
    discOpen,
    setDiscOpen,

    held,
    heldOpen,
    setHeldOpen,
    holdCart,
    resumeHeld,
    discardHeld,

    busy,
    novaVenda,
    cancelarVenda,
    finish,

    registerOpen,
    openAmt,
    setOpenAmt,
    openingCaixa,
    abrirCaixa,

    lastSale,
    receiptOpen,
    setReceiptOpen,
    settings,

    nfce,
    nfceConsultando,
    consultarNota,

    comm,
    commissionHints,
    commissionPerLine,
    commissionSummary,
    commissionNote,

    tenantDiscountLimit: tenant.data?.discountLimit ?? 0,
  };
}
