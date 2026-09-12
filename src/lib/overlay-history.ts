/**
 * PWA stand-in for Android predictive back / iOS edge-swipe.
 *
 * Native OnBackInvokedCallback is not available in the browser. Chrome and
 * Safari snapshot the previous history entry during a back swipe — so an
 * overlay (sheet, dialog) must be its own history entry. Closing via X or
 * the system gesture then pops that entry and the OS draws the preview.
 */

export type OverlayCloser = () => void;

export class OverlayStack {
  readonly layers: { id: string; close: OverlayCloser }[] = [];
  ignorePop = 0;

  push(id: string, close: OverlayCloser): "push" | "refresh" {
    const existing = this.layers.find((l) => l.id === id);
    if (existing) {
      existing.close = close;
      return "refresh";
    }
    this.layers.push({ id, close });
    return "push";
  }

  has(id: string): boolean {
    return this.layers.some((l) => l.id === id);
  }

  /** Close from the UI (X / overlay click). Caller should `history.back()`. */
  releaseFromUi(id: string): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i === -1) return false;
    this.layers.splice(i, 1);
    this.ignorePop += 1;
    return true;
  }

  /** Drop without touching history (unmount / route change). */
  abandon(id: string): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i === -1) return false;
    this.layers.splice(i, 1);
    return true;
  }

  onPopState(): void {
    if (this.ignorePop > 0) {
      this.ignorePop -= 1;
      return;
    }
    const top = this.layers.pop();
    top?.close();
  }
}

export const overlayStack = new OverlayStack();

let listening = false;

export function ensureOverlayHistory(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => overlayStack.onPopState());
}

export function pushOverlayHistory(id: string, close: OverlayCloser): void {
  ensureOverlayHistory();
  if (typeof window === "undefined") return;
  const action = overlayStack.push(id, close);
  if (action === "push") {
    const prev = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...prev, grokOverlay: id }, "");
  }
}

export function releaseOverlayHistory(id: string): void {
  if (typeof window === "undefined") return;
  if (overlayStack.releaseFromUi(id)) history.back();
}
