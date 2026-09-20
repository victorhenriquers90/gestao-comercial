import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCardBrand,
  parseCardRate,
  parseInstallments,
  parseNsu,
  pickCardRate,
  resolveCardRate,
  splitCardSettlement,
  type CardRate,
} from "./card.ts";

const venda = new Date("2026-09-19T12:00:00-03:00");

describe("splitCardSettlement", () => {
  it("debito a vista: taxa aplicada e uma parcela so", () => {
    const r = splitCardSettlement({
      gross: 100,
      feePct: 1.99,
      settlementDays: 1,
      installments: 1,
      soldAt: venda,
    });
    assert.equal(r.fee, 1.99);
    assert.equal(r.net, 98.01);
    assert.equal(r.installments.length, 1);
    assert.equal(r.installments[0]!.amount, 98.01);
    assert.equal(r.installments[0]!.dueDate, "2026-09-20");
  });

  it("credito a vista cai em 30 dias", () => {
    const r = splitCardSettlement({
      gross: 1000,
      feePct: 3.5,
      settlementDays: 30,
      installments: 1,
      soldAt: venda,
    });
    assert.equal(r.fee, 35);
    assert.equal(r.net, 965);
    assert.equal(r.installments[0]!.dueDate, "2026-10-19");
  });

  it("parcelado gera uma entrada por parcela, de 30 em 30 dias", () => {
    const r = splitCardSettlement({
      gross: 300,
      feePct: 0,
      settlementDays: 30,
      installments: 3,
      soldAt: venda,
    });
    assert.equal(r.installments.length, 3);
    assert.deepEqual(
      r.installments.map((p) => p.dueDate),
      ["2026-10-19", "2026-11-18", "2026-12-18"],
    );
  });

  it("a soma das parcelas fecha EXATAMENTE com o liquido", () => {
    // O caso que perde centavo: 100 / 3 nao divide redondo.
    const r = splitCardSettlement({
      gross: 100,
      feePct: 0,
      settlementDays: 30,
      installments: 3,
      soldAt: venda,
    });
    const soma = r.installments.reduce((a, p) => a + p.amount, 0);
    assert.equal(Number(soma.toFixed(2)), r.net);
    // A sobra fica concentrada na primeira, nao espalhada: conferir contra o
    // extrato com N-1 parcelas redondas e muito mais facil.
    assert.equal(r.installments[0]!.amount, 33.34);
    assert.equal(r.installments[1]!.amount, 33.33);
    assert.equal(r.installments[2]!.amount, 33.33);
  });

  it("fecha exatamente tambem com taxa quebrada", () => {
    const r = splitCardSettlement({
      gross: 149.9,
      feePct: 4.49,
      settlementDays: 30,
      installments: 6,
      soldAt: venda,
    });
    const soma = r.installments.reduce((a, p) => a + p.amount, 0);
    assert.equal(Number(soma.toFixed(2)), r.net);
    assert.equal(Number((r.fee + r.net).toFixed(2)), r.gross);
  });

  it("taxa zero nao tira nada -- e o padrao ate a loja configurar", () => {
    const r = splitCardSettlement({
      gross: 250,
      feePct: 0,
      settlementDays: 1,
      installments: 1,
      soldAt: venda,
    });
    assert.equal(r.fee, 0);
    assert.equal(r.net, 250);
  });
});

describe("pickCardRate", () => {
  const geral: CardRate = {
    method: "credito",
    brand: null,
    minInstallments: 1,
    maxInstallments: 18,
    feePct: 4.5,
    settlementDays: 30,
  };
  const aVista: CardRate = { ...geral, minInstallments: 1, maxInstallments: 1, feePct: 3.2 };
  const amex: CardRate = { ...geral, brand: "Amex", feePct: 6 };
  const debito: CardRate = {
    method: "debito",
    brand: null,
    minInstallments: 1,
    maxInstallments: 1,
    feePct: 1.99,
    settlementDays: 1,
  };
  const todas = [geral, aVista, amex, debito];

  it("bandeira especifica ganha da regra geral", () => {
    assert.equal(pickCardRate(todas, "credito", "Amex", 3)?.feePct, 6);
    assert.equal(pickCardRate(todas, "credito", "Visa", 3)?.feePct, 4.5);
  });

  it("entre regras gerais, a faixa mais estreita ganha", () => {
    // "1x a 1x" e mais especifica que "1x a 18x".
    assert.equal(pickCardRate(todas, "credito", "Visa", 1)?.feePct, 3.2);
  });

  it("nao mistura debito com credito", () => {
    assert.equal(pickCardRate(todas, "debito", "Visa", 1)?.feePct, 1.99);
  });

  it("sem regra aplicavel devolve null, em vez de inventar taxa", () => {
    assert.equal(pickCardRate([debito], "credito", "Visa", 1), null);
    assert.equal(pickCardRate([], "credito", "Visa", 1), null);
  });

  it("compara bandeira sem ligar para maiuscula", () => {
    assert.equal(pickCardRate(todas, "credito", "amex", 2)?.feePct, 6);
  });
});

