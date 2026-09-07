/** Shared check digits: mod-11 (CPF/CNPJ) and GTIN/EAN/UPC (mod-10). */

export function onlyDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function allSameDigit(d: string): boolean {
  return d.length > 0 && /^(\d)\1+$/.test(d);
}

/** Weighted sum mod 11; remainder < 2 → 0 (Receita). */
export function mod11Digit(nums: number[], factors: number[]): number {
  const sum = nums.reduce((acc, n, i) => acc + n * (factors[i] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const GTIN_LEN = new Set([8, 12, 13, 14]);

/** GS1: from the right, odd places ×3, even ×1; check = (10 − sum%10)%10. */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - i;
    const weight = fromRight % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(raw: string | null | undefined): boolean {
  const d = onlyDigits(raw);
  if (!GTIN_LEN.has(d.length) || allSameDigit(d)) return false;
  return gtinCheckDigit(d.slice(0, -1)) === Number(d.at(-1));
}

/**
 * Product barcode: empty ok; alphanumeric SKU kept; 8/12/13/14 digits must
 * pass GTIN. Other numeric lengths stay as internal codes.
 */
export function parseBarcode(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!trimmed) return null;
  const d = onlyDigits(trimmed);
  const compact = trimmed.replace(/[\s-]/g, "");
  if (d.length === compact.length && GTIN_LEN.has(d.length)) {
    if (!isValidGtin(d)) throw new Error("Código de barras inválido (dígito verificador).");
    return d;
  }
  return trimmed.slice(0, 64) || null;
}
