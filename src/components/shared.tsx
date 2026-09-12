import { ArrowDownRight, ArrowUpRight, Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/card";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {description ? <p className="ed-label mb-2">{description}</p> : null}
        <h1 className="font-display text-[clamp(1.65rem,1.2rem+1.4vw,2.15rem)] font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-start justify-center gap-3 border-y border-border py-16">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
        {description ? (
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  trend,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: { value: number; label: string };
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";
  const up = (trend?.value ?? 0) >= 0;
  return (
    <Card className="kpi-card min-w-0 rounded-none border-0 border-b border-border bg-transparent px-1 py-4 shadow-none">
      <p className="ed-label">{label}</p>
      <p className={cn("kpi-value font-display font-semibold tracking-tight tabular", toneClass)}>
        {value}
      </p>
      <p className="min-h-4 text-xs text-muted-foreground">{hint ?? "\u00a0"}</p>
      {trend ? (
        <p
          className={cn(
            "inline-flex items-center gap-1 text-xs tabular",
            up ? "text-success" : "text-destructive",
          )}
        >
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {up ? "+" : ""}
          {trend.value.toFixed(1)}% {trend.label}
        </p>
      ) : (
        <p className="min-h-4 text-xs">{"\u00a0"}</p>
      )}
    </Card>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      {children}
    </div>
  );
}

export function DataTable({
  headers,
  children,
}: {
  headers: ReactNode;
  children: ReactNode;
}) {
  return (
    <TableWrap>
      <table className="data-table w-full min-w-[640px] text-left text-sm print:min-w-0">
        <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur-sm">
          {headers}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableWrap>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("ed-label px-4 py-3 text-left", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function QueryError({ error, fallback }: { error: unknown; fallback: string }) {
  return (
    <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error instanceof Error ? error.message : fallback}
    </p>
  );
}

export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-48" />
      <div className="kpi-grid">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

export function ConfirmBar({
  open,
  title,
  onCancel,
  onConfirm,
  confirmLabel = "Confirmar",
  danger,
}: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4">
      <Card className="w-full max-w-sm rounded-2xl p-6 shadow-pop">
        <p className="font-display text-lg font-medium tracking-tight">{title}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant={danger ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
