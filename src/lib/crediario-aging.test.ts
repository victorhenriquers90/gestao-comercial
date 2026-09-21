import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketFor,
  collectionOrder,
  daysBetween,
  summarizeDebt,
  type CustomerDebt,
} from "./crediario-aging.ts";

const hoje = "2026-09-21";

describe("bucketFor", () => {
  it("separa 'vence hoje' de 'a vencer' e de atraso", () => {
    // Hoje tem faixa propria porque e o ultimo dia em que a ligacao EVITA o
    // atraso, em vez de cobrar um que ja aconteceu.
    assert.equal(bucketFor("2026-09-25", hoje), "a_vencer");
    assert.equal(bucketFor("2026-09-21", hoje), "hoje");
    assert.equal(bucketFor("2026-09-20", hoje), "ate_30");
  });

  it("corta nas bordas de 30 e 60 dias", () => {
    assert.equal(bucketFor("2026-08-22", hoje), "ate_30"); // 30 dias
    assert.equal(bucketFor("2026-08-21", hoje), "ate_60"); // 31 dias
    assert.equal(bucketFor("2026-07-23", hoje), "ate_60"); // 60 dias
    assert.equal(bucketFor("2026-07-22", hoje), "acima_60"); // 61 dias
  });

  it("ignora a hora quando vem timestamp completo", () => {
    assert.equal(bucketFor("2026-09-21T23:59:00.000Z", hoje), "hoje");
  });

  it("data ilegivel nao quebra", () => {
    assert.equal(bucketFor("nao-e-data", hoje), "hoje");
  });
});

describe("daysBetween", () => {
  it("conta atraso positivo e antecipacao negativa", () => {
    assert.equal(daysBetween("2026-09-01", hoje), 20);
    assert.equal(daysBetween("2026-10-01", hoje), -10);
    assert.equal(daysBetween(hoje, hoje), 0);
  });
});

describe("summarizeDebt", () => {
  const parcelas = [
    { id: 1, dueDate: "2026-07-01", open: 100 }, // 82 dias
    { id: 2, dueDate: "2026-09-01", open: 200 }, // 20 dias
    { id: 3, dueDate: "2026-09-21", open: 50 }, // hoje
    { id: 4, dueDate: "2026-10-21", open: 150 }, // a vencer
  ];

  it("soma total, vencido e a vencer", () => {
    const d = summarizeDebt(parcelas, hoje);
    assert.equal(d.total, 500);
    assert.equal(d.vencido, 300);
    // "Vence hoje" entra no A VENCER do dinheiro: o cliente ainda tem o dia.
    assert.equal(d.aVencer, 200);
  });

  it("distribui nas faixas", () => {
    const d = summarizeDebt(parcelas, hoje);
    assert.equal(d.porFaixa.acima_60, 100);
    assert.equal(d.porFaixa.ate_30, 200);
    assert.equal(d.porFaixa.hoje, 50);
    assert.equal(d.porFaixa.a_vencer, 150);
    assert.equal(d.porFaixa.ate_60, 0);
  });

  it("aponta o vencimento mais antigo e o atraso dele", () => {
    const d = summarizeDebt(parcelas, hoje);
    assert.equal(d.maisAntigo, "2026-07-01");
    assert.equal(d.diasAtraso, 82);
  });

  it("cliente em dia tem atraso zero, nao negativo", () => {
    const d = summarizeDebt([{ id: 1, dueDate: "2026-12-01", open: 100 }], hoje);
    assert.equal(d.diasAtraso, 0);
    assert.equal(d.vencido, 0);
  });

  it("parcela ja quitada nao entra", () => {
    const d = summarizeDebt(
      [
        { id: 1, dueDate: "2026-07-01", open: 0 },
        { id: 2, dueDate: "2026-09-01", open: 30 },
      ],
      hoje,
    );
    assert.equal(d.total, 30);
    assert.equal(d.parcelas, 1);
    assert.equal(d.maisAntigo, "2026-09-01");
  });

  it("sem parcela aberta, tudo zero", () => {
    const d = summarizeDebt([], hoje);
    assert.equal(d.total, 0);
    assert.equal(d.maisAntigo, null);
    assert.equal(d.parcelas, 0);
  });
});

describe("collectionOrder", () => {
  const faz = (diasAtraso: number, total: number): CustomerDebt => ({
    total,
    vencido: total,
    aVencer: 0,
    maisAntigo: "2026-01-01",
    diasAtraso,
    porFaixa: { a_vencer: 0, hoje: 0, ate_30: 0, ate_60: 0, acima_60: total },
    parcelas: 1,
  });

  it("divida mais VELHA vem primeiro, mesmo valendo menos", () => {
    // Divida velha e a que menos volta -- e o que decide a ligacao.
    const ordenado = [faz(10, 5000), faz(90, 200)].sort(collectionOrder);
    assert.equal(ordenado[0]!.diasAtraso, 90);
  });

  it("no mesmo atraso, o maior valor vem primeiro", () => {
    const ordenado = [faz(30, 100), faz(30, 900)].sort(collectionOrder);
    assert.equal(ordenado[0]!.total, 900);
  });
});
