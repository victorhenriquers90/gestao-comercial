import { useEffect } from "react";
import { applyKeyboardInset, insetFromVisualViewport } from "@/lib/virtual-keyboard";

type VirtualKeyboardLike = {
  overlaysContent: boolean;
  boundingRect: { height: number };
  addEventListener: (type: "geometrychange", fn: () => void) => void;
  removeEventListener: (type: "geometrychange", fn: () => void) => void;
};

function getVirtualKeyboard(): VirtualKeyboardLike | null {
  const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
  return vk ?? null;
}

/**
 * Android Chrome: VirtualKeyboard API overlays the page and reports height.
 * Elsewhere: visualViewport fallback (iOS Safari has no virtualKeyboard).
 * Only enable on the PDV — overlaysContent would cover dashboard forms.
 */
export function useVirtualKeyboard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const vk = getVirtualKeyboard();

    if (vk) {
      vk.overlaysContent = true;
      const onGeo = () => applyKeyboardInset(root, vk.boundingRect.height);
      vk.addEventListener("geometrychange", onGeo);
      onGeo();
      return () => {
        vk.removeEventListener("geometrychange", onGeo);
        vk.overlaysContent = false;
        applyKeyboardInset(root, 0);
      };
    }

    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () =>
      applyKeyboardInset(root, insetFromVisualViewport(window.innerHeight, vv.height, vv.offsetTop));
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      applyKeyboardInset(root, 0);
    };
  }, [enabled]);
}
