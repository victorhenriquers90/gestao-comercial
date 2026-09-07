import {
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";

export type PeriodKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "month"
  | "last_month"
  | "custom";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "month", label: "Mês atual" },
  { value: "last_month", label: "Mês anterior" },
  { value: "custom", label: "Período personalizado" },
];

export type DateRange = {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
};

function ymd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function resolvePeriod(
  key: PeriodKey,
  customFrom?: string | null,
  customTo?: string | null,
): DateRange {
  const now = new Date();
  let start: Date;
  let end: Date;
  if (key === "today") {
    start = startOfDay(now);
    end = endOfDay(now);
  } else if (key === "yesterday") {
    start = startOfDay(subDays(now, 1));
    end = endOfDay(subDays(now, 1));
  } else if (key === "7d") {
    start = startOfDay(subDays(now, 6));
    end = endOfDay(now);
  } else if (key === "30d") {
    start = startOfDay(subDays(now, 29));
    end = endOfDay(now);
  } else if (key === "last_month") {
    const prev = subMonths(now, 1);
    start = startOfMonth(prev);
    end = endOfMonth(prev);
  } else if (key === "custom" && customFrom && customTo) {
    start = startOfDay(new Date(`${customFrom}T00:00:00`));
    end = endOfDay(new Date(`${customTo}T00:00:00`));
  } else {
    start = startOfMonth(now);
    end = endOfDay(now);
  }
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = endOfDay(subDays(start, 1));
  const prevStart = startOfDay(subDays(start, days));
  return {
    from: ymd(start),
    to: ymd(end),
    prevFrom: ymd(prevStart),
    prevTo: ymd(prevEnd),
  };
}
