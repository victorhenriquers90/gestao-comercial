import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Receipt, type ReceiptCompany, type ReceiptData } from "@/components/receipt";
import { TaxBreakdown } from "@/components/tax-breakdown";
import { DataTable, EmptyState, PageHeader, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { useSearchId } from "@/hooks/use-search-id";
import { useSelection } from "@/hooks/use-selection";
import { SALE_STATUS_LABELS, ACCOUNT_STATUS_LABELS, NFCE_STATUS_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime, formatDoc, formatPct } from "@/lib/format";
import { parseTaxBreakdown } from "@/lib/tax";
import { cancelSaleFn, getSaleFn, listSalesFn } from "@/lib/server/commerce";
import { getSettingsFn } from "@/lib/server/session";
import { cancelNfceFn, emitNfceFn, nfceStatusFn, refreshNfceStatusFn } from "@/lib/server/nfce";
import {
  CANCEL_REASON_MIN,
  NFCE_CANCEL_WINDOW_MINUTES,
  cancelWindow,
} from "@/lib/nfce-cancel";
import { num } from "@/lib/utils";

export const Route = createFileRoute("/app/vendas")({
  component: VendasPage,
});

function VendasPage() {
  const storeId = useSelection((s) => s.storeId);
  const qc = useQueryClient();
  const searchId = useSearchId();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const list = useQuery({
    queryKey: ["sales", storeId, q, from, to],
    queryFn: () =>
      listSalesFn({
        data: { storeId: storeId ?? undefined, q: q || undefined, from: from || undefined, to: to || undefined },
      }),
  });
  const detail = useQuery({
    queryKey: ["sale", openId],
    queryFn: () => getSaleFn({ data: { id: openId! } }),
    enabled: openId != null,
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });
  const nfceStatus = useQuery({ queryKey: ["nfce-status"], queryFn: () => nfceStatusFn() });
  const [nfceBusy, setNfceBusy] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  async function cancelarNota() {
    if (nfceBusy || !openId) return;
    setNfceBusy(true);
    try {
      const r = await cancelNfceFn({
        data: { saleId: openId, justificativa },
      });
      if (r.ok) {
        toast.success("Nota cancelada no SEFAZ.");
        setJustificativa("");
      } else {
        // Recusa do SEFAZ não é falha do sistema: o texto dele é a
        // informação mais útil que existe aqui, e some se virar
        // "erro ao cancelar".
        toast.error(r.erro ?? "O SEFAZ recusou o cancelamento.");
      }
      void qc.invalidateQueries({ queryKey: ["sale", openId] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar a nota.");
    } finally {
      setNfceBusy(false);
    }
  }

  const nfceEnabled = Boolean((settings.data?.settings as Record<string, unknown> | null)?.nfce_enabled);

  useEffect(() => {
    if (searchId) setOpenId(searchId);
  }, [searchId]);

  async function emitNfce() {
    if (openId == null) return;
    setNfceBusy(true);
    try {
      const res = await emitNfceFn({ data: { saleId: openId } });
      if (res.ok) toast.success("Nota fiscal enviada — processando na SEFAZ.");
      else res.errors.forEach((e) => toast.error(e));
      void qc.invalidateQueries({ queryKey: ["sale", openId] });
      void qc.invalidateQueries({ queryKey: ["sales"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao emitir.");
    } finally {
      setNfceBusy(false);
    }
  }

  async function refreshNfce() {
    if (openId == null) return;
    setNfceBusy(true);
    try {
      const res = await refreshNfceStatusFn({ data: { saleId: openId } });
      if (res.error) toast.error(res.error);
      void qc.invalidateQueries({ queryKey: ["sale", openId] });
      void qc.invalidateQueries({ queryKey: ["sales"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar status.");
    } finally {
      setNfceBusy(false);
    }
  }

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar vendas." />;

  return (
    <div>
      <PageHeader title="Vendas" description="Histórico, comprovante e cancelamento." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Número ou cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {!list.data?.length ? (
        <EmptyState title="Nenhuma venda neste filtro." description="Ajuste o período ou registre a primeira venda no PDV." />
      ) : (
        <DataTable
          headers={
            <tr>
              <Th>Nº</Th>
              <Th>Data</Th>
              <Th>Cliente</Th>
              <Th>Documento</Th>
              <Th>Vendedor</Th>
              <Th>Loja</Th>
              <Th className="col-num">Total</Th>
              <Th>Status</Th>
            </tr>
          }
        >
          {(list.data as Record<string, unknown>[]).map((s) => (
            <tr
              key={String(s.id)}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              onClick={() => setOpenId(num(s.id))}
            >
              <Td className="tabular">{String(s.number)}</Td>
              <Td>{formatDateTime(String(s.sold_at))}</Td>
              <Td>{String(s.customer_name ?? "—")}</Td>
              <Td className="tabular">{s.document ? formatDoc(String(s.document)) : "—"}</Td>
              <Td>{String(s.seller_name ?? "—")}</Td>
              <Td>{String(s.store_name ?? "—")}</Td>
              <Td className="tabular col-num">{formatBRL(num(s.total))}</Td>
              <Td>
                <Badge variant={statusBadgeVariant(String(s.status))}>
                  {SALE_STATUS_LABELS[String(s.status)] ?? String(s.status)}
                </Badge>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Dialog open={openId != null} onOpenChange={() => setOpenId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Venda {detail.data ? `nº ${detail.data.sale.number}` : ""}</DialogTitle>
          </DialogHeader>
          {detail.data ? (
            <div className="space-y-block text-sm">
              <Receipt
                data={saleToReceipt(detail.data)}
                company={receiptCompany(settings.data)}
              />
              {nfceEnabled && String(detail.data.sale.status) === "finalizada"
                ? (() => {
                    const st = detail.data.sale.nfce_status
                      ? String(detail.data.sale.nfce_status)
                      : null;
                    const env = detail.data.sale.nfce_env
                      ? String(detail.data.sale.nfce_env)
                      : null;
                    /* Uma nota de TESTE nao barra a nota que vale: sem isto,
                       toda venda usada pra testar ficaria para sempre sem
                       documento fiscal, com cara de que tem. O servidor
                       repete a checagem -- aqui e so o botao. */
                    const substituiTeste =
                      st != null &&
                      st !== "erro" &&
                      env === "homologacao" &&
                      nfceStatus.data?.env === "producao";
                    const podeEmitir = st == null || st === "erro" || substituiTeste;
                    const autorizada = st === "autorizado";
                    const janela = cancelWindow(
                      detail.data.sale.nfce_authorized_at
                        ? String(detail.data.sale.nfce_authorized_at)
                        : null,
                    );
                    const pendencia = detail.data.sale.nfce_pendencia
                      ? String(detail.data.sale.nfce_pendencia)
                      : null;
                    return (
                <div className="no-print rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Nota fiscal (NFC-e)</p>
                    <div className="flex items-center gap-2">
                      {/* Nota de teste nao pode parecer nota. Ela grava status
                          'autorizado', chave, numero e DANFE iguais aos de uma real
                          -- so este selo diz que nada daquilo vale. */}
                      {detail.data.sale.nfce_env === "homologacao" ? (
                        <Badge variant="danger">Teste — sem valor fiscal</Badge>
                      ) : null}
                      {detail.data.sale.nfce_status ? (
                        <Badge variant={statusBadgeVariant(String(detail.data.sale.nfce_status))}>
                          {NFCE_STATUS_LABELS[String(detail.data.sale.nfce_status)] ?? String(detail.data.sale.nfce_status)}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {detail.data.sale.nfce_error ? (
                    <p className="mt-1 text-xs text-destructive">{String(detail.data.sale.nfce_error)}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {podeEmitir ? (
                      <Button size="sm" disabled={nfceBusy || !nfceStatus.data?.available} onClick={() => void emitNfce()}>
                        {nfceBusy
                          ? "Emitindo…"
                          : substituiTeste
                            ? "Emitir nota real"
                            : "Emitir NFC-e"}
                      </Button>
                    ) : null}
                    {detail.data.sale.nfce_status === "processando_autorizacao" ? (
                      <Button size="sm" variant="outline" disabled={nfceBusy} onClick={() => void refreshNfce()}>
                        {nfceBusy ? "Consultando…" : "Atualizar status"}
                      </Button>
                    ) : null}
                    {detail.data.sale.nfce_danfe_url ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={String(detail.data.sale.nfce_danfe_url)} target="_blank" rel="noreferrer">
                          Ver DANFE
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  {/* A divergência fiscal fica escrita na venda, não só no
                      sino: quem abre esta venda depois precisa ver que a
                      nota continua valendo pra algo que não existe. */}
                  {pendencia ? (
                    <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <p className="font-medium">Pendência fiscal</p>
                      <p className="mt-1 text-muted-foreground">{pendencia}</p>
                    </div>
                  ) : null}

                  {autorizada ? (
                    <div className="mt-2 rounded-lg border border-border p-3">
                      <p className="text-sm font-medium">Cancelar a nota no SEFAZ</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {janela.provavelmenteExpirado
                          ? `Emitida há ${janela.minutosDecorridos} min — o prazo de ${NFCE_CANCEL_WINDOW_MINUTES} min provavelmente passou, mas dá pra tentar: quem decide é o SEFAZ.`
                          : `Restam cerca de ${janela.minutosRestantes} min do prazo de cancelamento.`}
                      </p>
                      <Textarea
                        className="mt-2"
                        placeholder="Justificativa para o SEFAZ (mínimo 15 caracteres)"
                        value={justificativa}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setJustificativa(e.target.value)}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            nfceBusy ||
                            !nfceStatus.data?.available ||
                            justificativa.trim().length < CANCEL_REASON_MIN
                          }
                          onClick={() => void cancelarNota()}
                        >
                          {nfceBusy ? "Cancelando…" : "Cancelar nota fiscal"}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {justificativa.trim().length}/{CANCEL_REASON_MIN}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {!nfceStatus.data?.available ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Emissão não configurada no servidor (FOCUS_NFE_TOKEN).
                    </p>
                  ) : null}
                  {substituiTeste ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Esta venda tem nota de teste. Emitir agora gera a nota real e substitui
                      os dados do teste.
                    </p>
                  ) : null}
                </div>
                    );
                  })()
                : null}
              {detail.data.commission ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="font-medium">
                    Comissão {formatBRL(detail.data.commission.amount)}
                    {detail.data.commission.net != null &&
                    detail.data.commission.net !== detail.data.commission.amount ? (
                      <span className="ml-2 text-success">líquido {formatBRL(detail.data.commission.net)}</span>
                    ) : null}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {formatPct(detail.data.commission.percent)} ·{" "}
                      {ACCOUNT_STATUS_LABELS[detail.data.commission.status] ?? detail.data.commission.status}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {detail.data.commission.ruleName ?? detail.data.commission.note ?? "Padrão do vendedor"}
                  </p>
                  {detail.data.commission.lines?.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {detail.data.commission.lines.map((l, i) => (
                        <li key={`${l.productId}-${i}`} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate text-muted-foreground">
                            {l.productName} · {l.ruleName}
                          </span>
                          <span className="shrink-0 tabular">{formatBRL(l.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {detail.data.commission.net != null ? (
                    <div className="mt-3">
                      <TaxBreakdown
                        compact
                        tax={parseTaxBreakdown(detail.data.commission.taxBreakdown, {
                          amount: detail.data.commission.amount,
                          net: detail.data.commission.net,
                          inss: detail.data.commission.taxInss,
                          irrf: detail.data.commission.taxIrrf,
                          iss: detail.data.commission.taxIss,
                          other: detail.data.commission.taxOther,
                        })}
                      />
                    </div>
                  ) : null}
                </div>
              ) : String(detail.data.sale.seller_name ?? "") ? (
                <p className="text-xs text-muted-foreground">Esta venda não gerou comissão.</p>
              ) : null}
              {String(detail.data.sale.status) === "finalizada" ? (
                <div className="no-print flex gap-2">
                  <Input placeholder="Motivo do cancelamento" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (!reason.trim()) return toast.error("Informe o motivo.");
                      try {
                        await cancelSaleFn({ data: { id: openId!, reason } });
                        toast.success("Venda cancelada. Estoque restaurado.");
                        setOpenId(null);
                        void qc.invalidateQueries({ queryKey: ["sales"] });
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Falha");
                      }
                    }}
                  >
                    Cancelar venda
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function saleToReceipt(detail: Awaited<ReturnType<typeof getSaleFn>>): ReceiptData {
  const sale = detail.sale as Record<string, unknown>;
  const items = (detail.items as Record<string, unknown>[]) ?? [];
  const payments = (detail.payments as Record<string, unknown>[]) ?? [];
  return {
    number: num(sale.number),
    soldAt: String(sale.sold_at ?? ""),
    storeName: sale.store_name ? String(sale.store_name) : null,
    customerName: sale.customer_name ? String(sale.customer_name) : null,
    customerDocument: sale.document ? String(sale.document) : null,
    sellerName: sale.seller_name ? String(sale.seller_name) : null,
    notes: sale.notes ? String(sale.notes) : null,
    items: items.map((i) => ({
      description: String(i.description ?? ""),
      quantity: num(i.quantity),
      unitPrice: num(i.unit_price),
      discount: num(i.discount),
      total: num(i.total),
    })),
    payments: payments.map((p) => ({
      method: String(p.method ?? ""),
      amount: num(p.amount),
      received: p.received == null ? undefined : num(p.received),
      change: p.change_amount == null ? undefined : num(p.change_amount),
      installments: p.installments == null ? undefined : num(p.installments),
    })),
    subtotal: num(sale.subtotal),
    discount: num(sale.discount),
    total: num(sale.total),
  };
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
