export type Promo = {
  id: number;
  name: string;
  kind: string;
  percent: number | null;
  amount: number | null;
  promoPrice: number | null;
  buyQty: number | null;
  payQty: number | null;
  minQty: number | null;
  productId: number | null;
  categoryId: number | null;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
};

export type PromoHit = { id: number; name: string; discount: number; unitPrice: number };

function ymd(value: string) {
  return value.slice(0, 10);
}

export function isPromoLive(p: Promo, today = new Date().toISOString().slice(0, 10)) {
  if (!p.isActive) return false;
  const start = ymd(p.startsAt);
  const end = ymd(p.endsAt);
  if (start && start > today) return false;
  if (end && end < today) return false;
  return true;
}

export function promoApplies(
  p: Promo,
  productId: number,
  categoryId: number | null,
  parentCategoryId: number | null,
) {
  if (p.productId != null) return p.productId === productId;
  if (p.categoryId != null) return p.categoryId === categoryId || p.categoryId === parentCategoryId;
  return true;
}

export function computePromo(p: Promo, qty: number, unitPrice: number): { discount: number; unitPrice: number } {
  if (p.kind === "percent") {
    const pct = p.percent ?? 0;
    return { unitPrice, discount: Number(((unitPrice * qty * pct) / 100).toFixed(2)) };
  }
  if (p.kind === "fixed") {
    return { unitPrice, discount: Math.min(unitPrice * qty, p.amount ?? 0) };
  }
  if (p.kind === "promo_price" && p.promoPrice != null && p.promoPrice < unitPrice) {
    return {
      unitPrice: p.promoPrice,
      discount: Number(((unitPrice - p.promoPrice) * qty).toFixed(2)),
    };
  }
  if (p.kind === "qty" && p.minQty && qty >= p.minQty) {
    const pct = p.percent ?? 0;
    return { unitPrice, discount: Number(((unitPrice * qty * pct) / 100).toFixed(2)) };
  }
  if (p.kind === "bxgy" && p.buyQty && p.payQty && p.buyQty > p.payQty) {
    const sets = Math.floor(qty / p.buyQty);
    const free = sets * (p.buyQty - p.payQty);
    return { unitPrice, discount: Number((free * unitPrice).toFixed(2)) };
  }
  return { unitPrice, discount: 0 };
}

export function bestPromo(
  promos: Promo[],
  productId: number,
  categoryId: number | null,
  parentCategoryId: number | null,
  qty: number,
  unitPrice: number,
): PromoHit | null {
  let best: PromoHit | null = null;
  for (const p of promos) {
    if (!isPromoLive(p) || !promoApplies(p, productId, categoryId, parentCategoryId)) continue;
    const r = computePromo(p, qty, unitPrice);
    if (r.discount <= 0) continue;
    if (!best || r.discount > best.discount) {
      best = { id: p.id, name: p.name, discount: r.discount, unitPrice: r.unitPrice };
    }
  }
  return best;
}
