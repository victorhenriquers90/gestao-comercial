import { Printer } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DataTable, KpiCard, Td, Th } from "@/components/shared";
import { formatBRL, formatDate, formatDoc } from "@/lib/format";
import { ISS_DEFAULT, TAX_TABLE_NOTE } from "@/lib/tax";
import type { RetentionGuidePack } from "@/lib/server/retention";

export function RetentionGuide({
  data,
  showPrint = true,
  issRate,
  withholdIss,
}: {
  data: RetentionGuidePack;
  showPrint?: boolean;
  issRate?: number;
  withholdIss?: boolean;
}) {
  const t = data.totals;
  const city = [data.companyCity, data.companyState].filter(Boolean).join(" / ");
  const rate = issRate ?? ISS_DEFAULT;

  return (
    <div className="report-sheet">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        {issRate != null ? (
          <Link
            to="/app/configuracoes"
            search={{ tab: "impostos" } as never}
            className="text-sm text-primary hover:underline"
          >
            Alíquota ISS da loja {rate}%
            {withholdIss === false ? " · retenção desligada" : ""}
          </Link>
        ) : (
          <span />
        )}
        {showPrint ? (
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            Imprimir guia
          </Button>
        ) : null}
      </div>

      <article className="rounded-xl border border-border bg-card p-5">
        <header className="mb-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Guia de retenções · comissões pagas
          </p>
          <h2 className="mt-1 font-display text-xl font-medium tracking-tight">{data.companyName || "Empresa"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.companyDocument ? `CNPJ ${formatDoc(data.companyDocument)}` : "Sem CNPJ"}
            {city ? ` · ${city}` : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(data.from)} a {formatDate(data.to)}
          </p>
        </header>

        <div className="mb-5 kpi-grid">
          <KpiCard label="Folha líquida" value={formatBRL(t.net)} tone="success" />
          <KpiCard
            label="Retido na fonte"
            value={formatBRL(t.withheld)}
            tone={t.withheld > 0 ? "warning" : "default"}
            hint="INSS + IRRF + ISS + PIS/COFINS/CSLL"
          />
          <KpiCard
            label="GPS (INSS)"
            value={formatBRL(t.gps)}
            hint={t.employerInss > 0 ? `segurado ${formatBRL(t.inss)} + patronal ${formatBRL(t.employerInss)}` : undefined}
          />
          <KpiCard
            label="Custo da loja"
            value={formatBRL(t.cost)}
            hint={t.employerFgts > 0 ? `inclui FGTS ${formatBRL(t.employerFgts)}` : undefined}
          />
        </div>

        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma comissão paga neste período. Pague a equipe em Pagamentos para montar a guia.
          </p>
        ) : (
          <DataTable
            headers={
              <tr>
                <Th>Vendedor</Th>
                <Th>Regime</Th>
                <Th>Bruto</Th>
                <Th>INSS</Th>
                <Th>IRRF</Th>
                <Th>ISS</Th>
                <Th>Outros</Th>
                <Th>Líquido</Th>
                <Th>Patronal</Th>
                <Th>FGTS</Th>
              </tr>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.sellerId} className="border-b border-border last:border-0">
                <Td>
                  <p className="font-medium">{r.sellerName}</p>
                  <p className="text-xs text-muted-foreground">{r.document ? formatDoc(r.document) : "sem CPF"}</p>
                </Td>
                <Td>{r.regimeLabel}</Td>
                <Td className="tabular">{formatBRL(r.gross)}</Td>
                <Td className="tabular">{formatBRL(r.inss)}</Td>
                <Td className="tabular">{formatBRL(r.irrf)}</Td>
                <Td className="tabular">{formatBRL(r.iss)}</Td>
                <Td className="tabular">{formatBRL(r.other)}</Td>
                <Td className="tabular font-medium">{formatBRL(r.net)}</Td>
                <Td className="tabular">{formatBRL(r.employerInss)}</Td>
                <Td className="tabular">{formatBRL(r.employerFgts)}</Td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <Td>Totais</Td>
              <Td></Td>
              <Td className="tabular">{formatBRL(t.gross)}</Td>
              <Td className="tabular">{formatBRL(t.inss)}</Td>
              <Td className="tabular">{formatBRL(t.irrf)}</Td>
              <Td className="tabular">{formatBRL(t.iss)}</Td>
              <Td className="tabular">{formatBRL(t.other)}</Td>
              <Td className="tabular">{formatBRL(t.net)}</Td>
              <Td className="tabular">{formatBRL(t.employerInss)}</Td>
              <Td className="tabular">{formatBRL(t.employerFgts)}</Td>
            </tr>
          </DataTable>
        )}

        <div className="mt-5 grid gap-2 border-t border-border pt-4 text-sm">
          <p className="font-medium">A recolher neste período</p>
          <p className="flex justify-between gap-4">
            <span>INSS GPS (segurado + patronal 20%)</span>
            <span className="tabular">{formatBRL(t.gps)}</span>
          </p>
          {t.irrf > 0.009 ? (
            <p className="flex justify-between gap-4">
              <span>IRRF</span>
              <span className="tabular">{formatBRL(t.irrf)}</span>
            </p>
          ) : null}
          {t.iss > 0.009 ? (
            <p className="flex justify-between gap-4">
              <span>ISS municipal</span>
              <span className="tabular">{formatBRL(t.iss)}</span>
            </p>
          ) : null}
          {t.other > 0.009 ? (
            <p className="flex justify-between gap-4">
              <span>PIS / COFINS / CSLL</span>
              <span className="tabular">{formatBRL(t.other)}</span>
            </p>
          ) : null}
          {t.employerFgts > 0.009 ? (
            <p className="flex justify-between gap-4">
              <span>FGTS 8%</span>
              <span className="tabular">{formatBRL(t.employerFgts)}</span>
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-[11px] leading-snug text-muted-foreground">{TAX_TABLE_NOTE}</p>
      </article>
    </div>
  );
}
