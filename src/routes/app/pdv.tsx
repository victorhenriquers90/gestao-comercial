import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CartTable } from "@/components/pdv/cart-table";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { HeldSalesDialog } from "@/components/pdv/held-sales-dialog";
import { NfceStatus } from "@/components/pdv/nfce-status";
import { PaymentDialog } from "@/components/pdv/payment-dialog";
import { ProductSearch } from "@/components/pdv/product-search";
import { SaleBar } from "@/components/pdv/sale-bar";
import { SalePanel } from "@/components/pdv/sale-panel";
import { receiptCompany } from "@/components/pdv/sale-model";
import { usePdvSale } from "@/components/pdv/use-pdv-sale";
import { Receipt } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/app/pdv")({ component: PdvPage });

function PdvPage() {
  const pdv = usePdvSale();
  const {
    activeStore,
    searchRef,
    online,
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
    commissionPerLine,
    commissionSummary,
    commissionNote,
    tenantDiscountLimit,
  } = pdv;

  /** Teclas com a busca vazia: o cupom responde ao teclado. */
  function onCartKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!cart.length) return;
    const i = Math.max(
      0,
      cart.findIndex((l) => l.variantId === selectedId),
    );
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
              <p className="text-xs text-muted-foreground">
                Abra o caixa para registrar vendas nesta loja.
              </p>
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

        <ProductSearch
          ref={searchRef}
          storeId={activeStore}
          onPick={add}
          onEmptyKeyDown={onCartKey}
        />

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
        commission={commissionSummary}
        notes={notes}
        onNotes={setNotes}
        heldCount={held.data?.length ?? 0}
        onHold={() => void holdCart()}
        onHeld={() => setHeldOpen(true)}
        onCancel={cancelarVenda}
        onFinish={() => void finish()}
        busy={busy}
        registerOpen={registerOpen === true}
      />

      <HeldSalesDialog
        open={heldOpen}
        onOpenChange={setHeldOpen}
        held={held.data ?? []}
        onResume={(id) => void resumeHeld(id)}
        onDiscard={discardHeld}
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
        limitPct={tenantDiscountLimit}
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
        commissionNote={commissionNote}
        busy={busy}
        onConfirm={() => void finish()}
      />

      <Dialog open={receiptOpen && lastSale != null} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Venda nº {lastSale?.number} concluída</DialogTitle>
          </DialogHeader>
          {nfce ? (
            <NfceStatus
              state={nfce}
              onRefresh={() => void consultarNota()}
              refreshing={nfceConsultando}
            />
          ) : null}
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
