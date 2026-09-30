import { ymdLocal } from "./local-date.ts";
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

export function isPromoLive(p: Promo, today = ymdLocal()) {
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
  /*
    checkoutFn (src/lib/server/commerce.ts) faz
    `unitPrice*qty - disc` sem nenhum teto pra baixo -- um percentual
    cadastrado errado (ex.: 500 no lugar de 50,0) virava desconto MAIOR
    que a propria linha, e a venda fechava com total de linha NEGATIVO. O
    `if (total < 0)` la so olha a venda inteira, nao cada linha: com mais
    de um item a conta podia fechar positiva mesmo com uma linha
    corrompida. Mesma logica pro preco promocional negativo: virava o
    unitPrice da linha, vendendo o produto por valor negativo.
    lineTotal aqui e o teto de qualquer desconto, em todo kind.
  */
  const lineTotal = unitPrice * qty;
  if (p.kind === "percent") {
    const pct = Math.min(Math.max(p.percent ?? 0, 0), 100);
    return { unitPrice, discount: Number(((lineTotal * pct) / 100).toFixed(2)) };
  }
  if (p.kind === "fixed") {
    return { unitPrice, discount: Math.min(lineTotal, Math.max(p.amount ?? 0, 0)) };
  }
  if (p.kind === "promo_price" && p.promoPrice != null && p.promoPrice > 0 && p.promoPrice < unitPrice) {
    return {
      unitPrice: p.promoPrice,
      discount: Number(((unitPrice - p.promoPrice) * qty).toFixed(2)),
    };
  }
  if (p.kind === "qty" && p.minQty && qty >= p.minQty) {
    const pct = Math.min(Math.max(p.percent ?? 0, 0), 100);
    return { unitPrice, discount: Number(((lineTotal * pct) / 100).toFixed(2)) };
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
