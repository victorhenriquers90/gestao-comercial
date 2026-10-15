import { PROMO_KINDS } from "./constants.ts";
import { ymdLocal } from "./local-date.ts";
import { requireIsoDate, requireLine } from "./sanitize.ts";
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

/**
 * Preço de venda "de agora" de um produto -- o promocional direto no
 * cadastro (`products.promo_price`, separado do sistema de Promoção desta
 * tela), só vale quando é positivo E menor que o preço cheio.
 *
 * O "menor que" importa: sem ele, um preço promocional digitado maior que
 * o preço normal por engano (ex.: preço 19,90, promocional 199,00) virava
 * o preço cobrado de verdade em vez de ficar sinalizando um erro de
 * cadastro -- a única coisa que hoje impede isso é a tela de Produtos nunca
 * deixar salvar esse estado (ver saveProductFn), então esta função é a
 * segunda trava, não a primeira: protege dado que já estava errado no
 * banco antes da validação existir.
 */
export function effectivePrice(price: number, promoPrice: number): number {
  return promoPrice > 0 && promoPrice < price ? promoPrice : price;
}

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

export type PromoInput = {
  name: string;
  kind: (typeof PROMO_KINDS)[number];
  percent: number | null;
  amount: number | null;
  promoPrice: number | null;
  buyQty: number | null;
  payQty: number | null;
  minQty: number | null;
  startsAt: string;
  endsAt: string;
};

type RawPromoInput = {
  name?: unknown;
  kind?: unknown;
  percent?: unknown;
  amount?: unknown;
  promoPrice?: unknown;
  buyQty?: unknown;
  payQty?: unknown;
  minQty?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

function promoNumber(raw: unknown, label: string, max: number): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Valor de ${label} inválido.`);
  if (n > max) throw new Error(`Valor de ${label} alto demais.`);
  return n;
}

/**
 * Valida e normaliza o cadastro de promocao no servidor. A tela ja barra
 * estes casos, mas quem chama savePromotionFn direto gravava nome em branco,
 * fim antes do inicio, tipo inexistente e promocao "percentual" sem
 * percentual (ficava "Ativa" e nunca dava desconto). Campos que o tipo
 * escolhido nao usa viram null, pra um percentual esquecido de uma tentativa
 * anterior nao ficar guardado numa promocao de preco fixo.
 */
export function parsePromoInput(raw: RawPromoInput): PromoInput {
  const name = requireLine(raw.name, "Nome", 120);
  const kind = typeof raw.kind === "string" ? (PROMO_KINDS as readonly string[]).find((k) => k === raw.kind) : undefined;
  if (!kind) throw new Error("Tipo de promoção inválido.");
  const startsAt = requireIsoDate(raw.startsAt, "Início");
  const endsAt = requireIsoDate(raw.endsAt, "Fim");
  if (endsAt < startsAt) throw new Error("O fim da promoção não pode ser antes do início.");

  const percent = promoNumber(raw.percent, "percentual", 1_000_000);
  const amount = promoNumber(raw.amount, "desconto", 999_999_999);
  const promoPrice = promoNumber(raw.promoPrice, "preço promocional", 999_999_999);
  const buyQty = promoNumber(raw.buyQty, "quantidade (compre)", 1_000_000);
  const payQty = promoNumber(raw.payQty, "quantidade (pague)", 1_000_000);
  const minQty = promoNumber(raw.minQty, "quantidade mínima", 1_000_000);

  const base = { name, startsAt, endsAt };
  const none = { percent: null, amount: null, promoPrice: null, buyQty: null, payQty: null, minQty: null };
  const needPercent = () => {
    if (percent == null || percent <= 0 || percent > 100) throw new Error("Percentual deve ficar entre 0 e 100 (maior que zero).");
    return percent;
  };

  switch (kind as (typeof PROMO_KINDS)[number]) {
    case "percent":
      return { ...base, ...none, kind: "percent", percent: needPercent() };
    case "fixed":
      if (amount == null || amount <= 0) throw new Error("Desconto deve ser maior que zero.");
      return { ...base, ...none, kind: "fixed", amount };
    case "promo_price":
      if (promoPrice == null || promoPrice <= 0) throw new Error("Preço promocional deve ser maior que zero.");
      return { ...base, ...none, kind: "promo_price", promoPrice };
    case "qty":
      if (minQty == null || minQty <= 0) throw new Error("Quantidade mínima deve ser maior que zero.");
      return { ...base, ...none, kind: "qty", minQty, percent: needPercent() };
    case "bxgy":
      if (buyQty == null || buyQty <= 0) throw new Error("Quantidade (compre) deve ser maior que zero.");
      if (payQty == null || payQty <= 0) throw new Error("Quantidade (pague) deve ser maior que zero.");
      if (payQty >= buyQty) throw new Error('Em "leve X pague Y", pague deve ser menor que leve.');
      return { ...base, ...none, kind: "bxgy", buyQty, payQty };
  }
}
