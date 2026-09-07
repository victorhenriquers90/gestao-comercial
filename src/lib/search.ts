/** Prefix for btree `text_pattern_ops` (`LIKE 'cami%'`). */
export function prefixLike(raw: string): string {
  return `${raw.trim().toLowerCase()}%`;
}

/**
 * Prefix FTS query (`camiseta:* & azul:*`) for GIN `to_tsvector('simple', …)`.
 * `pg_trgm` is created on Neon (GIN `gin_trgm_ops`); the preview Postgres
 * skips it. ILIKE '%x%' uses trgm there; here FTS + prefix LIKE still apply.
 */
export function ftsPrefix(raw: string): string {
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((w) => w.length >= 2)
    .map((w) => `${w}:*`);
  return parts.length ? parts.join(" & ") : "__none__:*";
}
