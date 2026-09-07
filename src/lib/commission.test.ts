import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCommission,
  pickRule,
  pickTier,
  ruleMatches,
  ruleSpecificity,
  type CommissionRule,
  type TargetBonusIn,
} from "./commission.ts";

function rule(partial: Partial<CommissionRule> & Pick<CommissionRule, "id">): CommissionRule {
  return {
    name: `r${partial.id}`,
    kind: "percent_sales",
    sellerId: null,
    categoryId: null,
    productId: null,
    paymentMethod: null,
    percent: 5,
    minAmount: 0,
    skipPromo: false,
    onlyPromo: false,
    priority: 0,
    isActive: true,
    tiers: [],
    tierBasis: "none",
    ...partial,
  };
}

const shirt = {
  productId: 1,
  productName: "Camiseta",
  categoryId: 10,
  parentCategoryId: 2,
  quantity: 2,
  total: 100,
  costTotal: 40,
  discount: 0,
};

describe("commission rules", () => {
  it("falls back to the seller percent", () => {
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      sellerName: "João",
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
    });
    assert.equal(out.amount, 4);
    assert.equal(out.lines[0]?.ruleId, null);
    assert.match(out.lines[0]?.reason ?? "", /percentual de João/);
  });

  it("lets a category rule beat the seller default", () => {
    const cat = rule({ id: 1, categoryId: 10, percent: 7, name: "Camisetas 7%" });
    assert.equal(pickRule([cat], shirt, 1, "pix")?.id, 1);
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [cat],
      items: [shirt],
    });
    assert.equal(out.amount, 7);
    assert.equal(out.lines[0]?.ruleName, "Camisetas 7%");
  });

  it("lets a product rule beat a category rule", () => {
    const cat = rule({ id: 1, categoryId: 10, percent: 7 });
    const prod = rule({ id: 2, productId: 1, percent: 9, name: "Peça 9%" });
    assert.ok(ruleSpecificity(prod) > ruleSpecificity(cat));
    const picked = pickRule([cat, prod], shirt, 1, "pix");
    assert.equal(picked?.id, 2);
  });

  it("lets a seller-specific rule beat a company-wide rule of the same scope", () => {
    const all = rule({ id: 1, categoryId: 10, percent: 6 });
    const mine = rule({ id: 2, categoryId: 10, sellerId: 8, percent: 8 });
    assert.equal(pickRule([all, mine], shirt, 8, "pix")?.id, 2);
    assert.equal(pickRule([all, mine], shirt, 3, "pix")?.id, 1);
  });

  it("applies payment rules only when nothing more specific matches", () => {
    const pay = rule({ id: 1, paymentMethod: "credito", percent: 2.5, name: "Crédito 2,5%" });
    const cat = rule({ id: 2, categoryId: 10, percent: 7, name: "Camisetas 7%" });
    assert.equal(pickRule([pay, cat], shirt, 1, "credito")?.id, 2);
    const other = { ...shirt, categoryId: 99, parentCategoryId: null, productId: 9 };
    assert.equal(pickRule([pay, cat], other, 1, "credito")?.id, 1);
    assert.equal(pickRule([pay, cat], other, 1, "pix"), null);
  });

  it("zeros commission on exclude rules", () => {
    const ex = rule({ id: 3, kind: "exclude", onlyPromo: true, name: "Promo zerada" });
    const promo = { ...shirt, discount: 20, total: 80 };
    assert.equal(ruleMatches(ex, promo, 1, "pix"), true);
    assert.equal(ruleMatches(ex, shirt, 1, "pix"), false);
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 5,
      paymentMethod: "pix",
      rules: [ex],
      items: [promo],
    });
    assert.equal(out.amount, 0);
  });

  it("uses profit as the base when kind is percent_profit", () => {
    const r = rule({ id: 4, kind: "percent_profit", percent: 20, name: "20% lucro" });
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 5,
      paymentMethod: "pix",
      rules: [r],
      items: [shirt],
    });
    assert.equal(out.amount, 12);
  });

  it("skips a skipPromo rule on discounted items and falls through", () => {
    const r = rule({ id: 5, categoryId: 10, percent: 8, skipPromo: true });
    const promo = { ...shirt, discount: 10, total: 90 };
    assert.equal(pickRule([r], promo, 1, "pix"), null);
    assert.equal(pickRule([r], shirt, 1, "pix")?.id, 5);
  });

  it("respects minAmount", () => {
    const r = rule({ id: 6, percent: 10, minAmount: 150 });
    assert.equal(ruleMatches(r, shirt, 1, "pix"), false);
    assert.equal(ruleMatches(r, { ...shirt, total: 150 }, 1, "pix"), true);
  });

  it("prorates header discount before applying percent", () => {
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 10,
      paymentMethod: "pix",
      headerDiscount: 20,
      rules: [],
      items: [shirt, { ...shirt, productId: 2, productName: "Calça", total: 100, costTotal: 50 }],
    });
    assert.equal(out.amount, 18);
    assert.equal(out.defaultAmount, 18);
  });

  it("matches parent categories", () => {
    const parent = rule({ id: 7, categoryId: 2, percent: 6 });
    assert.equal(pickRule([parent], shirt, 1, "pix")?.id, 7);
  });

  it("combines mixed lines into a blended note", () => {
    const cat = rule({ id: 1, categoryId: 10, percent: 7, name: "Camisetas 7%" });
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [cat],
      items: [shirt, { ...shirt, productId: 9, categoryId: 99, parentCategoryId: null, productName: "Fone", total: 200 }],
    });
    assert.equal(out.amount, 15);
    assert.equal(out.ruleId, null);
    assert.match(out.note, /Camisetas 7%/);
    assert.match(out.note, /Padrão 4%/);
  });

  it("pays a fixed amount per unit", () => {
    const r = rule({ id: 8, kind: "fixed_unit", percent: 1.5, categoryId: 10, name: "R$ 1,50 por peça" });
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 5,
      paymentMethod: "pix",
      rules: [r],
      items: [{ ...shirt, quantity: 3 }],
    });
    assert.equal(out.amount, 4.5);
    assert.equal(out.lines[0]?.base, 3);
    assert.equal(out.lines[0]?.percent, 1.5);
  });

  it("picks the highest matching volume tier on the sale", () => {
    const faixa = rule({
      id: 9,
      name: "Faixa da venda",
      percent: 5,
      tierBasis: "sale",
      tiers: [
        { min: 0, percent: 5 },
        { min: 200, percent: 7 },
        { min: 500, percent: 9 },
      ],
    });
    assert.equal(pickTier(faixa.tiers, 199)?.percent, 5);
    assert.equal(pickTier(faixa.tiers, 200)?.percent, 7);
    const low = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [faixa],
      items: [shirt],
    });
    assert.equal(low.amount, 5);
    const high = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [faixa],
      items: [{ ...shirt, total: 250 }],
    });
    assert.equal(high.amount, 17.5);
    assert.match(high.volumeNote, /faixa 7%/);
  });

  it("uses month-to-date revenue plus this sale for monthly tiers", () => {
    const faixa = rule({
      id: 10,
      name: "Faixa mensal",
      percent: 5,
      tierBasis: "month",
      tiers: [
        { min: 0, percent: 5 },
        { min: 8000, percent: 7 },
        { min: 18000, percent: 9 },
      ],
    });
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      monthRevenue: 7950,
      rules: [faixa],
      items: [{ ...shirt, total: 100 }],
    });
    assert.equal(out.amount, 7);
    assert.match(out.volumeNote, /faixa 7%/);
  });

  it("lets a category percent beat a company-wide monthly tier", () => {
    const faixa = rule({
      id: 11,
      name: "Faixa mensal",
      percent: 5,
      tierBasis: "month",
      tiers: [
        { min: 0, percent: 5 },
        { min: 1, percent: 9 },
      ],
    });
    const cat = rule({ id: 12, categoryId: 10, percent: 7, name: "Camisetas 7%" });
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      monthRevenue: 20000,
      rules: [faixa, cat],
      items: [shirt, { ...shirt, productId: 9, categoryId: 99, parentCategoryId: null, productName: "Fone", total: 200 }],
    });
    assert.equal(out.lines[0]?.ruleName, "Camisetas 7%");
    assert.equal(out.lines[0]?.amount, 7);
    assert.equal(out.lines[1]?.ruleName, "Faixa mensal");
    assert.equal(out.lines[1]?.amount, 18);
  });

  it("skips a tier rule when volume is below every min", () => {
    const faixa = rule({
      id: 13,
      percent: 8,
      tierBasis: "sale",
      tiers: [{ min: 500, percent: 8 }],
    });
    assert.equal(pickRule([faixa], shirt, 1, "pix", { saleTotal: 100, monthRevenue: 0 }), null);
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [faixa],
      items: [shirt],
    });
    assert.equal(out.amount, 4);
  });
});

