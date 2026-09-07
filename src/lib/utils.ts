import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function num(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function str(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function nullableStr(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.slice(0, 10);
}

export function bool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "G";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function nextCounterSql() {
  return `
    insert into company_counters (company_id, key, value)
    values ($1, $2, 1)
    on conflict (company_id, key)
    do update set value = company_counters.value + 1
    returning value
  `;
}
