import type { ViewTransitionOptions } from "@tanstack/router-core";

let lastNavWasPop = false;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    lastNavWasPop = true;
  });
}

type NavEntry = { index: number };
type NavTransition = { from: NavEntry | null };
type NavigationApi = {
  currentEntry: NavEntry | null;
  transition: NavTransition | null;
};

function getNavigation(): NavigationApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { navigation?: NavigationApi }).navigation;
}

export function navigationWasBack(): boolean {
  const nav = getNavigation();
  const from = nav?.transition?.from;
  const current = nav?.currentEntry;
  if (from && current) {
    lastNavWasPop = false;
    return current.index < from.index;
  }
  if (lastNavWasPop) {
    lastNavWasPop = false;
    return true;
  }
  return false;
}

export function resolveViewTransitionTypes(opts: {
  fromPath: string;
  toPath: string;
  pathChanged: boolean;
  isBack: boolean;
  reducedMotion: boolean;
}): string[] | false {
  if (!opts.pathChanged || opts.reducedMotion) return false;
  if (opts.fromPath.startsWith("/app/pdv") || opts.toPath.startsWith("/app/pdv")) return false;
  return opts.isBack ? ["back"] : ["forward"];
}

/**
 * Same-document View Transitions for TanStack Router.
 * Types drive CSS (`forward` / `back`). PDV and reduced-motion skip.
 */
export const viewTransitionTypes: ViewTransitionOptions["types"] = ({
  fromLocation,
  toLocation,
  pathChanged,
}) => {
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isBack = navigationWasBack();
  return resolveViewTransitionTypes({
    fromPath: fromLocation?.pathname ?? "",
    toPath: toLocation.pathname,
    pathChanged,
    isBack,
    reducedMotion,
  });
};