describe("target bonuses", () => {
  const meta = (partial: Partial<TargetBonusIn> & { id: number }): TargetBonusIn => ({
    name: "Meta Ana",
    amount: 1500,
    realized: 1400,
    bonusKind: "none",
    bonusValue: 0,
    ...partial,
  });

  it("adds extra percent on the sale once the goal is reached", () => {
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
      targets: [meta({ id: 1, bonusKind: "extra_percent", bonusValue: 2, realized: 1450 })],
    });
    assert.equal(out.lines[0]?.amount, 4);
    assert.equal(out.lines[1]?.productName, "Bônus · Meta Ana");
    assert.equal(out.lines[1]?.amount, 2);
    assert.equal(out.amount, 6);
    assert.equal(out.targetHints[0]?.hit, true);
    assert.match(out.bonusNote, /\+2%/);
  });

  it("keeps extra percent on later sales after the goal is already hit", () => {
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
      targets: [meta({ id: 1, bonusKind: "extra_percent", bonusValue: 2, realized: 2000 })],
    });
    assert.equal(out.lines.length, 2);
    assert.equal(out.lines[1]?.amount, 2);
  });

  it("does not add extra percent below the goal", () => {
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
      targets: [meta({ id: 1, bonusKind: "extra_percent", bonusValue: 2, realized: 1000 })],
    });
    assert.equal(out.lines.length, 1);
    assert.equal(out.amount, 4);
    assert.equal(out.targetHints[0]?.hit, false);
    assert.match(out.targetHints[0]?.bonusHint ?? "", /Faltam/);
  });

  it("pays extra_fixed only on the sale that crosses the goal", () => {
    const crossing = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
      targets: [meta({ id: 2, name: "Meta João", amount: 10000, realized: 9950, bonusKind: "extra_fixed", bonusValue: 150 })],
    });
    assert.equal(crossing.lines[1]?.amount, 150);
    assert.equal(crossing.amount, 154);
    assert.equal(crossing.targetHints[0]?.crossing, true);

    const already = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
      targets: [meta({ id: 2, name: "Meta João", amount: 10000, realized: 10000, bonusKind: "extra_fixed", bonusValue: 150 })],
    });
    assert.equal(already.lines.length, 1);
    assert.equal(already.amount, 4);
    assert.equal(already.targetHints[0]?.crossing, false);
    assert.match(already.targetHints[0]?.bonusHint ?? "", /só no cruzamento/);

    const below = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [],
      items: [shirt],
      targets: [meta({ id: 2, name: "Meta João", amount: 10000, realized: 9000, bonusKind: "extra_fixed", bonusValue: 150 })],
    });
    assert.equal(below.lines.length, 1);
    assert.match(below.targetHints[0]?.bonusHint ?? "", /Faltam/);
  });

  it("ignores bonus_kind none and keeps cart line indexes aligned", () => {
    const cat = rule({ id: 1, categoryId: 10, percent: 7, name: "Camisetas 7%" });
    const out = computeCommission({
      sellerId: 1,
      sellerPercent: 4,
      paymentMethod: "pix",
      rules: [cat],
      items: [shirt, { ...shirt, productId: 9, categoryId: 99, parentCategoryId: null, productName: "Fone", total: 200 }],
      targets: [
        meta({ id: 1, bonusKind: "none", bonusValue: 10, realized: 2000 }),
        meta({ id: 2, name: "Meta Ana", bonusKind: "extra_percent", bonusValue: 2, realized: 2000 }),
      ],
    });
    assert.equal(out.lines[0]?.productName, "Camiseta");
    assert.equal(out.lines[1]?.productName, "Fone");
    assert.equal(out.lines[2]?.productName, "Bônus · Meta Ana");
    assert.equal(out.lines[0]?.amount, 7);
    assert.equal(out.lines[1]?.amount, 8);
    assert.equal(out.lines[2]?.amount, 6);
    assert.equal(out.amount, 21);
  });
});
