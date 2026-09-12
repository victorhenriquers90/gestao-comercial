export const CONTRAST_STORAGE_KEY = "gc-contrast";

/** `on` / `off` from the user; anything else follows the OS. */
export function shouldUseContrast(stored: string | null, osPrefers: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return osPrefers;
}

export function applyContrastClass(
  root: { classList: { toggle: (name: string, force?: boolean) => unknown } },
  stored: string | null,
  osPrefers: boolean,
): boolean {
  const on = shouldUseContrast(stored, osPrefers);
  root.classList.toggle("contrast", on);
  return on;
}
