import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The `dark` class on `<html>` is the source of truth — the inline script in
 * `__root.tsx` already applies it from localStorage before hydration.
 *
 * Reading it through a shared store (instead of per-instance `useState`) is
 * what lets more than one consumer exist: the toggle in the header and the
 * `<Toaster>` theme in `__root` both re-render off the same value, so toasts
 * can't render light-on-dark.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "light");

  function toggle() {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    localStorage.setItem("gc-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    for (const l of listeners) l();
  }

  return { theme, toggle };
}
