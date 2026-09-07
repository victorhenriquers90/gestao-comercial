import { allSameDigit, mod11Digit, onlyDigits } from "./check-digit.ts";

export { onlyDigits } from "./check-digit.ts";

export function isValidCpf(raw: string | null | undefined): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11 || allSameDigit(d)) return false;
  const n = [...d].map(Number);
  const d1 = mod11Digit(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== n[9]) return false;
  const d2 = mod11Digit(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === n[10];
}

export function isValidCnpj(raw: string | null | undefined): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14 || allSameDigit(d)) return false;
  const n = [...d].map(Number);
  const d1 = mod11Digit(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== n[12]) return false;
  const d2 = mod11Digit(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === n[13];
}

export type DocKind = "cpf" | "cnpj" | "any";

/** Empty stays empty. Filled values must pass the algorithm; stored as digits. */
export function parseBrDocument(raw: string | null | undefined, kind: DocKind): string | null {
  const d = onlyDigits(raw);
  if (!d) return null;
  if (kind === "cpf") {
    if (!isValidCpf(d)) throw new Error("CPF inválido.");
    return d;
  }
  if (kind === "cnpj") {
    if (d.length !== 14) throw new Error("CNPJ deve ter 14 dígitos.");
    if (!isValidCnpj(d)) throw new Error("CNPJ inválido.");
    return d;
  }
  if (d.length <= 11) {
    if (!isValidCpf(d)) throw new Error("CPF inválido.");
    return d;
  }
  if (!isValidCnpj(d)) throw new Error("CNPJ inválido.");
  return d;
}

export function parseCnpj(raw: string | null | undefined): string | null {
  return parseBrDocument(raw, "cnpj");
}

/** Live mask `00.000.000/0000-00` while typing. */
export function maskCnpj(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Live mask `000.000.000-00` while typing. */
export function maskCpf(raw: string): string {
  const d = onlyDigits(raw).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CPF while ≤11 digits, then CNPJ mask. */
export function maskBrDoc(raw: string): string {
  const d = onlyDigits(raw);
  return d.length > 11 ? maskCnpj(raw) : maskCpf(raw);
}

/** MEI and PJ issue a CNPJ; CLT / autônomo / none use CPF. */
export function sellerDocKind(taxRegime: string | null | undefined): DocKind {
  return taxRegime === "pj" || taxRegime === "mei" ? "cnpj" : "cpf";
}
