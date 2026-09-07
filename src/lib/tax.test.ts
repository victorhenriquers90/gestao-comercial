import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateTax,
  clampIss,
  computeNetCommission,
  inssAutonomo,
  inssClt,
  irrfMonthly,
  issFieldValue,
  issSellerHint,
  money,
  resolveTaxProfile,
  type TaxProfile,
} from "./tax.ts";

const none: TaxProfile = {
  regime: "none",
  monthlySalary: 0,
  dependents: 0,
  issRate: 5,
  withholdIss: true,
};

describe("INSS 2026", () => {
  it("uses progressive bands and the ceiling", () => {
    assert.equal(inssClt(1621), 121.58);
    assert.equal(inssClt(3000), 248.6);
    assert.equal(inssClt(8475.55), 988.09);
    assert.equal(inssClt(20000), 988.09);
  });

  it("caps autônomo at 11% of the ceiling", () => {
    assert.equal(inssAutonomo(1000), 110);
    assert.equal(inssAutonomo(8475.55), 932.31);
    assert.equal(inssAutonomo(20000), 932.31);
  });
});

describe("IRRF 2026", () => {
  it("zeros tax up to the R$ 5.000 exemption", () => {
    assert.equal(irrfMonthly(3000, inssClt(3000), 0), 0);
    assert.equal(irrfMonthly(5000, inssClt(5000), 0), 0);
  });

  it("applies the linear reducer between 5.000 and 7.350", () => {
    const ir = irrfMonthly(6000, inssClt(6000), 0);
    assert.ok(ir > 300 && ir < 450, `got ${ir}`);
  });
});

describe("computeNetCommission", () => {
  it("pays the gross when regime is none", () => {
    const out = computeNetCommission({ gross: 180, profile: none });
    assert.equal(out.net, 180);
    assert.equal(out.totalTax, 0);
  });

  it("leaves MEI at gross unless ISS is on", () => {
    const clean = computeNetCommission({
      gross: 200,
      profile: { ...none, regime: "mei", withholdIss: false },
    });
    assert.equal(clean.net, 200);
    const iss = computeNetCommission({
      gross: 200,
      profile: { ...none, regime: "mei", withholdIss: true, issRate: 5 },
    });
    assert.equal(iss.iss, 10);
    assert.equal(iss.net, 190);
  });

  it("withholds 11% INSS and ISS on a modest RPA", () => {
    const out = computeNetCommission({
      gross: 1000,
      profile: { ...none, regime: "autonomo", withholdIss: true, issRate: 5 },
    });
    assert.equal(out.inss, 110);
    assert.equal(out.iss, 50);
    assert.equal(out.irrf, 0);
    assert.equal(out.net, 840);
    assert.equal(out.employerInss, 200);
  });

  it("only withholds remaining INSS up to the monthly ceiling", () => {
    const out = computeNetCommission({
      gross: 500,
      monthCommissionBefore: 8300,
      profile: { ...none, regime: "autonomo", withholdIss: false },
    });
    const expected = money(inssAutonomo(8800) - inssAutonomo(8300));
    assert.equal(out.inss, expected);
    assert.ok(out.inss < 55);
  });

  it("keeps CLT IRRF at zero when salary + commission stays under 5k", () => {
    const out = computeNetCommission({
      gross: 400,
      profile: { ...none, regime: "clt", monthlySalary: 2800, withholdIss: false },
    });
    assert.equal(out.irrf, 0);
    assert.ok(out.inss > 0);
    assert.equal(out.net, money(400 - out.inss));
    assert.equal(out.employerFgts, 32);
    assert.equal(out.employerInss, 80);
  });

  it("takes only the marginal INSS/IRRF of this commission on a high CLT salary", () => {
    const salary = 6000;
    const extra = 2000;
    const out = computeNetCommission({
      gross: extra,
      profile: { ...none, regime: "clt", monthlySalary: salary, withholdIss: false },
    });
    const inssDelta = money(inssClt(8000) - inssClt(6000));
    const irrfDelta = money(irrfMonthly(8000, inssClt(8000), 0) - irrfMonthly(6000, inssClt(6000), 0));
    assert.equal(out.inss, inssDelta);
    assert.equal(out.irrf, irrfDelta);
    assert.equal(out.net, money(extra - inssDelta - irrfDelta));
    assert.ok(out.net < extra);
    assert.ok(out.totalTax > 0);
  });

  it("applies PJ 4.65% + 1.5% + ISS", () => {
    const out = computeNetCommission({
      gross: 1000,
      profile: { ...none, regime: "pj", withholdIss: true, issRate: 5 },
    });
    assert.equal(out.iss, 50);
    assert.equal(out.other, 46.5);
    assert.equal(out.irrf, 15);
    assert.equal(out.net, 888.5);
  });

  it("resolves MEI ISS only when the seller set a rate", () => {
    const implicit = resolveTaxProfile({ regime: "mei", companyIssRate: 5, companyWithholdIss: true });
    assert.equal(implicit.withholdIss, false);
    const explicit = resolveTaxProfile({
      regime: "mei",
      sellerIssRate: 2,
      companyIssRate: 5,
      companyWithholdIss: true,
    });
    assert.equal(explicit.withholdIss, true);
    assert.equal(explicit.issRate, 2);
  });

  it("pays MEI the gross minus own ISS only", () => {
    const out = computeNetCommission({
      gross: 1000,
      profile: resolveTaxProfile({
        regime: "mei",
        sellerIssRate: 2,
        companyIssRate: 5,
        companyWithholdIss: true,
      }),
    });
    assert.equal(out.iss, 20);
    assert.equal(out.inss, 0);
    assert.equal(out.irrf, 0);
    assert.equal(out.net, 980);
  });

  it("does not treat the store rate as a MEI override", () => {
    assert.equal(issFieldValue("mei", null, 5), "");
    assert.equal(issFieldValue("autonomo", null, 5), "5");
    assert.equal(issFieldValue("mei", 2, 5), "2");
    assert.equal(issSellerHint("mei", null, 5), "DAS, sem ISS na fonte");
    assert.equal(issSellerHint("mei", 2, 5), "ISS 2% próprio");
    assert.equal(issSellerHint("autonomo", null, 3), "ISS 3% loja");
  });
});

