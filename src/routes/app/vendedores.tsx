import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CommissionRulesTab, CommissionSimTab } from "@/components/commission-panel";
import { CommissionNetTab } from "@/components/commission-net";
import { CommissionSlip, type CommissionSlipData } from "@/components/commission-slip";
import { IssRateField } from "@/components/iss-rate";
import { RetentionGuide } from "@/components/retention-guide";
import { TaxBreakdown } from "@/components/tax-breakdown";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, KpiCard, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { useSelection } from "@/hooks/use-selection";
import { ACCOUNT_STATUS_LABELS } from "@/lib/constants";
import { formatBRL, formatDateTime, formatDoc } from "@/lib/format";
import { parseBrDocument, sellerDocKind, maskCnpj } from "@/lib/document";
import { parseTaxBreakdown, TAX_REGIME_LABELS, TAX_REGIMES, clampIss, ISS_DEFAULT, issSellerHint, MEI_ISS_NOTE, type TaxRegime } from "@/lib/tax";
import { listCommissionsFn, payCommissionFn, payPendingCommissionsFn } from "@/lib/server/finance";
import { listSellersFn, saveSellerFn } from "@/lib/server/party";
import { retentionGuideFn } from "@/lib/server/retention";
import { getSettingsFn } from "@/lib/server/session";
import { resolvePeriod } from "@/lib/period";

export const Route = createFileRoute("/app/vendedores")({ component: VendedoresPage });

function companyHeader(settings: Awaited<ReturnType<typeof getSettingsFn>> | undefined) {
  const c = (settings?.company ?? {}) as Record<string, unknown>;
  return {
    companyName: String(c.trade_name || c.name || ""),
    companyDocument: c.document == null ? null : String(c.document),
    companyCity: c.city == null ? null : String(c.city),
    companyState: c.state == null ? null : String(c.state),
  };
}

