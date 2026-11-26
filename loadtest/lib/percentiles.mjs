/** Percentil por interpolacao linear (metodo "R-7", o mesmo do numpy default). */
export function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

export function summarize(latenciesMs) {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  }
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[n - 1],
    mean,
  };
}

export function fmtMs(ms) {
  if (Number.isNaN(ms)) return "-";
  return `${ms.toFixed(0)}ms`;
}
