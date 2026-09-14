export const KEYBOARD_INSET_VAR = "--keyboard-inset";

type ClassTok = { toggle: (name: string, force?: boolean) => unknown };
type StyleTok = { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void };

/** Height of the software keyboard from visualViewport (iOS / browsers without VirtualKeyboard). */
export function insetFromVisualViewport(innerHeight: number, vpHeight: number, vpOffsetTop: number): number {
  return Math.max(0, Math.round(innerHeight - vpHeight - vpOffsetTop));
}

export function applyKeyboardInset(
  root: { classList: ClassTok; style: StyleTok },
  px: number,
): number {
  const inset = Math.max(0, Math.round(px));
  if (inset > 0) {
    root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
    root.classList.toggle("vk-open", true);
  } else {
    root.style.removeProperty(KEYBOARD_INSET_VAR);
    root.classList.toggle("vk-open", false);
  }
  return inset;
}
