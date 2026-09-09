import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard, PageHeader, PageSkeleton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useSelection } from "@/hooks/use-selection";
import { chartTooltip } from "@/lib/chart";
import { formatBRL, formatPct, formatQty } from "@/lib/format";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/period";
import { can } from "@/lib/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { dashboardFn } from "@/lib/server/insight";
import { listSellersFn } from "@/lib/server/party";
import { getTenantFn } from "@/lib/server/session";

export const Route = createFileRoute("/app/")({ component: DashboardPage });

function DashboardPage() {
  const storeId = useSelection((s) => s.storeId);
  const sellerId = useSelection((s) => s.sellerId);
  const setSellerId = useSelection((s) => s.setSellerId);
  const [period, setPeriod] = useState<PeriodKey>("month");
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => listSellersFn() });
  const dash = useQuery({
    queryKey: ["dashboard", period, storeId, sellerId],
    queryFn: () =>
      dashboardFn({
        data: { period, storeId: storeId ?? undefined, sellerId: sellerId ?? undefined },
      }),
  });

  const chart = useMemo(
    () =>
      (dash.data?.series ?? []).map((s) => ({
        ...s,
        label: s.date.slice(8, 10) + "/" + s.date.slice(5, 7),
      })),
    [dash.data],
  );
  const monthly = useMemo(
    () =>
      (dash.data?.monthly ?? []).map((m) => ({
        ...m,
        label: m.month.slice(5),
      })),
    [dash.data],
  );

  if (tenant.data && !can(tenant.data.role, "dashboard.read")) {
    // Papel sem acesso ao painel (ex.: pdv) — manda pra primeira tela que
    // ele realmente pode ver, em vez de cair num erro de permissão no
    // primeiro login.
    const firstAllowed = NAV_ITEMS.find((i) => i.href !== "/app" && can(tenant.data!.role, i.perm));
    return <Navigate to={firstAllowed?.href ?? "/login"} />;
  }
  if (dash.isPending) return <PageSkeleton cards={8} />;
  if (dash.error) {
    return (
      <p className="text-sm text-destructive">
        {dash.error instanceof Error ? dash.error.message : "Erro ao carregar o painel."}
      </p>
    );
  }
  const d = dash.data!;

  return (
    <div>
      <PageHeader
        title="Painel"
        description={`${tenant.data?.companyName ?? "Sua loja"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
              {PERIOD_OPTIONS.filter((o) => o.value !== "custom").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              value={sellerId ?? ""}
              onChange={(e) => setSellerId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Todos os vendedores</option>
              {(sellers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <div className="dash-stage">
      <div className="dash-kpis kpi-grid">
        <KpiCard label="Faturamento hoje" value={formatBRL(d.todayRevenue)} hint={`${d.todaySales} venda(s)`} />
        <KpiCard label="Faturamento do mês" value={formatBRL(d.monthRevenue)} />
        <KpiCard
          label="Faturamento do período"
          value={formatBRL(d.revenue)}
          trend={{ value: d.trend.revenue, label: "vs período anterior" }}
        />
        <KpiCard
          label="Ticket médio"
          value={formatBRL(d.ticket)}
          hint={`${d.salesCount} vendas`}
          trend={{ value: d.trend.ticket, label: "vs anterior" }}
        />
        <KpiCard
          label="Lucro estimado"
          value={formatBRL(d.profit)}
          tone="success"
          trend={{ value: d.trend.profit, label: "vs anterior" }}
        />
        <KpiCard label="Contas a receber" value={formatBRL(d.receivables)} />
        <KpiCard label="Contas a pagar" value={formatBRL(d.payables)} tone="warning" />
        <KpiCard
          label="Saldo financeiro"
          value={formatBRL(d.balance)}
          tone={d.balance >= 0 ? "success" : "danger"}
        />
      </div>

      <Card className="dash-chart dash-fill">
          <CardHeader>
            <CardTitle>Vendas do período</CardTitle>
          </CardHeader>
          <CardContent className="h-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <Tooltip {...chartTooltip} formatter={(v: number) => formatBRL(v)} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--color-chart-1)"
                  fill="var(--color-chart-1)"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="dash-metas dash-fill">
          <CardHeader>
            <CardTitle>Metas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 overflow-y-auto">
            {d.targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma meta no período.</p>
            ) : (
              d.targets.map((t) => (
                <div key={t.id}>
                  <div className="flex justify-between text-sm">
                    <span>{t.name}</span>
                    <span className="tabular">{formatPct(t.progress)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, t.progress)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBRL(t.realized)} de {formatBRL(t.amount)}
                    {t.bonusHint ? ` · ${t.bonusHint}` : ""}
                  </p>
                </div>
              ))
            )}
            <Link to="/app/metas" className="text-xs text-primary hover:underline">
              Gerenciar metas
            </Link>
          </CardContent>
        </Card>

        <Card className="dash-folha dash-list">
          <CardHeader>
            <CardTitle>Folha e retenções</CardTitle>
          </CardHeader>
          <CardContent className="space-y-block text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Comissões a pagar</span>
              <span className="tabular font-medium">{formatBRL(d.pendingCommissionNet)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Retido no mês</span>
              <span className="tabular">{formatBRL(d.monthTaxWithheld)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Encargos (INSS/FGTS)</span>
              <span className="tabular">{formatBRL(d.monthEmployerCharges)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Folha paga no mês</span>
              <span className="tabular">{formatBRL(d.monthCommissionNet)}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/app/vendedores" className="inline-block text-xs text-primary hover:underline">
                Guia de retenções
              </Link>
              <Link
                to="/app/configuracoes"
                search={{ tab: "impostos" } as never}
                className="inline-block text-xs text-primary hover:underline"
              >
                Alíquota de ISS
              </Link>
            </div>
          </CardContent>
        </Card>
        <Card className="dash-products dash-list">
          <CardHeader>
            <CardTitle>Produtos mais vendidos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-block">
            {d.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ainda não há vendas neste período.</p>
            ) : (
              d.topProducts.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{p.name}</span>
                  <span className="tabular text-muted-foreground">
                    {formatQty(p.qty)} · {formatBRL(p.total)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card className="dash-sellers dash-list">
          <CardHeader>
            <CardTitle>Vendedores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-block">
            {d.topSellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma comissão neste período.</p>
            ) : (
              d.topSellers.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{p.name}</span>
                  <span className="tabular">{formatBRL(p.total)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card className="dash-stock dash-list">
          <CardHeader>
            <CardTitle>Estoque baixo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-block">
            {d.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum alerta no momento.</p>
            ) : (
              d.lowStock.map((p) => (
                <div key={p.name + p.store} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.store}</p>
                  </div>
                  <Badge variant="warning">
                    {formatQty(p.quantity)} / {formatQty(p.minStock)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

      <Card className="dash-monthly dash-fill">
        <CardHeader>
          <CardTitle>Evolução mensal</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
              <Tooltip {...chartTooltip} formatter={(v: number) => formatBRL(v)} />
              <Bar dataKey="total" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