describe("ISS alíquota", () => {
  it("clamps the rate to 0–5", () => {
    assert.equal(clampIss(-1), 0);
    assert.equal(clampIss(0), 0);
    assert.equal(clampIss(2.5), 2.5);
    assert.equal(clampIss(5), 5);
    assert.equal(clampIss(5.01), 5);
    assert.equal(clampIss(9), 5);
    assert.equal(clampIss("abc"), 0);
    assert.equal(clampIss(null), 0);
    assert.equal(clampIss(2.555), 2.56);
  });

  it("caps resolved company and seller ISS at 5%", () => {
    const company = resolveTaxProfile({
      regime: "autonomo",
      companyIssRate: 9,
      companyWithholdIss: true,
    });
    assert.equal(company.issRate, 5);
    const seller = resolveTaxProfile({
      regime: "autonomo",
      sellerIssRate: 8,
      companyIssRate: 2,
      companyWithholdIss: true,
    });
    assert.equal(seller.issRate, 5);
  });

  it("turns withholding off when the store rate is zero", () => {
    const out = computeNetCommission({
      gross: 1000,
      profile: resolveTaxProfile({
        regime: "autonomo",
        companyIssRate: 0,
        companyWithholdIss: true,
      }),
    });
    assert.equal(out.iss, 0);
    assert.equal(out.inss, 110);
  });
});

describe("allocateTax", () => {
  it("puts the whole withholding on a single line", () => {
    const tax = computeNetCommission({
      gross: 1000,
      profile: { ...none, regime: "autonomo", withholdIss: true, issRate: 5 },
    });
    const [row] = allocateTax([1000], tax);
    assert.equal(row?.inss, tax.inss);
    assert.equal(row?.iss, tax.iss);
    assert.equal(row?.net, tax.net);
  });

  it("splits two equal lines and keeps the totals", () => {
    const tax = computeNetCommission({
      gross: 200,
      profile: { ...none, regime: "autonomo", withholdIss: true, issRate: 5 },
    });
    const rows = allocateTax([100, 100], tax);
    assert.equal(money(rows.reduce((a, r) => a + r.inss, 0)), tax.inss);
    assert.equal(money(rows.reduce((a, r) => a + r.iss, 0)), tax.iss);
    assert.equal(money(rows.reduce((a, r) => a + r.net, 0)), tax.net);
  });
});
