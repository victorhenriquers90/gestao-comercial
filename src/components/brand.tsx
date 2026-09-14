import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "inverse";
}) {
  const inverse = tone === "inverse";
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="10" className={inverse ? "fill-primary-foreground/15" : "fill-primary/10"} />
      <rect x="6" y="8" width="14" height="16" rx="3" className={inverse ? "fill-primary-foreground" : "fill-primary"} />
      <rect
        x="12"
        y="12"
        width="14"
        height="12"
        rx="3"
        className={inverse ? "fill-primary-foreground/70" : "fill-primary/70"}
      />
      <rect x="16" y="16" width="6" height="2" rx="1" className={inverse ? "fill-primary" : "fill-primary-foreground"} />
    </svg>
  );
}
