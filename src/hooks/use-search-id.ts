import { useLocation } from "@tanstack/react-router";

/** Reads `?name=` from the current URL, whether the route validates search or not. */
export function useSearchParam(name: string): string | null {
  const loc = useLocation();
  const fromObj = (loc.search as Record<string, unknown>)[name];
  const fromStr = new URLSearchParams(loc.searchStr.replace(/^\?/, "")).get(name);
  const raw = fromObj ?? fromStr;
  return raw == null || raw === "" ? null : String(raw);
}

/** Reads `?id=` from the current URL, whether the route validates search or not. */
export function useSearchId(): number | null {
  const n = Number(useSearchParam("id"));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}
