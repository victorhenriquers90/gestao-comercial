const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TAG = /<\/?[a-zA-Z][^>]{0,200}>/g;
const JS_URL = /^(javascript|vbscript|data):/i;

export function sanitizeLine(raw: unknown, max = 200): string {
  return String(raw ?? "")
    .replace(CTRL, "")
    .replace(/\s+/g, " ")
    .replace(TAG, "")
    .trim()
    .slice(0, max);
}

export function sanitizeMultiline(raw: unknown, max = 4000): string | null {
  const s = String(raw ?? "")
    .replace(CTRL, "")
    .replace(/\r\n/g, "\n")
    .replace(TAG, "")
    .trim()
    .slice(0, max);
  return s || null;
}

export function optionalLine(raw: unknown, max = 200): string | null {
  const s = sanitizeLine(raw, max);
  return s || null;
}

export function requireLine(raw: unknown, label: string, max = 180): string {
  const s = sanitizeLine(raw, max);
  if (!s) throw new Error(`${label} obrigatório.`);
  return s;
}

export function requireMultiline(raw: unknown, label: string, max = 4000): string {
  const s = sanitizeMultiline(raw, max);
  if (!s) throw new Error(`${label} obrigatória.`);
  return s;
}

/** Barcode / SKU / document: printable, no tags, no spaces-only. */
export function sanitizeCode(raw: unknown, max = 64): string | null {
  const s = String(raw ?? "")
    .replace(CTRL, "")
    .replace(TAG, "")
    .trim()
    .slice(0, max);
  return s || null;
}

/** http(s) or same-origin path. Rejects javascript:/data:. */
export function sanitizeHttpUrl(raw: unknown, max = 2000): string | null {
  const s = String(raw ?? "").replace(CTRL, "").trim().slice(0, max);
  if (!s) return null;
  if (JS_URL.test(s) || s.startsWith("//")) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
