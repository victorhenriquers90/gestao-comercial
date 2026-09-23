import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ymdLocal } from "./local-date.ts";
import { splitInstallments } from "./installments.ts";
import { isPromoLive, type Promo } from "./promo.ts";

// Fuso da loja, fixo no teste: o bug so existe fora de UTC.
let tzAntes: string | undefined;
before(() => {
  tzAntes = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
});
after(() => {
  if (tzAntes === undefined) delete process.env.TZ;
  else process.env.TZ = tzAntes;
});

describe("ymdLocal", () => {
  it("22h30 em Brasilia ainda e hoje (em UTC ja seria amanha)", () => {
    const noite = new Date("2026-09-23T22:30:00-03:00");
    assert.equal(noite.toISOString().slice(0, 10), "2026-09-24");
    assert.equal(ymdLocal(noite), "2026-09-23");
  });

  it("ultimo dia do mes a noite nao vira o mes seguinte", () => {
    assert.equal(ymdLocal(new Date("2026-09-30T23:10:00-03:00")), "2026-09-30");
  });

  it("de dia nao muda nada", () => {
    assert.equal(ymdLocal(new Date("2026-09-23T10:00:00-03:00")), "2026-09-23");
  });
});

describe("vencimentos e promocoes a noite", () => {
  it("parcela vendida as 22h vence no dia certo", () => {
    const [p] = splitInstallments({
      total: 100,
      count: 1,
      firstDueInDays: 30,
      from: new Date("2026-09-23T22:00:00-03:00"),
    });
    assert.equal(p!.dueDate, "2026-10-23");
  });

  it("promocao que acaba hoje continua valendo as 22h", () => {
    const promo = { isActive: true, startsAt: "2026-09-01", endsAt: "2026-09-23" } as Promo;
    assert.equal(isPromoLive(promo, ymdLocal(new Date("2026-09-23T22:00:00-03:00"))), true);
  });
});
