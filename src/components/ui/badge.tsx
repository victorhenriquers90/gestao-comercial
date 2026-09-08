import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary",
        muted: "bg-muted text-muted-foreground",
        success: "bg-success/12 text-success",
        warning: "bg-warning/12 text-warning",
        danger: "bg-destructive/12 text-destructive",
        info: "bg-info/12 text-info",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function statusBadgeVariant(status: string): VariantProps<typeof badgeVariants>["variant"] {
  const s = status.toLowerCase();
  if (["pago", "recebido", "finalizada", "ativa", "open", "venda", "autorizado"].includes(s)) return "success";
  if (["pendente", "parcial", "orcamento", "pedido", "enviado", "processando_autorizacao"].includes(s)) return "warning";
  if (["cancelado", "cancelada", "vencido", "perdido", "erro", "erro_autorizacao"].includes(s)) return "danger";
  return "muted";
}
