import { useLocation } from "@tanstack/react-router";

/** Reads `?id=` from the current URL, whether the route validates search or not. */
export function useSearchId(): number | null {
  const loc = useLocation();
  const fromObj = (loc.search as { id?: unknown }).id;
  const fromStr = new URLSearchParams(loc.searchStr.replace(/^\?/, "")).get("id");
  const raw = fromObj ?? fromStr;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}
