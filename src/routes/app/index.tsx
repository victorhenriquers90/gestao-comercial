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
import { KpiCard, PageHeader, PageSkeleton, QueryError } from "@/components/shared";
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
import { cn } from "@/lib/utils";

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
    const firstAllowed = NAV_ITEMS.find((i) => i.href !== "/app" && can(tenant.data!.role, i.perm));
    return <Navigate to={firstAllowed?.href ?? "/login"} />;
  }
  if (dash.isPending) return <PageSkeleton cards={6} />;
  if (dash.error) {
    return <QueryError error={dash.error} fallback="Erro ao carregar o painel." />;
  }
  const d = dash.data!;

  return (
    <div>
      <PageHeader
        title="Painel"
        description={tenant.data?.companyName ?? "Sua loja"}
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
        <div className="dash-hero">
          <div>
            <p className="ed-label">Faturamento hoje</p>
            <p className="dash-hero-value mt-2">{formatBRL(d.todayRevenue)}</p>
            <p className="mt-2 text-sm text-muted-foreground">{d.todaySales} venda(s)</p>
          </div>
          <div>
            <p className="ed-label">Faturamento do mês</p>
            <p className="dash-hero-value mt-2">{formatBRL(d.monthRevenue)}</p>
            <p className="mt-2 text-sm text-muted-foreground">acumulado no calendário</p>
          </div>
        </div>

        <div className="dash-kpis kpi-grid">
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
          <CardContent className="h-full min-h-0 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashSalesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  stroke="transparent"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  stroke="transparent"
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip {...chartTooltip} formatter={(v: number) => formatBRL(v)} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2}
                  fill="url(#dashSalesFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="dash-metas dash-fill">
          <CardHeader>
            <CardTitle>Metas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 overflow-y-auto">
            {d.targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma meta no período.</p>
            ) : (
              d.targets.map((t) => (
                <div key={t.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{t.name}</span>
                    <span className="tabular font-medium">{formatPct(t.progress)}</span>
                  </div>
                  <div className="dash-track mt-2">
                    <span style={{ width: `${Math.min(100, t.progress)}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
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
          <CardContent className="text-sm">
            <DashRow label="Comissões a pagar" value={formatBRL(d.pendingCommissionNet)} strong />
            <DashRow label="Retido no mês" value={formatBRL(d.monthTaxWithheld)} />
            <DashRow label="Encargos (INSS/FGTS)" value={formatBRL(d.monthEmployerCharges)} />
            <DashRow label="Folha paga no mês" value={formatBRL(d.monthCommissionNet)} />
            <div className="mt-3 flex flex-wrap gap-3">
              <Link to="/app/vendedores" className="text-xs text-primary hover:underline">
                Guia de retenções
              </Link>
              <Link
                to="/app/configuracoes"
                search={{ tab: "impostos" } as never}
                className="text-xs text-primary hover:underline"
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
          <CardContent>
            {d.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ainda não há vendas neste período.</p>
            ) : (
              d.topProducts.map((p, i) => (
                <div key={p.name} className="dash-row text-sm">
                  <span className="dash-rank">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
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
          <CardContent>
            {d.topSellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma comissão neste período.</p>
            ) : (
              d.topSellers.map((p, i) => (
                <div key={p.name} className="dash-row text-sm">
                  <span className="dash-rank">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="tabular font-medium">{formatBRL(p.total)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="dash-stock dash-list">
          <CardHeader>
            <CardTitle>Estoque baixo</CardTitle>
          </CardHeader>
          <CardContent>
            {d.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum alerta no momento.</p>
            ) : (
              d.lowStock.map((p) => (
                <div key={p.name + p.store} className="dash-row text-sm">
                  <div className="min-w-0 flex-1">
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
          <CardContent className="h-full min-h-0 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  stroke="transparent"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  stroke="transparent"
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip {...chartTooltip} formatter={(v: number) => formatBRL(v)} />
                <Bar dataKey="total" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="dash-row">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", strong && "font-medium")}>{value}</span>
    </div>
  );
}
