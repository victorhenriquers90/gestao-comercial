import {
  differenceInCalendarDays,
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
  // `end` é fim de dia (23:59:59.999), não meia-noite -- dividir a diferença
  // por 86400000 e arredondar já dava a contagem certa de dias, e o "+1"
  // pensado pra fronteiras meia-noite-a-meia-noite somava um dia a mais.
  // "Ontem" (1 dia de verdade) calculava 2, e o período anterior usado no
  // "vs período anterior" do Dashboard saía sempre um dia mais largo do que
  // devia -- inflando o comparativo e mostrando um crescimento menor (ou
  // queda maior) do que o real. `differenceInCalendarDays` compara datas de
  // calendário, não timestamps exatos, então não sofre desse desalinhamento.
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const prevEnd = endOfDay(subDays(start, 1));
  const prevStart = startOfDay(subDays(start, days));
  return {
    from: ymd(start),
    to: ymd(end),
    prevFrom: ymd(prevStart),
    prevTo: ymd(prevEnd),
  };
}