function VendedoresPage() {
  const qc = useQueryClient();
  const storeId = useSelection((s) => s.storeId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: undefined as number | undefined,
    name: "",
    email: "",
    phone: "",
    document: "",
    commissionPct: 5,
    taxRegime: "none",
    monthlySalary: "",
    dependents: "0",
    issRate: "",
  });
  const [sellerFilter, setSellerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pendente");
  const [taxOpen, setTaxOpen] = useState<number | null>(null);
  const [slips, setSlips] = useState<CommissionSlipData[] | null>(null);
  const list = useQuery({ queryKey: ["sellers"], queryFn: () => listSellersFn() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });
  const commissions = useQuery({
    queryKey: ["commissions", sellerFilter, statusFilter],
    queryFn: () =>
      listCommissionsFn({
        data: {
          sellerId: sellerFilter ? Number(sellerFilter) : undefined,
          status: statusFilter || undefined,
        },
      }),
  });
  const monthRange = resolvePeriod("month");
  const guide = useQuery({
    queryKey: ["retention-guide", monthRange.from, monthRange.to],
    queryFn: () => retentionGuideFn({ data: { from: monthRange.from, to: monthRange.to } }),
  });

  if (list.isPending) return <PageSkeleton />;
  const ranked = [...(list.data ?? [])].sort((a, b) => b.month_revenue - a.month_revenue);
  const pendingTotal = (list.data ?? []).reduce((a, s) => a + s.pending_commission, 0);
  const sellers = list.data ?? [];

  function refreshPay() {
    void qc.invalidateQueries({ queryKey: ["commissions"] });
    void qc.invalidateQueries({ queryKey: ["sellers"] });
    void qc.invalidateQueries({ queryKey: ["expenses"] });
    void qc.invalidateQueries({ queryKey: ["flow"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["retention-guide"] });
    void qc.invalidateQueries({ queryKey: ["report"] });
  }

  async function pay(id: number) {
    try {
      const res = await payCommissionFn({ data: { id, storeId } });
      toast.success("Comissão paga. Folha no líquido e retenções em Impostos.");
      if (res.slips?.length) setSlips(res.slips);
      refreshPay();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  async function payAll(sellerId?: number) {
    try {
      const res = await payPendingCommissionsFn({
        data: { storeId, sellerId: sellerId ?? (sellerFilter ? Number(sellerFilter) : undefined) },
      });
      toast.success(`${res.count} comissões pagas · líquido ${formatBRL(res.net ?? res.amount)}`);
      if (res.slips?.length) setSlips(res.slips);
      refreshPay();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  function startSeller(s?: (typeof sellers)[number]) {
    if (s) {
      setForm({
        id: s.id,
        name: s.name,
        email: s.email ?? "",
        phone: s.phone ?? "",
        document: s.document ?? "",
        commissionPct: s.commission_pct,
        taxRegime: s.tax_regime ?? "none",
        monthlySalary: s.monthly_salary ? String(s.monthly_salary) : "",
        dependents: String(s.dependents ?? 0),
        issRate: s.iss_rate != null ? String(s.iss_rate) : "",
      });
    } else {
      setForm({
        id: undefined,
        name: "",
        email: "",
        phone: "",
        document: "",
        commissionPct: 5,
        taxRegime: "none",
        monthlySalary: "",
        dependents: "0",
        issRate: "",
      });
    }
    setOpen(true);
  }

  const companyIss = Number((settings.data?.settings as Record<string, unknown> | null)?.iss_rate ?? ISS_DEFAULT);
  const companyWithhold = (settings.data?.settings as Record<string, unknown> | null)?.iss_withhold !== false;
  const pendingNet = (list.data ?? []).reduce((a, s) => a + (s.pending_net ?? s.pending_commission), 0);

  function previewSlip(commissionId: number): CommissionSlipData | null {
    const c = (commissions.data ?? []).find((row) => row.id === commissionId);
    if (!c) return null;
    const seller = sellers.find((s) => s.id === c.sellerId);
    const tax = parseTaxBreakdown(c.taxBreakdown, {
      amount: c.amount,
      net: c.net,
      inss: c.taxInss,
      irrf: c.taxIrrf,
      iss: c.taxIss,
      other: c.taxOther,
    });
    return {
      paidAt: c.paidAt ?? c.createdAt,
      sellerName: c.sellerName,
      sellerDocument: seller?.document ?? null,
      sellerPhone: seller?.phone ?? null,
      regime: tax.regime,
      sales: [
        {
          saleNumber: c.saleNumber,
          rule: c.ruleName ?? c.note ?? "",
          gross: c.amount,
          net: c.net,
        },
      ],
      tax,
      ...companyHeader(settings.data),
    };
  }

  return (
    <div>
      <PageHeader
        title="Vendedores e comissões"
        description="Regras, simulador e o líquido depois de INSS, IRRF e ISS."
        actions={<Button onClick={() => startSeller()}>Novo vendedor</Button>}
      />
      <Tabs defaultValue="liquido">
        <TabsList className="flex-wrap">
          <TabsTrigger value="liquido">Líquido</TabsTrigger>
          <TabsTrigger value="regras">Regras</TabsTrigger>
          <TabsTrigger value="simulador">Simulador</TabsTrigger>
          <TabsTrigger value="equipe">Equipe</TabsTrigger>
          <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
          <TabsTrigger value="retencoes">Retenções</TabsTrigger>
        </TabsList>
        <TabsContent value="liquido">
          <CommissionNetTab
            sellers={sellers}
            companyIssRate={companyIss}
            companyWithholdIss={companyWithhold}
            company={companyHeader(settings.data)}
          />
        </TabsContent>
        <TabsContent value="regras">
          <CommissionRulesTab sellers={sellers} />
        </TabsContent>
        <TabsContent value="simulador">
          <CommissionSimTab sellers={sellers} />
        </TabsContent>
        <TabsContent value="equipe">
          <div className="mb-5 kpi-grid">
            {ranked.slice(0, 3).map((s, i) => (
              <KpiCard
                key={s.id}
                label={`${i + 1}º ${s.name}`}
                value={formatBRL(s.month_revenue)}
                hint={`Comissão ${formatBRL(s.month_commission)}`}
              />
            ))}
            <KpiCard
              label="A pagar (líquido)"
              value={formatBRL(pendingNet)}
              tone={pendingNet > 0 ? "warning" : "default"}
              hint={pendingTotal !== pendingNet ? `bruto ${formatBRL(pendingTotal)}` : undefined}
            />
          </div>
          <DataTable
            headers={
              <tr>
                <Th>Vendedor</Th>
                <Th>Contato</Th>
                <Th>Regime</Th>
                <Th>% padrão</Th>
                <Th>Faturamento no mês</Th>
                <Th>Bruto</Th>
                <Th>Pendente líq.</Th>
                <Th></Th>
              </tr>
            }
          >
            {ranked.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <Td className="font-medium">
                  <span>{s.name}</span>
                  {s.document ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{formatDoc(s.document)}</span>
                  ) : null}
                </Td>
                <Td>{s.phone ?? s.email ?? "—"}</Td>
                <Td>
                  <p>{TAX_REGIME_LABELS[(s.tax_regime as TaxRegime) || "none"] ?? s.tax_regime}</p>
                  <p className="text-xs text-muted-foreground">
                    {issSellerHint(s.tax_regime, s.iss_rate, companyIss)}
                  </p>
                </Td>
                <Td className="tabular">{s.commission_pct}%</Td>
                <Td className="tabular">{formatBRL(s.month_revenue)}</Td>
                <Td className="tabular">{formatBRL(s.month_commission)}</Td>
                <Td className="tabular">{formatBRL(s.pending_net ?? s.pending_commission)}</Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1">
                    {s.pending_commission > 0.009 ? (
                      <Button size="sm" onClick={() => void payAll(s.id)}>
                        Pagar
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => startSeller(s)}>
                      Editar
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        </TabsContent>
        <TabsContent value="pagamentos">
          <div className="mb-3 flex flex-wrap gap-2">
            <Select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="max-w-xs">
              <option value="">Todos os vendedores</option>
              {sellers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
              <option value="">Todas</option>
              <option value="pendente">Pendentes</option>
              <option value="pago">Pagas</option>
              <option value="cancelado">Canceladas</option>
            </Select>
            {statusFilter === "pendente" || statusFilter === "" ? (
              <Button variant="outline" onClick={() => void payAll()}>
                Pagar pendentes
              </Button>
            ) : null}
          </div>
          <DataTable
            headers={
              <tr>
                <Th>Vendedor</Th>
                <Th>Venda</Th>
                <Th>Regra</Th>
                <Th>Bruto</Th>
                <Th>Líquido</Th>
                <Th>Status</Th>
                <Th>Data</Th>
                <Th></Th>
              </tr>
            }
          >
            {(commissions.data ?? []).map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <Td>{c.sellerName}</Td>
                <Td>{c.saleNumber != null ? `nº ${c.saleNumber}` : "—"}</Td>
                <Td>{c.ruleName ?? c.note ?? "Padrão"}</Td>
                <Td className="tabular">{formatBRL(c.amount)}</Td>
                <Td className="tabular">
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setTaxOpen(c.id)}>
                    {formatBRL(c.net)}
                  </button>
                </Td>
                <Td>
                  <Badge variant={statusBadgeVariant(c.status)}>
                    {ACCOUNT_STATUS_LABELS[c.status] ?? c.status}
                  </Badge>
                </Td>
                <Td>{formatDateTime(c.createdAt)}</Td>
                <Td>
                  {c.status === "pendente" ? (
                    <Button size="sm" variant="outline" onClick={() => void pay(c.id)}>
                      Pagar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const slip = previewSlip(c.id);
                        if (slip) setSlips([slip]);
                      }}
                    >
                      Recibo
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        </TabsContent>
        <TabsContent value="retencoes">
          {guide.data ? (
            <RetentionGuide data={guide.data} issRate={companyIss} withholdIss={companyWithhold} />
          ) : guide.isPending ? (
            <PageSkeleton />
          ) : (
            <p className="text-sm text-muted-foreground">Não foi possível montar a guia deste mês.</p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar vendedor" : "Novo vendedor"}</DialogTitle>
          </DialogHeader>
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={sellerDocKind(form.taxRegime) === "cnpj" ? "CNPJ" : "CPF"} className="mt-block">
            <Input
              value={form.document}
              inputMode="numeric"
              placeholder={sellerDocKind(form.taxRegime) === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"}
              onChange={(e) =>
                setForm({
                  ...form,
                  document:
                    sellerDocKind(form.taxRegime) === "cnpj" ? maskCnpj(e.target.value) : e.target.value,
                })
              }
            />
          </Field>
          <Field label="E-mail" className="mt-block">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Telefone" className="mt-block">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="% comissão padrão" className="mt-block">
            <Input
              type="number"
              step="0.1"
              value={form.commissionPct}
              onChange={(e) => setForm({ ...form, commissionPct: Number(e.target.value) })}
            />
          </Field>
          <p className="mt-2 text-xs text-muted-foreground">
            Usado quando nenhuma regra de produto, categoria ou pagamento se aplica. O CPF entra no RPA.
          </p>
          <Field label="Regime tributário" className="mt-block">
            <Select value={form.taxRegime} onChange={(e) => setForm({ ...form, taxRegime: e.target.value })}>
              {TAX_REGIMES.map((k) => (
                <option key={k} value={k}>
                  {TAX_REGIME_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          {form.taxRegime === "clt" ? (
            <Field label="Salário mensal (CLT)" className="mt-block">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.monthlySalary}
                onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })}
              />
            </Field>
          ) : null}
          {form.taxRegime === "clt" || form.taxRegime === "autonomo" ? (
            <Field label="Dependentes (IRRF)" className="mt-block">
              <Input
                type="number"
                min="0"
                step="1"
                value={form.dependents}
                onChange={(e) => setForm({ ...form, dependents: e.target.value })}
              />
            </Field>
          ) : null}
          {form.taxRegime === "autonomo" || form.taxRegime === "pj" ? (
            <IssRateField
              className="mt-block"
              label="ISS deste vendedor (%)"
              value={form.issRate}
              onChange={(v) => setForm({ ...form, issRate: v })}
              allowEmpty
              companyRate={companyIss}
              placeholder={`Padrão da loja (${companyIss}%)`}
            />
          ) : null}
          {form.taxRegime === "mei" ? (
            <div className="mt-block space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <NativeCheckbox
                  className="mt-0.5"
                  checked={form.issRate !== ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      issRate: e.target.checked ? String(companyIss) : "",
                    })
                  }
                />
                <span>
                  Reter ISS neste MEI
                  <span className="mt-0.5 block text-xs text-muted-foreground">{MEI_ISS_NOTE}</span>
                </span>
              </label>
              {form.issRate !== "" ? (
                <IssRateField
                  label="Alíquota deste MEI (%)"
                  value={form.issRate}
                  onChange={(v) => setForm({ ...form, issRate: v === "" ? String(companyIss) : v })}
                  companyRate={companyIss}
                />
              ) : null}
            </div>
          ) : null}
          <Button
            className="mt-4"
            onClick={async () => {
              try {
                parseBrDocument(form.document, sellerDocKind(form.taxRegime));
                await saveSellerFn({
                data: {
                  id: form.id,
                  name: form.name,
                  email: form.email,
                  phone: form.phone,
                  document: form.document,
                  commissionPct: form.commissionPct,
                  taxRegime: form.taxRegime,
                  monthlySalary: Number(form.monthlySalary) || 0,
                  dependents: Number(form.dependents) || 0,
                  issRate: form.issRate === "" ? null : clampIss(form.issRate),
                },
              });
              toast.success(form.id ? "Vendedor atualizado." : "Vendedor salvo.");
              setOpen(false);
              void qc.invalidateQueries({ queryKey: ["sellers"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha");
              }
            }}
          >
            Salvar
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={taxOpen != null} onOpenChange={() => setTaxOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comissão líquida</DialogTitle>
          </DialogHeader>
          {(() => {
            const c = (commissions.data ?? []).find((row) => row.id === taxOpen);
            if (!c) return null;
            const tax = parseTaxBreakdown(c.taxBreakdown, {
              amount: c.amount,
              net: c.net,
              inss: c.taxInss,
              irrf: c.taxIrrf,
              iss: c.taxIss,
              other: c.taxOther,
            });
            return (
              <div>
                <TaxBreakdown tax={tax} />
                <Button
                  className="mt-block"
                  variant="outline"
                  onClick={() => {
                    const slip = previewSlip(c.id);
                    if (slip) {
                      setTaxOpen(null);
                      setSlips([slip]);
                    }
                  }}
                >
                  Imprimir recibo
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={slips != null} onOpenChange={(v) => !v && setSlips(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{slips && slips.length > 1 ? "Recibos de comissão" : "Recibo de comissão"}</DialogTitle>
          </DialogHeader>
          {slips?.map((data, i) => (
            <CommissionSlip key={`${data.sellerName}-${i}`} data={data} onClose={() => setSlips(null)} />
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
