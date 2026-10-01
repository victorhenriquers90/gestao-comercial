import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { HeldSalesDialog } from "@/components/pdv/held-sales-dialog";
import { NfceStatus } from "@/components/pdv/nfce-status";
import { PaymentDialog } from "@/components/pdv/payment-dialog";
import { ProductSearch } from "@/components/pdv/product-search";
import { SaleBar } from "@/components/pdv/sale-bar";
import { receiptCompany } from "@/components/pdv/sale-model";
import { usePdvSale } from "@/components/pdv/use-pdv-sale";
import { TouchCartTable } from "@/components/pdv-tablet/touch-cart-table";
import { TouchSalePanel } from "@/components/pdv-tablet/touch-sale-panel";
import { Receipt } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import "@/styles/pdv-tablet.css";

// Path comeca com "/app/pdv" de proposito: `app-shell.tsx` trata qualquer
// rota com esse prefixo como tela de PDV (sidebar escondida, sem padding,
// tela cheia) -- de graca, sem tocar em app-shell.tsx.
export const Route = createFileRoute("/app/pdv-tablet")({ component: PdvTabletPage });

function PdvTabletPage() {
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

  return (
    <div className="pdvt-stage">
      <section className="pdvt-main" aria-label="Produtos da venda">
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
              <p className="text-base font-medium">Caixa fechado</p>
              <p className="text-sm text-muted-foreground">Abra o caixa para registrar vendas nesta loja.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Fundo inicial</span>
              <span className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  className="h-12 w-36 rounded-sm pl-9 text-base tabular"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={openAmt}
                  onChange={(e) => setOpenAmt(e.target.value)}
                />
              </span>
            </label>
            <Button type="submit" className="h-12 rounded-sm px-5 text-base" disabled={openingCaixa}>
              {openingCaixa ? "Abrindo…" : "Abrir caixa"}
            </Button>
          </form>
        ) : null}

        <ProductSearch ref={searchRef} storeId={activeStore} onPick={add} />

        <TouchCartTable
          lines={priced}
          commission={commissionPerLine}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onQty={setQty}
          onRemove={remove}
          flash={flash}
        />
      </section>

      <TouchSalePanel
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
            <NfceStatus state={nfce} onRefresh={() => void consultarNota()} refreshing={nfceConsultando} />
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
