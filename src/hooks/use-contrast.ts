import { useEffect, useSyncExternalStore } from "react";
import { applyContrastClass, CONTRAST_STORAGE_KEY } from "@/lib/contrast";

const listeners = new Set<() => void>();

function osPrefers(): boolean {
  return window.matchMedia("(prefers-contrast: more)").matches;
}

function readContrast(): boolean {
  return document.documentElement.classList.contains("contrast");
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify() {
  for (const l of listeners) l();
}

function applyFromStorage() {
  applyContrastClass(
    document.documentElement,
    localStorage.getItem(CONTRAST_STORAGE_KEY),
    osPrefers(),
  );
  notify();
}

export function useContrast() {
  const contrast = useSyncExternalStore(subscribe, readContrast, (): boolean => false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-contrast: more)");
    const onChange = () => {
      if (localStorage.getItem(CONTRAST_STORAGE_KEY) == null) applyFromStorage();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next = !readContrast();
    localStorage.setItem(CONTRAST_STORAGE_KEY, next ? "on" : "off");
    document.documentElement.classList.toggle("contrast", next);
    notify();
  }

  return { contrast, toggle };
}
