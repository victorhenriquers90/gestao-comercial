import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataTable, EmptyState, KpiCard, PageHeader, PageSkeleton, Td, Th } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useSelection } from "@/hooks/use-selection";
import { chartTooltip } from "@/lib/chart";
import { formatBRL, formatDate, formatDateTime, formatPct, formatQty } from "@/lib/format";
import { PERIOD_OPTIONS, resolvePeriod, type PeriodKey } from "@/lib/period";
import { listSellersFn } from "@/lib/server/party";
import { reportFn, type ColKind } from "@/lib/server/reports";
import { getTenantFn } from "@/lib/server/session";
import { cn, num } from "@/lib/utils";

export const Route = createFileRoute("/app/relatorios")({ component: RelatoriosPage });

const GROUPS: { label: string; items: { id: string; label: string }[] }[] = [
  {
    label: "Comercial",
    items: [
      { id: "resumo", label: "Resumo executivo" },
      { id: "vendas", label: "Vendas" },
      { id: "vendedor", label: "Por vendedor" },
      { id: "produto", label: "Mix de produtos" },
      { id: "mais", label: "Mais vendidos" },
      { id: "menos", label: "Menos vendidos" },
      { id: "abc", label: "Curva ABC" },
      { id: "categoria", label: "Por categoria" },
      { id: "cliente", label: "Por cliente" },
      { id: "pagamento", label: "Pagamentos" },
    ],
  },
  {
    label: "Resultado",
    items: [
      { id: "lucro", label: "Lucro e margem" },
      { id: "dre", label: "DRE" },
      { id: "comissao", label: "Comissões" },
      { id: "retencoes", label: "Retenções" },
    ],
  },
  {
    label: "Estoque",
    items: [
      { id: "estoque", label: "Posição" },
      { id: "minimo", label: "Abaixo do mínimo" },
      { id: "giro", label: "Giro" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { id: "receber", label: "A receber" },
      { id: "pagar", label: "A pagar" },
      { id: "aging", label: "Aging" },
    ],
  },
];

const ALL_TYPES = GROUPS.flatMap((g) => g.items);
const NO_FOOTER = new Set(["dre", "giro"]);
const SNAPSHOT = new Set(["estoque", "minimo", "aging"]);

function formatCell(value: string | number, kind: ColKind): string {
  if (kind === "money") return formatBRL(value);
  if (kind === "qty") return formatQty(value);
  if (kind === "pct") return formatPct(value);
  if (kind === "date") {
    const s = String(value);
    return s.includes("T") ? formatDateTime(s) : formatDate(s);
  }
  return String(value);
}

function csvCell(value: string | number, kind: ColKind): string {
  if (kind === "money" || kind === "qty" || kind === "pct") {
    return String(num(value)).replace(".", ",");
  }
  const s = kind === "date" ? formatCell(value, kind) : String(value);
  const escaped = s.replaceAll('"', '""');
  return escaped.includes(";") || escaped.includes("\n") ? `"${escaped}"` : escaped.replaceAll(";", ",");
}

function RelatoriosPage() {
  const storeId = useSelection((s) => s.storeId);
  const sellerId = useSelection((s) => s.sellerId);
  const setSellerId = useSelection((s) => s.setSellerId);
  const [type, setType] = useState("resumo");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [from, setFrom] = useState(() => resolvePeriod("month").from);
  const [to, setTo] = useState(() => resolvePeriod("month").to);

  const range = resolvePeriod(period, from, to);
  const current = ALL_TYPES.find((t) => t.id === type);
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => getTenantFn() });
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => listSellersFn() });
  const report = useQuery({
    queryKey: ["report", type, range.from, range.to, storeId, sellerId],
    queryFn: () =>
      reportFn({
        data: {
          type,
          from: range.from,
          to: range.to,
          storeId: storeId ?? undefined,
          sellerId: sellerId ?? undefined,
        },
      }),
  });

  const csv = useMemo(() => {
    if (!report.data) return "";
    const kinds = report.data.kinds;
    const lines = [report.data.columns.join(";")];
    for (const row of report.data.rows) {
      lines.push(row.map((c, i) => csvCell(c, kinds[i] ?? "text")).join(";"));
    }
    return lines.join("\n");
  }, [report.data]);

  function pickPeriod(key: PeriodKey) {
    setPeriod(key);
    if (key !== "custom") {
      const r = resolvePeriod(key);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function exportCsv() {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-${type}-${range.from}-${range.to}.csv`;
    a.click();
  }

  const storeName =
    tenant.data?.stores.find((s) => s.id === storeId)?.name ??
    (storeId ? "Loja" : "Todas as lojas");
  const sellerName =
    (sellers.data ?? []).find((s) => s.id === sellerId)?.name ??
    (sellerId ? "Vendedor" : "Todos os vendedores");

  return (
    <div className="report-sheet">
      <div className="no-print">
        <PageHeader
          title="Relatórios gerenciais"
          description="Resumo, ABC, DRE, giro, aging e demais visões da operação."
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer />
                Imprimir / PDF
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={!report.data}>
                <FileSpreadsheet />
                Excel
              </Button>
            </div>
          }
        />

        <Card className="mb-4">
          <CardContent className="space-y-4 p-4">
            {GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setType(item.id)}
                      className={cn(
                        "h-9 rounded-md px-3 text-sm font-medium transition-colors",
                        type === item.id
                          ? "bg-primary text-primary-foreground shadow-soft"
                          : "border border-border bg-card text-foreground hover:bg-muted",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => pickPeriod(o.value)}
                className={cn(
                  "h-9 rounded-md px-3 text-sm font-medium transition-colors",
                  period === o.value
                    ? "bg-foreground text-background"
                    : "border border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              type="date"
              value={range.from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPeriod("custom");
              }}
              className="w-40"
            />
            <Input
              type="date"
              value={range.to}
              onChange={(e) => {
                setTo(e.target.value);
                setPeriod("custom");
              }}
              className="w-40"
            />
            <Select
              value={sellerId ?? ""}
              onChange={(e) => setSellerId(e.target.value ? Number(e.target.value) : null)}
              className="w-auto min-w-48"
            >
              <option value="">Todos os vendedores</option>
              {(sellers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {SNAPSHOT.has(type) ? (
          <p className="mb-4 text-xs text-muted-foreground">
            Esta visão é um recorte atual (posição / títulos em aberto), independente do período.
          </p>
        ) : null}
      </div>

      <div className="mb-4 hidden print:block">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Gestão Comercial</p>
        <h1 className="font-display text-2xl font-medium">{report.data?.title ?? current?.label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tenant.data?.companyName} · {storeName} · {sellerName}
          <br />
          {formatDate(range.from)} a {formatDate(range.to)}
        </p>
      </div>

      {report.isPending ? (
        <PageSkeleton cards={4} />
      ) : report.error ? (
        <p className="text-sm text-destructive">
          {report.error instanceof Error ? report.error.message : "Erro ao gerar o relatório."}
        </p>
      ) : report.data ? (
        <ReportBody type={type} pack={report.data} />
      ) : null}
    </div>
  );
}

function ReportBody({
  type,
  pack,
}: {
  type: string;
  pack: {
    title: string;
    columns: string[];
    rows: (string | number)[][];
    kinds: ColKind[];
    kpis: { label: string; value: string; hint?: string }[];
    chart: { kind: "bar" | "line" | "area"; data: { name: string; value: number }[] } | null;
  };
}) {
  const { columns, rows, kinds, kpis, chart, title } = pack;
  const showFooter = !NO_FOOTER.has(type) && rows.length > 1;

  return (
    <div>
      <h2 className="mb-4 font-display text-xl font-medium tracking-tight print:hidden">{title}</h2>

      {kpis.length > 0 ? (
        <div className="kpi-grid">
          {kpis.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} />
          ))}
        </div>
      ) : null}

      {chart && chart.data.length > 0 ? (
        <Card className="mt-5 print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Visão gráfica</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ReportChartView chart={chart} />
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-5">
        {rows.length === 0 ? (
          <EmptyState title="Sem dados no período" description="Ajuste o intervalo, a loja ou o vendedor." />
        ) : (
          <DataTable
            headers={
              <tr>
                {columns.map((c, i) => (
                  <Th
                    key={c}
                    className={
                      kinds[i] === "money" || kinds[i] === "qty" || kinds[i] === "pct"
                        ? "text-right"
                        : undefined
                    }
                  >
                    {c}
                  </Th>
                ))}
              </tr>
            }
          >
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {row.map((cell, j) => {
                  const kind = kinds[j] ?? "text";
                  const numeric = kind === "money" || kind === "qty" || kind === "pct";
                  const negative = numeric && num(cell) < 0;
                  const klass = String(cell);
                  if (type === "abc" && j === 5) {
                    return (
                      <Td key={j}>
                        <Badge
                          variant={klass === "A" ? "success" : klass === "B" ? "warning" : "muted"}
                        >
                          Classe {klass}
                        </Badge>
                      </Td>
                    );
                  }
                  return (
                    <Td
                      key={j}
                      className={cn(
                        numeric && "text-right tabular",
                        negative && "text-destructive",
                        type === "dre" && i === rows.length - 1 && "font-medium",
                      )}
                    >
                      {formatCell(cell, kind)}
                    </Td>
                  );
                })}
              </tr>
            ))}
            {showFooter ? (
              <tr className="border-t border-border bg-muted/40 font-medium">
                {columns.map((_, j) => {
                  const kind = kinds[j] ?? "text";
                  if (j === 0) return <Td key={j}>Total</Td>;
                  if (kind === "money" || kind === "qty") {
                    const s = rows.reduce((a, r) => a + num(r[j]), 0);
                    return (
                      <Td key={j} className="text-right tabular">
                        {formatCell(s, kind)}
                      </Td>
                    );
                  }
                  return <Td key={j} />;
                })}
              </tr>
            ) : null}
          </DataTable>
        )}
      </div>
    </div>
  );
}

function ReportChartView({
  chart,
}: {
  chart: { kind: "bar" | "line" | "area"; data: { name: string; value: number }[] };
}) {
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
      <YAxis
        tick={{ fontSize: 11 }}
        stroke="var(--color-muted-foreground)"
        tickFormatter={(v: number) =>
          Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
        }
      />
      <Tooltip {...chartTooltip} formatter={(v: number) => formatBRL(v)} />
    </>
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      {chart.kind === "bar" ? (
        <BarChart data={chart.data}>
          {axis}
          <Bar dataKey="value" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
        </BarChart>
      ) : chart.kind === "line" ? (
        <LineChart data={chart.data}>
          {axis}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      ) : (
        <AreaChart data={chart.data}>
          {axis}
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-chart-1)"
            fill="var(--color-chart-1)"
            fillOpacity={0.15}
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
