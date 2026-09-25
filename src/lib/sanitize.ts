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

const DATA_IMAGE_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Foto de produto / logo da loja: aceita a data URL que o editor de recorte
 * sempre gera (`canvas.toDataURL()`, em image-edit.ts) OU um link http(s)/
 * mesmo-origem de verdade. `sanitizeHttpUrl` sozinho rejeitava TODO data:
 * de proposito (e correto pra um campo de link generico) -- mas os dois
 * unicos campos que guardam foto neste app (produto e logo) so recebem
 * data: URL dessa tela, nunca um link colado. O resultado, sem isto, era a
 * foto sumir em silencio: sanitizeHttpUrl devolvia null, o produto salvava
 * "com sucesso" e a imagem nunca chegava no banco -- nenhum produto do
 * piloto tinha foto gravada.
 */
export function sanitizeImageUrl(raw: unknown, maxLen = 3_000_000): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("data:")) {
    if (s.length > maxLen) return null;
    return DATA_IMAGE_URL.test(s) ? s : null;
  }
  return sanitizeHttpUrl(s);
}