describe("resolveCardRate", () => {
  it("sem nada cadastrado: prazo certo e taxa zero", () => {
    // O prazo nao e opiniao (debito D+1, credito D+30); a taxa e negociada
    // loja a loja, entao chutar um percentual inventaria despesa.
    const d = resolveCardRate([], "debito", "Visa", 1);
    assert.deepEqual(d, { feePct: 0, settlementDays: 1, configured: false });
    const c = resolveCardRate([], "credito", "Visa", 6);
    assert.deepEqual(c, { feePct: 0, settlementDays: 30, configured: false });
  });

  it("usa a regra da loja quando existe", () => {
    const regra: CardRate = {
      method: "credito",
      brand: null,
      minInstallments: 1,
      maxInstallments: 18,
      feePct: 4.2,
      settlementDays: 32,
    };
    assert.deepEqual(resolveCardRate([regra], "credito", "Elo", 4), {
      feePct: 4.2,
      settlementDays: 32,
      configured: true,
    });
  });
});

describe("parseInstallments", () => {
  it("aceita parcelamento so no credito", () => {
    assert.equal(parseInstallments(6, "credito"), 6);
    assert.equal(parseInstallments(1, "debito"), 1);
    assert.equal(parseInstallments(undefined, "pix"), 1);
    assert.throws(() => parseInstallments(3, "debito"), /crédito/);
    assert.throws(() => parseInstallments(2, "dinheiro"), /crédito/);
  });

  it("recusa valores que nao sao parcela", () => {
    assert.throws(() => parseInstallments(0, "credito"), /inválido/);
    assert.throws(() => parseInstallments(-3, "credito"), /inválido/);
    assert.throws(() => parseInstallments(2.5, "credito"), /inválido/);
    assert.throws(() => parseInstallments(Number.NaN, "credito"), /inválido/);
    assert.throws(() => parseInstallments("abc", "credito"), /inválido/);
  });

  it("tem teto", () => {
    assert.equal(parseInstallments(18, "credito"), 18);
    assert.throws(() => parseInstallments(999, "credito"), /Máximo/);
  });
});

describe("parseCardBrand", () => {
  it("exige bandeira em cartao, normalizando a grafia", () => {
    assert.equal(parseCardBrand("visa", "credito"), "Visa");
    assert.equal(parseCardBrand("MASTERCARD", "debito"), "Mastercard");
  });

  it("recusa bandeira fora da lista -- e ela que casa com o extrato", () => {
    assert.throws(() => parseCardBrand("Bandeira Nova", "credito"), /inválida/);
    assert.throws(() => parseCardBrand("", "credito"), /Informe a bandeira/);
  });

  it("ignora o campo quando nao e cartao", () => {
    assert.equal(parseCardBrand("", "pix"), null);
    assert.equal(parseCardBrand("Visa", "dinheiro"), null);
  });
});

describe("parseCardRate", () => {
  const base = {
    method: "credito",
    brand: "",
    minInstallments: 1,
    maxInstallments: 12,
    feePct: 4.2,
    settlementDays: 30,
  };

  it("aceita uma regra normal, bandeira vazia = regra geral", () => {
    const r = parseCardRate(base);
    assert.equal(r.brand, null);
    assert.equal(r.feePct, 4.2);
  });

  it("normaliza a bandeira", () => {
    assert.equal(parseCardRate({ ...base, brand: " elo " }).brand, "Elo");
    assert.throws(() => parseCardRate({ ...base, brand: "Inventada" }), /inválida/);
  });

  it("debito nao parcela", () => {
    assert.throws(
      () => parseCardRate({ ...base, method: "debito", maxInstallments: 6 }),
      /não parcela/,
    );
    assert.equal(parseCardRate({ ...base, method: "debito", maxInstallments: 1 }).method, "debito");
  });

  it("recusa faixa de parcelas invertida ou fora do teto", () => {
    assert.throws(() => parseCardRate({ ...base, minInstallments: 6, maxInstallments: 2 }), /Faixa/);
    assert.throws(() => parseCardRate({ ...base, minInstallments: 0 }), /Faixa/);
    assert.throws(() => parseCardRate({ ...base, maxInstallments: 99 }), /Máximo/);
  });

  it("recusa taxa e prazo fora da realidade", () => {
    assert.throws(() => parseCardRate({ ...base, feePct: -1 }), /Taxa/);
    assert.throws(() => parseCardRate({ ...base, feePct: 100 }), /Taxa/);
    assert.throws(() => parseCardRate({ ...base, feePct: Number.NaN }), /Taxa/);
    assert.throws(() => parseCardRate({ ...base, settlementDays: -1 }), /Prazo/);
    assert.throws(() => parseCardRate({ ...base, settlementDays: 999 }), /Prazo/);
    assert.throws(() => parseCardRate({ ...base, settlementDays: 1.5 }), /Prazo/);
  });

  it("recusa metodo que nao e cartao", () => {
    assert.throws(() => parseCardRate({ ...base, method: "pix" }), /débito ou crédito/);
  });
});

describe("parseNsu", () => {
  it("opcional -- a venda nao trava porque a maquininha nao imprimiu", () => {
    assert.equal(parseNsu(""), null);
    assert.equal(parseNsu(undefined), null);
  });

  it("aceita o formato do comprovante", () => {
    assert.equal(parseNsu("123456"), "123456");
    assert.equal(parseNsu("ab-12cd"), "AB-12CD");
  });

  it("recusa lixo", () => {
    assert.throws(() => parseNsu("12 34"), /hífen/);
    assert.throws(() => parseNsu("<script>"), /hífen/);
    assert.throws(() => parseNsu("x".repeat(33)), /longo/);
  });
});
